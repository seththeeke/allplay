/*
 * Lists the repository's files for the repo checks. Uses git when the
 * checkout has history; the pipeline's GitHub source is a zip without .git,
 * so it falls back to walking the tree, skipping ignored build output.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

export const SKIPPED_DIRECTORIES = new Set([
  ".git", "node_modules", "coverage", "dist", "build", "cdk.out", ".vite", "playwright-report", "test-results",
]);

/** Every file under `root`, as paths relative to it, without ignored directories. */
export function walkFiles(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : walkFiles(root, join(dir, entry.name));
    return entry.isFile() ? [relative(root, join(dir, entry.name))] : [];
  });
}

export function listRepoFiles(root = process.cwd()) {
  try {
    const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split("\n").filter((path) => path.length > 0);
  } catch {
    return walkFiles(root);
  }
}
