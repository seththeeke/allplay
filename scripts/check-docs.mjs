#!/usr/bin/env node
/*
 * Fails when any tracked text file contains an emoji. CLAUDE.md and every
 * spec forbid emojis and icons in code and docs; this script is the
 * enforcement, run by `npm run lint` at the repo root and in CI.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { listRepoFiles } from "./repo-files.mjs";

const CHECKED_EXTENSIONS = [
  ".md", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".swift", ".yml", ".yaml", ".txt",
];

/* Emoji_Presentation covers characters that render as emoji by default; U+FE0F forces emoji rendering of the rest. */
const EMOJI_PATTERN = /[\p{Emoji_Presentation}\u{FE0F}]/u;

/** Returns one finding per line of `text` that contains an emoji. */
export function findEmoji(text) {
  const findings = [];
  text.split("\n").forEach((line, index) => {
    const match = EMOJI_PATTERN.exec(line);
    if (match) findings.push({ line: index + 1, column: match.index + 1, character: match[0] });
  });
  return findings;
}

/** True when the path has an extension this check covers. */
export function isChecked(path) {
  return CHECKED_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function trackedFiles() {
  return listRepoFiles().filter(isChecked);
}

function main() {
  let failures = 0;
  for (const path of trackedFiles()) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const finding of findEmoji(text)) {
      failures += 1;
      const codePoint = finding.character.codePointAt(0).toString(16).toUpperCase();
      console.error(`${path}:${finding.line}:${finding.column} emoji U+${codePoint} is not allowed`);
    }
  }
  if (failures > 0) {
    console.error(`check-docs: ${failures} emoji found. Remove them (CLAUDE.md section 6).`);
    process.exit(1);
  }
  console.log("check-docs: no emojis found");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
