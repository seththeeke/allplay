import { encodeWav } from "./wav";

/** Speech to text expects 16 kHz mono (action-decision.md sections 3.1 and 3.4). */
export const SAMPLE_RATE = 16000;

export interface Recording {
  /** Stops capture and returns the audio as WAV. */
  stop(): Promise<Uint8Array<ArrayBuffer>>;
  /** Stops capture and discards the audio. */
  cancel(): void;
}

/** The browser audio APIs capture needs, injected so tests can supply fakes. */
export interface AudioEnvironment {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createContext(sampleRate: number): AudioContext;
  createWorklet(context: AudioContext): AudioWorkletNode;
}

export const browserAudio: AudioEnvironment = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createContext: (sampleRate) => new AudioContext({ sampleRate }),
  createWorklet: (context) => new AudioWorkletNode(context, "pcm-capture"),
};

/**
 * Starts capturing the microphone at 16 kHz mono through an AudioWorklet.
 * Nothing leaves the browser until `stop`, and then only to the local server.
 */
export async function startRecording(env: AudioEnvironment = browserAudio): Promise<Recording> {
  const stream = await env.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = env.createContext(SAMPLE_RATE);
  await context.audioWorklet.addModule("/pcm-capture-worklet.js");
  const source = context.createMediaStreamSource(stream);
  const worklet = env.createWorklet(context);
  const chunks: Float32Array[] = [];
  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    chunks.push(event.data);
  };
  source.connect(worklet);
  const release = async (): Promise<void> => {
    source.disconnect();
    worklet.disconnect();
    for (const track of stream.getTracks()) track.stop();
    await context.close();
  };
  return {
    stop: async () => {
      await release();
      return encodeWav(chunks, context.sampleRate);
    },
    cancel: () => {
      void release();
    },
  };
}
