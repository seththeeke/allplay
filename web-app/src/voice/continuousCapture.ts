import { browserAudio, SAMPLE_RATE, type AudioEnvironment } from "./audioCapture";
import { createSpeechDetector, FRAME_MS, FRAME_SAMPLES } from "./speechDetector";

/** Audio kept from before speech is detected, so the first word is never cut. */
const PRE_ROLL_FRAMES = Math.ceil(500 / FRAME_MS);

export interface CaptureHandlers {
  /** Speech began; `preRoll` holds the audio leading up to it, including the start of the speech. */
  onSpeechStart: (preRoll: readonly Float32Array[]) => void;
  /** Every frame while the microphone is open, in order. */
  onFrame: (frame: Float32Array) => void;
  /** The utterance ended organically; `audio` is all of it, with the pre-roll. */
  onSpeechEnd: (audio: readonly Float32Array[]) => void;
  /** What sounded like speech was too short to be an utterance. */
  onDiscard: () => void;
}

export interface ContinuousCapture {
  setSpeaking(speaking: boolean): void;
  setSilenceMs(silenceMs: number): void;
  stop(): void;
}

/**
 * Keeps the microphone open and marks where each utterance starts and ends
 * (conversational-ai.md section 3.1). Audio stays in the browser until a
 * listener sends a finished utterance or a detected stream to speech to text.
 */
export async function startContinuousCapture(
  handlers: CaptureHandlers,
  silenceMs: number,
  env: AudioEnvironment = browserAudio,
): Promise<ContinuousCapture> {
  const stream = await env.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = env.createContext(SAMPLE_RATE);
  await context.audioWorklet.addModule("/pcm-capture-worklet.js");
  const source = context.createMediaStreamSource(stream);
  const worklet = env.createWorklet(context);
  const detector = createSpeechDetector(silenceMs);
  let pending = new Float32Array(FRAME_SAMPLES);
  let filled = 0;
  let preRoll: Float32Array[] = [];
  let utterance: Float32Array[] | null = null;

  const onFrame = (frame: Float32Array): void => {
    handlers.onFrame(frame);
    const event = detector.push(frame);
    if (utterance !== null) utterance.push(frame);
    else preRoll = [...preRoll, frame].slice(-PRE_ROLL_FRAMES);
    if (event === "START") {
      utterance = preRoll;
      preRoll = [];
      handlers.onSpeechStart([...utterance]);
    } else if (event === "END" || event === "DISCARD") {
      const finished = utterance ?? [];
      utterance = null;
      if (event === "END") handlers.onSpeechEnd(finished);
      else handlers.onDiscard();
    }
  };

  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    let offset = 0;
    const samples = event.data;
    while (offset < samples.length) {
      const take = Math.min(FRAME_SAMPLES - filled, samples.length - offset);
      pending.set(samples.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;
      if (filled === FRAME_SAMPLES) {
        onFrame(pending);
        pending = new Float32Array(FRAME_SAMPLES);
        filled = 0;
      }
    }
  };
  source.connect(worklet);
  /* A page opened without a click starts its audio suspended, so the next input wakes it. */
  const wake = (): void => {
    if (context.state === "suspended") void context.resume();
  };
  wake();
  globalThis.addEventListener("pointerdown", wake);
  globalThis.addEventListener("keydown", wake);
  return {
    setSpeaking: (speaking) => {
      detector.setSpeaking(speaking);
    },
    setSilenceMs: (next) => {
      detector.setSilenceMs(next);
    },
    stop: () => {
      globalThis.removeEventListener("pointerdown", wake);
      globalThis.removeEventListener("keydown", wake);
      worklet.port.onmessage = null;
      source.disconnect();
      worklet.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}
