#!/usr/bin/env node
/*
 * Runs every npm script and shell script line in the repo through the same
 * guard Claude's hook uses (.claude/hooks/aws-profile-guard.py), so a script
 * that would call AWS without the allplays profile fails lint, not just a
 * Claude session.
 */
import { spawnSync } from "node:child_process";
import { listRepoFiles } from "./repo-files.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GUARD = join(ROOT, ".claude", "hooks", "aws-profile-guard.py");

/** Runs one command through the guard; returns null when allowed, else the guard's message. */
export function checkCommand(command) {
  const result = spawnSync("python3", [GUARD], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  if (result.status === 0) return null;
  return result.stderr.trim() || `guard exited with status ${String(result.status)}`;
}

/** Commands to check from one tracked file: npm scripts or non-comment shell lines. */
export function commandsIn(path, text) {
  if (path.endsWith("package.json")) {
    const scripts = JSON.parse(text).scripts ?? {};
    return Object.entries(scripts).map(([name, command]) => ({ where: `${path} scripts.${name}`, command }));
  }
  return text
    .split("\n")
    .map((line, index) => ({ where: `${path}:${index + 1}`, command: line.trim() }))
    .filter(({ command }) => command.length > 0 && !command.startsWith("#"));
}

function trackedFiles() {
  return listRepoFiles(ROOT).filter((path) => /(^|\/)package\.json$/.test(path) || path.endsWith(".sh") || path.startsWith(".githooks/"));
}

function main() {
  let failures = 0;
  for (const path of trackedFiles()) {
    const text = readFileSync(join(ROOT, path), "utf8");
    for (const { where, command } of commandsIn(path, text)) {
      const problem = checkCommand(command);
      if (problem !== null) {
        failures += 1;
        console.error(`${where}: ${problem}`);
      }
    }
  }
  if (failures > 0) process.exit(1);
  console.log("check-aws-profile: every script uses the allplays profile");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
