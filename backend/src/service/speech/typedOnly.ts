import { SpeechUnavailableError, type SpeechToText } from "./speechToText";

/** No speech recognition: commands are typed (the continuous-integration preset and machines without a provider). */
export function createTypedOnly(
  reason = "Typed commands only; no speech provider is set up.",
): SpeechToText {
  return {
    name: "typed",
    transcriptSource: "TYPED",
    status: () => Promise.resolve({ available: false, detail: reason }),
    transcribe: () => Promise.reject(new SpeechUnavailableError(reason)),
  };
}
