import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const SOURCE_PATH = join("src", "service", "conversation", "personality", "game-speaker.md");

export const PersonalitySchema = z.object({
  persona: z.string().min(1),
  greeting: z.string().min(1),
  welcomeBack: z.string().min(1),
  acknowledgements: z.array(z.string().min(1)).min(1),
  confirm: z.string().includes("{action}"),
  choices: z.string().includes("{options}"),
  notAllowed: z.string().min(1),
  notUnderstood: z.array(z.string().min(1)).min(1),
  unavailable: z.string().min(1),
});
export type Personality = z.infer<typeof PersonalitySchema>;

/** Splits the file at its level two headings; text before the first heading is a note to editors. */
function sections(markdown: string): Map<string, string> {
  const found = new Map<string, string>();
  const parts = markdown.split(/^## +(.+?) *$/m);
  for (let index = 1; index < parts.length; index += 2)
    found.set(parts[index] as string, (parts[index + 1] ?? "").trim());
  return found;
}

/** The items of a bulleted section. */
const bullets = (section: string | undefined): string[] =>
  (section ?? "").split("\n").flatMap((line) => /^- +(.+)$/.exec(line.trim())?.[1] ?? []);

/** Parses the personality file; a missing or malformed section stops the decider from starting. */
export function parsePersonality(markdown: string): Personality {
  const found = sections(markdown);
  return PersonalitySchema.parse({
    persona: found.get("Persona"),
    greeting: found.get("Greeting"),
    welcomeBack: found.get("Welcome Back"),
    acknowledgements: bullets(found.get("Acknowledgements")),
    confirm: found.get("Confirm"),
    choices: found.get("Choices"),
    notAllowed: found.get("Not Allowed"),
    notUnderstood: bullets(found.get("Not Understood")),
    unavailable: found.get("Unavailable"),
  });
}

/**
 * Where the file is: beside the Lambda's bundle when deployed, otherwise in
 * the source tree, from either the backend package or the repository root.
 */
export function personalityPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd: string = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): string {
  const root = env["LAMBDA_TASK_ROOT"];
  if (root !== undefined) return join(root, "game-speaker.md");
  const local = join(cwd, SOURCE_PATH);
  return exists(local) ? local : join(cwd, "backend", SOURCE_PATH);
}

export function loadPersonality(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Personality {
  return parsePersonality(readFileSync(personalityPath(env), "utf8"));
}
