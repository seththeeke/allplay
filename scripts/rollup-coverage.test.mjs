import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTotals, renderPage } from "./rollup-coverage.mjs";

test("reads totals from a package's coverage summary", () => {
  const root = mkdtempSync(join(tmpdir(), "allplay-coverage-"));
  mkdirSync(join(root, "backend", "coverage"), { recursive: true });
  const total = { lines: { pct: 97 }, branches: { pct: 95 }, functions: { pct: 100 }, statements: { pct: 96 } };
  writeFileSync(join(root, "backend", "coverage", "coverage-summary.json"), JSON.stringify({ total }));
  assert.deepEqual(readTotals(root, "backend"), { lines: 97, branches: 95, functions: 100, statements: 96 });
  assert.equal(readTotals(root, "cdk"), null);
});

test("renders a row per package and marks missing reports", () => {
  const html = renderPage({
    backend: { lines: 97, branches: 95, functions: 100, statements: 96 },
    cdk: null,
  });
  assert.match(html, /<td>97%<\/td><td>95%<\/td><td>100%<\/td><td>96%<\/td>/);
  assert.match(html, /cdk<\/a><\/td><td colspan="4">not yet generated/);
});
