import type { Server } from "node:http";
import { logger } from "../logger";
import { createLocalProviders } from "./providers";
import { createLocalServer } from "./server";
import { resolveSettings } from "./settings";

/** `npm run dev:server`: starts the local server with the settings from the environment (local-development.md section 2). */
export async function startLocalServer(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Server> {
  const settings = resolveSettings(env);
  const providers = await createLocalProviders(settings, env);
  const server = createLocalServer(providers);
  await new Promise<void>((resolve) => server.listen(settings.port, "127.0.0.1", resolve));
  const status = await providers.status();
  logger.info("All Play local server ready", {
    url: `http://localhost:${String(settings.port)}`,
    preset: settings.preset,
    ...Object.fromEntries(
      Object.entries(status).map(([name, cap]) => [
        name,
        `${cap.provider} (${cap.available ? "available" : cap.detail})`,
      ]),
    ),
  });
  return server;
}
