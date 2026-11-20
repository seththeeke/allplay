import {
  SpeechUnavailableError,
  type SpeechToText,
} from "../../../src/service/speech/speechToText";

/** A speech provider for tests: answers with fixed text, or reports itself unavailable. */
export function fakeSpeech(text: string, available = true, name = "fake"): SpeechToText {
  return {
    name,
    transcriptSource: "WHISPER",
    status: () => Promise.resolve({ available, detail: available ? "ready" : "not set up" }),
    transcribe: () =>
      available
        ? Promise.resolve({ text })
        : Promise.reject(new SpeechUnavailableError("not set up")),
  };
}

/** A minimal 16 kHz mono WAV of silence. */
export function silentWav(samples = 1600): Uint8Array {
  const data = samples * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data, true);
  return bytes;
}
