#!/usr/bin/env node
/*
 * Local convenience: reads each package's coverage/coverage-summary.json
 * (written by `npm run test:coverage`) and writes build/coverage/index.html
 * with one row per package. It runs no tests itself.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PACKAGES = ["backend", "web-app", "cdk"];
const METRICS = ["lines", "branches", "functions", "statements"];

/** Reads one package's totals, or null when no report exists yet. */
export function readTotals(root, packageName) {
  const path = join(root, packageName, "coverage", "coverage-summary.json");
  if (!existsSync(path)) return null;
  const summary = JSON.parse(readFileSync(path, "utf8"));
  return Object.fromEntries(METRICS.map((metric) => [metric, summary.total[metric].pct]));
}

/** Renders the rollup page for a map of package name to totals (or null). */
export function renderPage(totalsByPackage) {
  const header = METRICS.map((metric) => `<th>${metric}</th>`).join("");
  const rows = Object.entries(totalsByPackage)
    .map(([name, totals]) => {
      const link = `<a href="../../${name}/coverage/index.html">${name}</a>`;
      if (totals === null) return `<tr><td>${link}</td><td colspan="4">not yet generated</td></tr>`;
      const cells = METRICS.map((metric) => `<td>${totals[metric]}%</td>`).join("");
      return `<tr><td>${link}</td>${cells}</tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>All Play coverage</title>
<style>body{font:18px system-ui;margin:2rem}td,th{padding:.5rem 1rem;text-align:left;border-bottom:1px solid #ccc}</style>
</head><body><h1>All Play coverage</h1>
<table><thead><tr><th>package</th>${header}</tr></thead><tbody>
${rows}
</tbody></table></body></html>
`;
}

function main() {
  const root = process.cwd();
  const totals = Object.fromEntries(PACKAGES.map((name) => [name, readTotals(root, name)]));
  const outputDirectory = join(root, "build", "coverage");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "index.html"), renderPage(totals));
  console.log(`Wrote ${join(outputDirectory, "index.html")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
