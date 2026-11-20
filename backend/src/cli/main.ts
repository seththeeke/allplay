import { randomBytes } from "node:crypto";
import { createInMemoryGameSessionDao } from "../dao/gameSession/inMemoryGameSessionDao";
import { createInMemorySeatAssignmentDao } from "../dao/seatAssignment/inMemorySeatAssignmentDao";
import { createBundledRulesRepository } from "../game-catalog";
import { createGameSessionService } from "../service/gameSession/gameSessionService";
import { parseArgs, USAGE } from "./args";
import { createCliSession, HELP } from "./commands";

/** Terminal input and output, injected so tests can script a session. */
export interface CliIo {
  write(text: string): void;
  /** The next line typed after the prompt, or null at end of input. */
  read(prompt: string): Promise<string | null>;
}

/**
 * Runs `game-engine-cli` (game-engine.md Addendum A): parses arguments,
 * builds the in-memory session service, then loops over typed commands.
 * Returns the process exit code.
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  newSeed = () => randomBytes(16).toString("hex"),
): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === "help") {
    io.write(`${USAGE}\n`);
    return 0;
  }
  if (args.command === "error") {
    io.write(`${args.message}\n\n${USAGE}\n`);
    return 1;
  }
  const repository = createBundledRulesRepository();
  const seed = args.seed;
  const service = createGameSessionService({
    dao: createInMemoryGameSessionDao(),
    seats: createInMemorySeatAssignmentDao(),
    games: (gameId, version) => repository.compiled(gameId, version),
    newSeed: () => seed ?? newSeed(),
  });
  const session = createCliSession(service);
  io.write(`${await session.start()}\n\nType help for commands.\n`);
  for (;;) {
    const line = await io.read("\nspider> ");
    if (line === null) return 0;
    const result = await session.handle(line);
    if (result.output !== "") io.write(`${result.output}\n`);
    if (result.quit === true) return 0;
  }
}

export { HELP };
