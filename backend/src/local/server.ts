import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { decisionsRoutes } from "../controller/web-api/decisions/decisionsRoutes";
import { healthRoutes } from "../controller/web-api/health/healthRoutes";
import { isWav, SpeechUnavailableError } from "../service/speech/speechToText";
import { devCaller, toHttpApiEvent } from "./eventAdapter";
import type { Handler, LocalProviders } from "./providers";

/** Request bodies above this size are refused; ten seconds of 16 kHz PCM is about 320 KB. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

class TooLargeError extends Error {}

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

/**
 * The local server (local-development.md section 2): the backend's route
 * lists served through the same Lambda handlers, plus local-only routes.
 */
export function createLocalServer(providers: LocalProviders): Server {
  const api = new Map<string, Handler>([
    ...healthRoutes.map(
      (route) =>
        [
          `${route.method} ${route.path}`,
          (event: unknown) => providers.handlers.health(event),
        ] as const,
    ),
    ...decisionsRoutes.map(
      (route) =>
        [
          `${route.method} ${route.path}`,
          (event: unknown) => providers.handlers.decisions(event),
        ] as const,
    ),
  ]);

  const cors = {
    "access-control-allow-origin": providers.settings.webOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
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
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  const local = async (
    route: string,
    request: IncomingMessage,
    body: Buffer,
  ): Promise<[number, unknown] | null> => {
    switch (route) {
      case "GET /local/status":
        return [200, { preset: providers.settings.preset, capabilities: await providers.status() }];
      case "POST /local/reset":
        providers.reset();
        return [200, { reset: true }];
      case "GET /local/decisions":
        return [
          200,
          {
            decisions: await providers.decisions.recent(`GUEST#${devCaller(request.headers)}`, 20),
          },
        ];
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
        const handler = api.get(route);
        if (handler !== undefined) {
          const result = await handler(
            toHttpApiEvent({
              method,
              path: url.pathname,
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
        else send(response, answer[0], answer[1]);
      } catch (error) {
        if (error instanceof TooLargeError)
          send(response, 413, { code: "VALIDATION_ERROR", message: "Request body too large." });
        else send(response, 500, { code: "INTERNAL_ERROR", message: String(error) });
      }
    })();
  });
}
