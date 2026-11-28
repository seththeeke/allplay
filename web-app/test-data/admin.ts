import type {
  DuplicateAccountsResponse,
  AdminDecision,
  DayMetrics,
  Deployment,
} from "../src/models/api";

/** Deterministic sample admin data for the prototype: 30 days ending on the given date. */

function wave(day: number, base: number, swing: number, period = 7): number {
  return Math.round(base + swing * Math.sin((day / period) * Math.PI * 2));
}

export function sampleMetrics(end: Date, days = 30): DayMetrics[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (days - 1 - index));
    const decisions = wave(index, 900 + index * 25, 180);
    const hard = Math.round(decisions * (0.11 - index * 0.002));
    const soft = Math.round(decisions * 0.06);
    const p50 = wave(index, 1550 - index * 6, 90, 5);
    return {
      period: date.toISOString().slice(0, 10),
      totalPlayers: 120 + index * 11,
      totalAccounts: 10 + Math.floor(index * 0.9),
      totalGuests: 110 + index * 10,
      activePlayers30d: wave(index, 60 + index * 3, 6),
      newPlayers: wave(index, 11, 4),
      gamesStarted: { "spider-solitaire": wave(index, 40 + index, 8) },
      gamesWon: { "spider-solitaire": wave(index, 12 + Math.floor(index / 3), 3) },
      gamesAbandoned: { "spider-solitaire": wave(index, 18, 4) },
      decisions,
      hardFailures: hard,
      softFailures: soft,
      llmCalls: decisions * 2,
      llmInputTokens: decisions * 3700,
      llmOutputTokens: decisions * 90,
      clientLatencyP50Ms: p50,
      clientLatencyP95Ms: p50 + wave(index, 1100, 160, 4),
      serverLatencyP50Ms: p50 - 600,
      serverLatencyP95Ms: p50 + 300,
      llmLatencyP50Ms: wave(index, 420, 40, 6),
      llmLatencyP95Ms: wave(index, 760, 70, 6),
      transcribeLatencyP50Ms: wave(index, 640, 60, 5),
      transcribeLatencyP95Ms: wave(index, 1150, 120, 5),
      pollyLatencyP50Ms: wave(index, 380, 30, 4),
      pollyLatencyP95Ms: wave(index, 690, 60, 4),
      moveLatencyP50Ms: wave(index, 58, 6, 3),
      moveLatencyP95Ms: wave(index, 74, 8, 3),
    };
  });
}

export function sampleFailures(day: string): AdminDecision[] {
  const rows: [string, string, AdminDecision["failureClass"], number][] = [
    ["move the seven of clubs", "UNRECOGNIZED", "HARD", 1820],
    ["three to seven", "REJECTED", "HARD", 1410],
    ["the eight", "CHOSE_OPTION", "SOFT", 1630],
    ["for two nine", "UNRECOGNIZED", "HARD", 2210],
  ];
  return rows.map(([transcript, outcome, failureClass, latency], index) => ({
    decisionId: `sample-${String(index)}`,
    createdAt: `${day}T1${String(index)}:15:00.000Z`,
    gameId: "spider-solitaire",
    transcript,
    outcome,
    failureClass,
    clientLatencyMs: latency,
  }));
}

export function sampleDeployments(end: Date): Deployment[] {
  return [0, 1, 2].map((daysAgo) => {
    const started = new Date(end);
    started.setUTCDate(end.getUTCDate() - daysAgo);
    started.setUTCHours(10, 0, 0, 0);
    const failed = daysAgo === 1;
    return {
      executionId: `execution-${String(daysAgo)}`,
      status: failed ? "FAILED" : "SUCCEEDED",
      trigger: "SCHEDULE",
      startedAt: started.toISOString(),
      lastUpdatedAt: new Date(started.getTime() + 24 * 60 * 1000).toISOString(),
      stages: [
        { name: "Build", status: "SUCCEEDED" },
        { name: "DeployTest", status: "SUCCEEDED" },
        { name: "TestVerification", status: failed ? "FAILED" : "SUCCEEDED" },
        { name: "DeployProd", status: failed ? "STOPPED" : "SUCCEEDED" },
      ],
    };
  });
}

/** One email shared by two accounts, as after an Apple relay sign-in and a Google sign-in. */
export function sampleDuplicates(): DuplicateAccountsResponse["duplicates"] {
  return [
    {
      emailKey: "pat@example.com",
      accounts: [
        {
          playerId: "ACCT#sample-apple",
          signInProviders: ["APPLE"],
          createdAt: "2026-11-01T10:00:00.000Z",
        },
        {
          playerId: "ACCT#sample-google",
          signInProviders: ["GOOGLE"],
          createdAt: "2026-11-15T10:00:00.000Z",
        },
      ],
    },
  ];
}
