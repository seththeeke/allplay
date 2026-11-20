/** Parsed command line (game-engine.md Addendum A.1). */
export type CliArgs =
  { command: "help" } | { command: "start"; seed?: string } | { command: "error"; message: string };

export const USAGE = [
  "Usage: game-engine-cli start --spider [--seed <32 hex characters>]",
  "",
  "Starts a one-suit Spider Solitaire game in memory and reads commands from the terminal.",
].join("\n");

export function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h"))
    return { command: "help" };
  const [command, ...rest] = argv;
  if (command !== "start")
    return { command: "error", message: `Unknown command: ${String(command)}` };
  if (!rest.includes("--spider")) return { command: "error", message: "Choose a game: --spider" };
  const seedAt = rest.indexOf("--seed");
  if (seedAt === -1) return { command: "start" };
  const seed = rest[seedAt + 1] ?? "";
  if (!/^[0-9a-f]{32}$/.test(seed))
    return { command: "error", message: "--seed takes 32 lowercase hex characters" };
  return { command: "start", seed };
}
