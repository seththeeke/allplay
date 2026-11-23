/** Audio frames the detector classifies: 30 ms at 16 kHz (conversational-ai.md section 3.1). */
export const FRAME_SAMPLES = 480;
export const FRAME_MS = 30;

const START_MS = 150;
const MIN_SPEECH_MS = 250;
const MAX_SPEECH_MS = 15_000;
const MIN_THRESHOLD = 0.008;
const NOISE_MULTIPLIER = 3;
const SPEAKING_MULTIPLIER = 2;
const NOISE_SMOOTHING = 0.05;

export type DetectorEvent = "START" | "END" | "DISCARD" | null;

export interface SpeechDetector {
  /** Classifies one frame and reports a change of state. */
  push(frame: Float32Array): DetectorEvent;
  /** While the game speaks, the threshold rises so its own voice is not taken for the player's. */
  setSpeaking(speaking: boolean): void;
  setSilenceMs(silenceMs: number): void;
}

const rms = (frame: Float32Array): number => {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  return frame.length === 0 ? 0 : Math.sqrt(sum / frame.length);
};

/** Energy-based speech detection against a rolling noise floor. */
export function createSpeechDetector(initialSilenceMs: number): SpeechDetector {
  let silenceMs = initialSilenceMs;
  let speaking = false;
  let noise = 0;
  let inSpeech = false;
  let run = 0;
  let quiet = 0;
  let voiced = 0;
  let total = 0;

  const finish = (): DetectorEvent => {
    const long = voiced * FRAME_MS >= MIN_SPEECH_MS;
    inSpeech = false;
    run = 0;
    quiet = 0;
    voiced = 0;
    total = 0;
    return long ? "END" : "DISCARD";
  };

  return {
    setSpeaking: (next) => {
      speaking = next;
    },
    setSilenceMs: (next) => {
      silenceMs = next;
    },
    push: (frame) => {
      const level = rms(frame);
      const threshold =
        Math.max(MIN_THRESHOLD, noise * NOISE_MULTIPLIER) * (speaking ? SPEAKING_MULTIPLIER : 1);
      const isVoiced = level >= threshold;
      if (!inSpeech) {
        if (!isVoiced) {
          /* The game's own voice is not room noise, so it must not raise the floor. */
          if (!speaking) noise = noise === 0 ? level : noise + (level - noise) * NOISE_SMOOTHING;
          run = 0;
          return null;
        }
        run += 1;
        if (run * FRAME_MS < START_MS) return null;
        inSpeech = true;
        voiced = run;
        total = run;
        quiet = 0;
        return "START";
      }
      total += 1;
      if (isVoiced) {
        voiced += 1;
        quiet = 0;
      } else {
        quiet += 1;
      }
      if (quiet * FRAME_MS >= silenceMs || total * FRAME_MS >= MAX_SPEECH_MS) return finish();
      return null;
    },
  };
}
