import { createInterface } from "node:readline";
import { runCli, type CliIo } from "./main";

/**
 * Entry point of the `game-engine-cli` bundle: wires the loop to the
 * terminal. Lines are read through readline's async iterator, which buffers
 * input, so piped or pasted commands are never dropped.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const terminal = createInterface({ input: process.stdin, terminal: false });
  const lines = terminal[Symbol.asyncIterator]();
  const io: CliIo = {
    write: (text) => {
      process.stdout.write(text);
    },
    read: async (prompt) => {
      process.stdout.write(prompt);
      const next = await lines.next();
      return next.done === true ? null : next.value;
    },
  };
  try {
    return await runCli(argv, io);
  } finally {
    terminal.close();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
