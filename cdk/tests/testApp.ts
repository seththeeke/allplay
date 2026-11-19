import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";

/** A stand-in web build so tests never need `web-app/dist`. */
export const WEB_FIXTURE = fileURLToPath(new URL("./fixtures/web-dist/", import.meta.url));

/** Context that skips Lambda bundling, so tests need neither esbuild output nor backend dependencies. */
export const TEST_CONTEXT = {
  "aws:cdk:bundling-stacks": [],
  "allplay:webAssetPath": WEB_FIXTURE,
};

export function testApp(context: Record<string, unknown> = {}, outdir?: string): App {
  return new App({
    context: { ...TEST_CONTEXT, ...context },
    ...(outdir === undefined ? {} : { outdir }),
  });
}
