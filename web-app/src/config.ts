import { z } from "zod";

/**
 * Stage configuration, written by CDK to /config.json in each stage's bucket
 * (cdk-stacks.md section 6). One build serves every stage.
 */
export const AppConfigSchema = z.object({
  stage: z.enum(["LOCAL", "TEST", "PROD"]),
  dataMode: z.enum(["MEMORY", "LIVE"]),
  region: z.string().min(1).optional(),
  apiUrl: z.url().optional(),
  userPoolId: z.string().min(1).optional(),
  userPoolClientId: z.string().min(1).optional(),
  identityPoolId: z.string().min(1).optional(),
  /* Google and Apple sign-in once the stage's identity providers exist (AA-3); absent means email only. */
  socialProviders: z.array(z.enum(["GOOGLE", "APPLE"])).optional(),
  /* Locally, sign in with the Test stage's Cognito against the local server (authn-authz.md section 11); absent means the mock. */
  localAuth: z.enum(["MOCK", "COGNITO_TEST"]).optional(),
  oauthDomain: z.string().min(1).optional(),
  transcribeVocabularyName: z.string().min(1).optional(),
  /* Voice providers (action-decision.md section 16); absent means the in-memory prototype path. */
  speechInput: z.enum(["TRANSCRIBE", "LOCAL_SERVER", "TYPED"]).optional(),
  speechOutput: z.enum(["POLLY", "LOCAL_SERVER", "BROWSER", "OFF"]).optional(),
  /** The stage's Transcribe custom vocabulary, once the stage has one (cdk-stacks.md section 6). */
  vocabularyName: z.string().min(1).optional(),
  /** `INVITE_ONLY` stages have no guests and no sign-up (productionalization.md section 3); absent means `OPEN`. */
  accessMode: z.enum(["OPEN", "INVITE_ONLY"]).optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export class ConfigLoadError extends Error {
  override readonly name = "ConfigLoadError";
}

type FetchLike = (input: string) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** Fetches and validates /config.json; a missing or malformed file is a hard error. */
export async function loadConfig(
  fetchImpl: FetchLike = (input) => fetch(input),
): Promise<AppConfig> {
  const response = await fetchImpl("/config.json");
  if (!response.ok) {
    throw new ConfigLoadError(`config.json request failed with status ${response.status}`);
  }
  /* A git-ignored config.local.json, written by `npm run dev:aws-auth`, overrides fields locally. */
  const local = await fetchImpl("/config.local.json").catch(() => null);
  const override: unknown = local?.ok === true ? await local.json().catch(() => ({})) : {};
  const parsed = AppConfigSchema.safeParse({
    ...((await response.json()) as object),
    ...(typeof override === "object" && override !== null ? override : {}),
  });
  if (!parsed.success) {
    throw new ConfigLoadError(`config.json is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}
