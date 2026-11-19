import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";

/** A stand-in web build so tests never need `web-app/dist`. */
export const WEB_FIXTURE = fileURLToPath(new URL("./fixtures/web-dist/", import.meta.url));

/** The feature flags and settings from cdk.json, so tests synthesize exactly as the CLI does. */
const CDK_JSON = JSON.parse(
  readFileSync(fileURLToPath(new URL("../cdk.json", import.meta.url)), "utf8"),
) as { context: Record<string, unknown> };

/** Context that skips Lambda bundling, so tests need neither esbuild output nor backend dependencies. */
export const TEST_CONTEXT = {
  ...CDK_JSON.context,
  /* The CLI adds CDKMetadata, which keeps the still-empty stateful stack a valid template. */
  "aws:cdk:version-reporting": true,
  "aws:cdk:bundling-stacks": [],
  "allplay:webAssetPath": WEB_FIXTURE,
};

export function testApp(context: Record<string, unknown> = {}, outdir?: string): App {
  return new App({
    context: { ...TEST_CONTEXT, ...context },
    ...(outdir === undefined ? {} : { outdir }),
  });
}
