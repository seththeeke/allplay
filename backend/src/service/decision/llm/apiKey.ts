import { readFileSync } from "node:fs";

/** The Claude API key from the environment, else from a git-ignored file (local-development.md section 4). */
export function readApiKey(
  env: Readonly<Record<string, string | undefined>>,
  file: string,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const fromEnv = env["ANTHROPIC_API_KEY"]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  try {
    const fromFile = read(file).trim();
    return fromFile === "" ? undefined : fromFile;
  } catch {
    return undefined;
  }
}
