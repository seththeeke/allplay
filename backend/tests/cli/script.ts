import { runCli, type CliIo } from "../../src/cli/main";

export const SEED = "00000000000000000000000000000001";

/** Runs the CLI with scripted input lines and returns everything it printed and its exit code. */
export async function script(
  argv: string[],
  lines: string[],
): Promise<{ output: string; code: number }> {
  const queue = [...lines];
  let output = "";
  const io: CliIo = {
    write: (text) => {
      output += text;
    },
    read: (prompt) => {
      output += prompt;
      return Promise.resolve(queue.shift() ?? null);
    },
  };
  const code = await runCli(argv, io, () => SEED);
  return { output, code };
}
