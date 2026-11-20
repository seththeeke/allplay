import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/*
 * Plays the seeded one-suit golden game to a win from the web app, typing a
 * hard-coded command for every move into the listening panel. Each command
 * goes through the real decider with the Claude API, and the test checks the
 * decision the backend recorded for it (local-development.md section 6).
 */

const API = process.env["VOICE_API_URL"] ?? "http://localhost:4000";

interface GameStep {
  say: string;
  expect: { kind: "GAME"; actionId: string };
  confirm: "ENTER" | "YES" | "BUTTON";
}

interface Script {
  seed: string;
  steps: (
    | GameStep
    | { say: string; expect: { kind: "APP"; action: string; theme?: string } }
    | { say: string; expect: { kind: "HINT" } }
  )[];
}

interface RecordedDecision {
  decisionId: string;
  transcript: string;
  outcome: string;
  classification?: { category: string; modelId: string };
  proposal?: {
    kind: string;
    actionIds: string[];
    appAction: { action: string; theme?: string } | null;
  };
}

const script = JSON.parse(
  readFileSync(new URL("spider-one-suit.commands.json", import.meta.url), "utf8"),
) as Script;

const api = async <T>(path: string, init?: RequestInit): Promise<T> =>
  (await (await fetch(`${API}${path}`, init)).json()) as T;
const post = (path: string, body: unknown) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const latest = async (): Promise<RecordedDecision> =>
  (await api<{ decisions: RecordedDecision[] }>("/local/decisions"))
    .decisions[0] as RecordedDecision;
interface SessionState {
  sessionId: string;
  version: number;
  status: string;
}
/* The game in play; read by id because /v1/sessions/current stops answering once the game is won. */
let sessionId = "";
const version = async (): Promise<SessionState> => {
  const path =
    sessionId === ""
      ? "/v1/sessions/current?gameId=spider-solitaire"
      : `/v1/sessions/${encodeURIComponent(sessionId)}`;
  const { session } = await api<{ session: SessionState }>(path);
  sessionId = session.sessionId;
  return session;
};

/** Opens the listening panel, types the words and sends them; returns the decision the backend recorded. */
async function say(page: Page, words: string): Promise<RecordedDecision> {
  const before = ((await latest()) as RecordedDecision | undefined)?.decisionId;
  await page.locator("body").press("Space");
  const field = page.getByLabel(/Listening. Say what you want to do:|Or type it:/);
  await field.fill(words);
  await field.press("Enter");
  await expect(page.getByText("Thinking...")).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await latest()).decisionId, { timeout: 30_000 }).not.toBe(before);
  return latest();
}

test("plays a seeded one-suit game to a win by typed voice commands through the Claude decider", async ({
  page,
}) => {
  const status = await api<{ capabilities: { llm: { provider: string; available: boolean } } }>(
    "/local/status",
  );
  expect(status.capabilities.llm, "the local server must use Claude").toMatchObject({
    available: true,
  });
  expect(["claude-code", "claude-api"]).toContain(status.capabilities.llm.provider);
  await post("/local/reset", {});
  await post("/local/seed", { seed: script.seed });

  await page.goto("/spider");
  await expect(page.getByRole("region", { name: "Card table" })).toBeVisible();
  const skip = page.getByRole("button", { name: "Skip the tour" });
  if (await skip.isVisible()) await skip.click();

  const retries: string[] = [];
  for (const [index, step] of script.steps.entries()) {
    const label = `step ${String(index + 1)} "${step.say}"`;
    if (step.expect.kind === "APP") {
      const decision = await say(page, step.say);
      expect(decision.proposal?.appAction, label).toMatchObject({ action: step.expect.action });
      if (step.expect.theme !== undefined)
        await expect(page.locator("html")).toHaveAttribute("data-theme", step.expect.theme);
      continue;
    }
    if (step.expect.kind === "HINT") {
      const decision = await say(page, step.say);
      expect(decision.outcome, label).toBe("RESOLVED");
      continue;
    }
    const expected = step.expect.actionId;
    const { confirm } = step as GameStep;
    const { version: from } = await version();
    let decision = await say(page, step.say);
    if (decision.proposal?.actionIds[0] !== expected && decision.outcome !== "CHOICES") {
      /* The model misheard: cancel, and say it once more before failing. */
      retries.push(
        `${label}: got ${decision.outcome} ${decision.proposal?.actionIds.join(",") ?? ""}`,
      );
      await page.keyboard.press("Escape");
      decision = await say(page, step.say);
    }
    expect(decision.classification?.modelId, label).toMatch(/claude/);
    if (decision.outcome === "CHOICES") {
      const option = (decision.proposal?.actionIds.indexOf(expected) ?? -1) + 1;
      expect(option, `${label}: expected move among the choices`).toBeGreaterThan(0);
      await page.keyboard.press(String(option));
    } else {
      expect(decision.outcome, label).toBe("PROPOSED");
      expect(decision.proposal?.actionIds, label).toEqual([expected]);
      if (confirm === "YES") {
        const answer = await say(page, "yes");
        expect(answer.outcome, `${label}: spoken yes`).toBe("RESOLVED");
      } else if (confirm === "BUTTON") {
        await page.getByRole("button", { name: "Confirm (Enter)" }).click();
      } else {
        await page.keyboard.press("Enter");
      }
    }
    await expect
      .poll(async () => (await version()).version, { timeout: 15_000 })
      .toBeGreaterThan(from);
  }

  expect((await version()).status).toBe("WON");
  const decisions = (await api<{ decisions: RecordedDecision[] }>("/local/decisions")).decisions;
  expect(decisions.every((d) => d.classification?.modelId.includes("claude") ?? false)).toBe(true);
  test.info().annotations.push({
    type: "repeated commands",
    description: retries.length === 0 ? "none" : retries.join("; "),
  });
});
