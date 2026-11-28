import { z } from "zod";
import type { Logger } from "../../logger";
import type { AndonService } from "../../service/andon/andonService";

/** The SNS delivery of a budget notification; only the message text is read. */
const SnsEventSchema = z.object({
  Records: z
    .array(z.object({ Sns: z.object({ Message: z.string(), Subject: z.string().nullish() }) }))
    .min(1),
});

/** The budget named in a notification, such as `AllPlay-Transcribe`. */
export function budgetName(message: string): string {
  return /Budget Name:\s*(\S+)/.exec(message)?.[1] ?? "AWS Budgets";
}

/**
 * Handler of `AllPlay-AndonCord` (productionalization.md section 4.2): every
 * notification on `AllPlay-Andon` pulls the cord in every stage. One stage
 * failing does not stop the others; the failure is rethrown afterwards so
 * SNS retries the delivery.
 */
export function createAndonCordHandler(
  stages: readonly { stage: string; andon: AndonService }[],
  logger: Logger,
): (event: unknown) => Promise<void> {
  return async (event) => {
    const parsed = SnsEventSchema.safeParse(event);
    if (!parsed.success) {
      logger.warn("ANDON_EVENT_UNREADABLE", { issues: parsed.error.issues.length });
      return;
    }
    const reason = budgetName(parsed.data.Records.map((record) => record.Sns.Message).join("\n"));
    let failed: Error | null = null;
    for (const { stage, andon } of stages) {
      try {
        await andon.set({ pulled: true, reason, pulledBy: "BUDGET" });
        logger.error("ANDON_CORD_PULLED", { stage, reason });
      } catch (error) {
        failed = error instanceof Error ? error : new Error(String(error));
        logger.error("ANDON_PULL_FAILED", { stage, reason, error: String(error) });
      }
    }
    if (failed !== null) throw failed;
  };
}
