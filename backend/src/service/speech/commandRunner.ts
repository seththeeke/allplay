import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a local program; injected so speech providers are testable without the binaries. */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

export const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

/** True when a path exists and is readable. */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes the audio to a private temporary file, runs `work`, then deletes the file. */
export async function withTempWav<T>(
  wav: Uint8Array,
  work: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "allplay-speech-"));
  const path = join(dir, "clip.wav");
  try {
    await writeFile(path, wav);
    return await work(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
