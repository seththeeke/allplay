import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { exists } from "./commandRunner";
import { SpeechOutputUnavailableError, type TextToSpeech } from "./textToSpeech";

export interface KokoroOptions {
  /** The virtual environment's python. */
  python: string;
  /** `src/local/kokoro/worker.py`. */
  worker: string;
  model: string;
  voices: string;
  /** A Kokoro voice name, for example `af_heart`. */
  voice: string;
  timeoutMs?: number;
}

/** One running worker: send a JSON line, receive JSON lines. */
export interface WorkerProcess {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
  onExit(listener: () => void): void;
}

export type StartWorker = (python: string, args: readonly string[]) => WorkerProcess;

export const startWorker: StartWorker = (python, args) => {
  const child = spawn(python, args, { stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  return {
    send: (line) => {
      child.stdin.write(`${line}\n`);
    },
    onLine: (listener) => {
      lines.on("line", listener);
    },
    onExit: (listener) => {
      child.on("exit", listener);
      child.on("error", listener);
    },
  };
};

interface Pending {
  resolve: (wav: Uint8Array) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Kokoro-82M through kokoro-onnx (action-decision.md section 13). One Python
 * worker keeps the model loaded for the life of the server; it starts on the
 * first request and again if it exits.
 */
export function createKokoro(
  options: KokoroOptions,
  start: StartWorker = startWorker,
): TextToSpeech {
  let worker: WorkerProcess | null = null;
  const pending = new Map<number, Pending>();
  let nextId = 0;

  const failAll = (message: string) => {
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      request.reject(new SpeechOutputUnavailableError(message));
      pending.delete(id);
    }
  };

  const running = (): WorkerProcess => {
    if (worker !== null) return worker;
    const started = start(options.python, [options.worker, options.model, options.voices]);
    started.onLine((line) => {
      let message: { id?: unknown; wav?: unknown; error?: unknown };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }
      const request = typeof message.id === "number" ? pending.get(message.id) : undefined;
      if (request === undefined) return;
      pending.delete(message.id as number);
      clearTimeout(request.timer);
      if (typeof message.wav === "string") request.resolve(Buffer.from(message.wav, "base64"));
      else
        request.reject(new SpeechOutputUnavailableError(`Kokoro failed: ${String(message.error)}`));
    });
    started.onExit(() => {
      worker = null;
      failAll("The Kokoro worker stopped.");
    });
    worker = started;
    return started;
  };

  return {
    name: "kokoro",
    status: async () => {
      for (const [path, what] of [
        [options.python, "Python environment"],
        [options.model, "model"],
        [options.voices, "voices"],
      ] as const) {
        if (!(await exists(path)))
          return {
            available: false,
            detail: `Kokoro ${what} missing. Run npm run setup:speech:kokoro in backend/.`,
          };
      }
      return { available: true, detail: `Kokoro-82M, voice ${options.voice}.` };
    },
    synthesize: (text, rate) =>
      new Promise((resolve, reject) => {
        const id = (nextId += 1);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new SpeechOutputUnavailableError("Kokoro took too long to answer."));
        }, options.timeoutMs ?? 30_000);
        pending.set(id, { resolve, reject, timer });
        running().send(JSON.stringify({ id, text, speed: rate, voice: options.voice }));
      }),
  };
}
