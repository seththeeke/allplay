import type { RecordedDecision } from "../../models/api";
import type { VoiceLabService } from "../types";

/** The Voice Lab without a local server: typed commands are recorded in memory; audio is refused. */
export function createMemoryVoiceLabService(now: () => Date = () => new Date()): VoiceLabService {
  const decisions: RecordedDecision[] = [];
  return {
    status: () =>
      Promise.resolve({
        preset: "web-memory",
        capabilities: {
          speechIn: {
            setting: "typed",
            provider: "typed",
            available: false,
            detail: "No local server; type commands.",
          },
        },
      }),
    transcribe: () =>
      Promise.reject(new Error("No local server is configured, so audio cannot be transcribed.")),
    send: (transcript, transcriptSource) => {
      const decisionId = `memory-${String(decisions.length + 1)}`;
      decisions.unshift({
        decisionId,
        playerId: "GUEST#local-prototype",
        transcript,
        transcriptSource,
        uiContext: { screen: "HOME", pendingDecisionId: null },
        outcome: "UNRECOGNIZED",
        createdAt: now().toISOString(),
      });
      return Promise.resolve({
        decisionId,
        outcome: "UNRECOGNIZED",
        displayText: `I heard "${transcript}".`,
        speech: `I heard ${transcript}.`,
        proposal: null,
        choices: null,
        appAction: null,
        session: null,
      });
    },
    recent: () => Promise.resolve([...decisions]),
  };
}
