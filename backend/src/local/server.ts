import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { decisionsRoutes } from "../controller/web-api/decisions/decisionsRoutes";
import { gameRoutes } from "../controller/web-api/game/gameRoutes";
import { healthRoutes } from "../controller/web-api/health/healthRoutes";
import { playersRoutes } from "../controller/web-api/players/playersRoutes";
import { SEED_PATTERN } from "../game-engine";
import { isWav, SpeechUnavailableError } from "../service/speech/speechToText";
import { MAX_SPEECH_CHARS, SpeechOutputUnavailableError } from "../service/speech/textToSpeech";
import { devCaller, devPlayerId, toHttpApiEvent } from "./eventAdapter";
import type { Handler, LocalProviders } from "./providers";

/** Request bodies above this size are refused; ten seconds of 16 kHz PCM is about 320 KB. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

class TooLargeError extends Error {}

interface ApiRoute {
  method: string;
  template: string;
  segments: string[];
  handler: Handler;
}

/** Matches a path against a template such as `/v1/sessions/{sessionId}`; literal routes win over parameters. */
export function matchRoute(
  routes: readonly ApiRoute[],
  method: string,
  path: string,
): { route: ApiRoute; pathParameters: Record<string, string> } | null {
  const parts = path.split("/");
  const matches = routes.flatMap((route) => {
    if (route.method !== method || route.segments.length !== parts.length) return [];
    const pathParameters: Record<string, string> = {};
    for (const [index, segment] of route.segments.entries()) {
      const part = parts[index] as string;
      if (segment.startsWith("{")) {
        if (part === "") return [];
        pathParameters[segment.slice(1, -1)] = decodeURIComponent(part);
      } else if (segment !== part) return [];
    }
    return [{ route, pathParameters }];
  });
  matches.sort(
    (a, b) => Object.keys(a.pathParameters).length - Object.keys(b.pathParameters).length,
  );
  return matches[0] ?? null;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) reject(new TooLargeError());
      else chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

/** `{ text, rate }` from a request body, or null when it is not a valid synthesis request. */
function parseSynthesis(body: Buffer): { text: string; rate: number } | null {
  try {
    const value = JSON.parse(body.toString("utf8")) as { text?: unknown; rate?: unknown };
    const text = typeof value.text === "string" ? value.text.trim() : "";
    const rate = value.rate === undefined ? 1 : value.rate;
    if (text === "" || text.length > MAX_SPEECH_CHARS) return null;
    if (typeof rate !== "number" || rate < 0.5 || rate > 2) return null;
    return { text, rate };
  } catch {
    return null;
  }
}

/** `{ seed }` from a request body: a 32 digit hex seed, null to clear, or undefined when invalid. */
function parseSeed(body: Buffer): string | null | undefined {
  try {
    const value = (JSON.parse(body.toString("utf8")) as { seed?: unknown }).seed;
    if (value === null) return null;
    return typeof value === "string" && SEED_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The local server (local-development.md section 2): the backend's route
 * lists served through the same Lambda handlers, plus local-only routes.
 */
export function createLocalServer(providers: LocalProviders): Server {
  const bundles = [
    [healthRoutes, "health"],
    [decisionsRoutes, "decisions"],
    [gameRoutes, "game"],
    [playersRoutes, "players"],
  ] as const;
  const api: ApiRoute[] = bundles.flatMap(([routes, bundle]) =>
    routes.map((route) => ({
      method: route.method,
      template: route.path,
      segments: route.path.split("/"),
      handler: (event: unknown) => providers.handlers[bundle](event),
    })),
  );

  const cors = {
    "access-control-allow-origin": providers.settings.webOrigin,
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-allow-headers": "content-type, x-allplay-dev-caller",
  };

  const send = (
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void => {
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...cors,
      ...headers,
    });
    response.end(
      typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body),
    );
  };

  const local = async (
    route: string,
    request: IncomingMessage,
    body: Buffer,
  ): Promise<[number, unknown, Record<string, string>?] | null> => {
    switch (route) {
      case "GET /local/status":
        return [200, { preset: providers.settings.preset, capabilities: await providers.status() }];
      case "POST /local/reset":
        providers.reset();
        return [200, { reset: true }];
      case "POST /local/seed": {
        const seed = parseSeed(body);
        if (seed === undefined)
          return [
            400,
            { code: "VALIDATION_ERROR", message: "Send { seed } as 32 hex digits, or null." },
          ];
        providers.setSeed(seed);
        return [200, { seed }];
      }
      case "GET /local/decisions":
        return [
          200,
          {
            decisions: await providers.decisions.recent(
              devPlayerId(devCaller(request.headers)),
              20,
            ),
          },
        ];
      case "GET /local/speech/spoken":
        return [
          200,
          {
            spoken:
              "spoken" in providers.textToSpeech
                ? (providers.textToSpeech as { spoken: string[] }).spoken
                : [],
          },
        ];
      case "POST /local/speech/synthesize": {
        const request = parseSynthesis(body);
        if (request === null)
          return [
            400,
            {
              code: "VALIDATION_ERROR",
              message: `Send { text, rate } with 1 to ${String(MAX_SPEECH_CHARS)} characters and a rate from 0.5 to 2.`,
            },
          ];
        try {
          const wav = await providers.textToSpeech.synthesize(request.text, request.rate);
          return [200, wav, { "content-type": "audio/wav" }];
        } catch (error) {
          if (error instanceof SpeechOutputUnavailableError)
            return [503, { code: "INTERNAL_ERROR", message: error.message }];
          throw error;
        }
      }
      case "POST /local/speech/transcribe": {
        if (!isWav(body))
          return [400, { code: "VALIDATION_ERROR", message: "Send 16 kHz mono WAV audio." }];
        const started = Date.now();
        try {
          const { text } = await providers.speechToText.transcribe(body);
          return [
            200,
            {
              text,
              transcriptSource: providers.speechToText.transcriptSource,
              provider: providers.speechToText.name,
              latencyMs: Date.now() - started,
            },
          ];
        } catch (error) {
          if (error instanceof SpeechUnavailableError)
            return [503, { code: "INTERNAL_ERROR", message: error.message }];
          throw error;
        }
      }
      default:
        return null;
    }
  };

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";
      if (method === "OPTIONS") {
        response.writeHead(204, cors).end();
        return;
      }
      try {
        const body = await readBody(request);
        const route = `${method} ${url.pathname}`;
        const matched = matchRoute(api, method, url.pathname);
        if (matched !== null) {
          const result = await matched.route.handler(
            toHttpApiEvent({
              method,
              path: url.pathname,
              template: matched.route.template,
              pathParameters: matched.pathParameters,
              query: url.search.slice(1),
              headers: request.headers,
              body,
            }),
          );
          send(response, result.statusCode, result.body, result.headers);
          return;
        }
        const answer = await local(route, request, body);
        if (answer === null) send(response, 404, { code: "NOT_FOUND", message: "No such route." });
        else send(response, answer[0], answer[1], answer[2]);
      } catch (error) {
        if (error instanceof TooLargeError)
          send(response, 413, { code: "VALIDATION_ERROR", message: "Request body too large." });
        else send(response, 500, { code: "INTERNAL_ERROR", message: String(error) });
      }
    })();
  });
}
