import {
  DecisionResponseSchema,
  LocalDecisionsResponseSchema,
  LocalStatusSchema,
  TranscriptionResponseSchema,
} from "../../models/api";
import type { VoiceLabService } from "../types";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** The Voice Lab against the local server; an error response rejects with the server's message. */
export function createLiveVoiceLabService(
  apiUrl: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): VoiceLabService {
  const base = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetchImpl(new URL(path, base).toString(), init);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (body as { message?: unknown } | null)?.message;
      throw new Error(
        typeof message === "string"
          ? message
          : `The local server answered ${String(response.status)}.`,
      );
    }
    return body;
  };
  return {
    status: async () => LocalStatusSchema.parse(await call("local/status")),
    transcribe: async (wav) =>
      TranscriptionResponseSchema.parse(
        await call("local/speech/transcribe", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: new Blob([wav], { type: "audio/wav" }),
        }),
      ),
    send: async (transcript, transcriptSource) =>
      DecisionResponseSchema.parse(
        await call("v1/decisions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            transcript,
            transcriptSource,
            context: {
              screen: "HOME",
              sessionId: null,
              expectedVersion: null,
              pendingDecisionId: null,
            },
          }),
        }),
      ),
    recent: async () => LocalDecisionsResponseSchema.parse(await call("local/decisions")).decisions,
  };
}
