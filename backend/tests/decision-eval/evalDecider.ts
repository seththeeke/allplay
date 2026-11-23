import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createInMemoryGameTables } from "../../src/dao/gameSession/inMemoryGameSessionDao";
import { createBundledRulesRepository } from "../../src/game-catalog";
import { DecisionRequestSchema, type DecisionResponse } from "../../src/models/api";
import { createDecisionService } from "../../src/service/decision/decisionService";
import {
  createBedrockLlm,
  DEFAULT_AWS_REGION,
  DEFAULT_BEDROCK_MODEL,
} from "../../src/service/decision/llm/bedrockConverse";
import { createClaudeCodeLlm } from "../../src/service/decision/llm/claudeCode";
import { DEFAULT_CLAUDE_MODEL } from "../../src/service/decision/llm/claudeApi";
import type { LlmClient } from "../../src/service/decision/llm/llmClient";
import { createGameSessionService } from "../../src/service/gameSession/gameSessionService";
import { EvalSetSchema, type EvalCase } from "./cases";

/*
 * The offline decider evaluation (action-decision.md section 12):
 * `npm run eval:decider -- --stage Test` plays every case against Bedrock
 * with the stage's model, from the developer's machine with the allplays
 * profile, and reports top-1 accuracy, the ambiguity and unrecognized rates,
 * and latency. Every case is a paid model call, so it runs on demand only.
 * `--llm claude-code` runs it on the developer's Claude Code plan instead.
 */
const { values } = parseArgs({
  options: {
    stage: { type: "string", default: "Test" },
    llm: { type: "string", default: "bedrock" },
    model: { type: "string" },
    limit: { type: "string" },
  },
});
const llm: LlmClient =
  values.llm === "claude-code"
    ? createClaudeCodeLlm({ binary: "claude", model: values.model ?? DEFAULT_CLAUDE_MODEL })
    : createBedrockLlm({
        modelId: values.model ?? DEFAULT_BEDROCK_MODEL,
        region: process.env["AWS_REGION"] ?? DEFAULT_AWS_REGION,
      });

const set = EvalSetSchema.parse(
  JSON.parse(readFileSync(new URL("./spider-solitaire.cases.json", import.meta.url), "utf8")),
);
const cases = set.cases.slice(0, values.limit === undefined ? undefined : Number(values.limit));
const repository = createBundledRulesRepository();

/** Whether the decider did what the case expects. */
export function scored(item: EvalCase, reply: DecisionResponse): boolean {
  const expected = item.expect;
  switch (expected.kind) {
    case "GAME": {
      if (reply.proposal !== null) return expected.accept.includes(reply.proposal.actionId);
      if (reply.choices !== null)
        return reply.choices.every((choice) => expected.accept.includes(choice.actionId));
      return reply.outcome === "AUTO_APPLIED";
    }
    case "APP":
      return reply.appAction?.action === expected.action;
    case "RESPONSE":
      return reply.outcome === "RESOLVED";
    case "UNRECOGNIZED":
      return reply.outcome === "UNRECOGNIZED";
  }
}

async function run(item: EvalCase): Promise<{ correct: boolean; outcome: string; ms: number }> {
  const tables = createInMemoryGameTables();
  const sessions = createGameSessionService({
    ...tables,
    games: (gameId, version) => repository.compiled(gameId, version),
    newSeed: () => item.seed,
  });
  let envelope = await sessions.start("GUEST#eval", { gameId: item.gameId, options: item.options });
  for (const actionId of item.history)
    envelope = await sessions.applyAction("GUEST#eval", envelope.session.sessionId, {
      actionId,
      expectedVersion: envelope.session.version,
    });
  const decider = createDecisionService({
    log: { decided: () => Promise.resolve(), resolved: () => Promise.resolve() },
    llm,
    sessions,
    catalog: () => repository.list(),
    guidance: async (gameId, version) =>
      (await repository.get(gameId, version)).speech.deciderGuidance ?? [],
  });
  const started = performance.now();
  const reply = await decider.decide(
    "GUEST#eval",
    DecisionRequestSchema.parse({
      transcript: item.transcript,
      transcriptSource: "TYPED",
      context: {
        screen: "GAME",
        sessionId: envelope.session.sessionId,
        expectedVersion: envelope.session.version,
        pendingPrompt:
          item.pending === null
            ? null
            : { decisionId: "eval-pending", ...item.pending, appAction: null },
      },
    }),
  );
  return { correct: scored(item, reply), outcome: reply.outcome, ms: performance.now() - started };
}

const results: { item: EvalCase; correct: boolean; outcome: string; ms: number }[] = [];
for (const item of cases) {
  const result = await run(item);
  results.push({ item, ...result });
  if (!result.correct)
    process.stdout.write(`MISS ${item.id} "${item.transcript}" -> ${result.outcome}\n`);
}
const share = (part: number, whole: number) =>
  whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(1)}%`;
const unambiguous = results.filter(
  (r) => r.item.expect.kind === "GAME" && !r.item.expect.ambiguous,
);
const gameTurns = results.filter((r) => r.item.expect.kind === "GAME");
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const at = (q: number) =>
  Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0);
process.stdout.write(
  [
    `Stage ${values.stage}, model ${llm.name}, ${String(results.length)} cases`,
    `Top-1 accuracy, unambiguous game commands: ${share(unambiguous.filter((r) => r.correct).length, unambiguous.length)} (target 95%)`,
    `All cases correct: ${share(results.filter((r) => r.correct).length, results.length)}`,
    `Ambiguity rate (choices offered): ${share(gameTurns.filter((r) => r.outcome === "CHOICES").length, gameTurns.length)}`,
    `Unrecognized rate: ${share(results.filter((r) => r.outcome === "UNRECOGNIZED").length, results.length)}`,
    `Latency p50 ${String(at(0.5))} ms, p95 ${String(at(0.95))} ms`,
  ].join("\n") + "\n",
);
