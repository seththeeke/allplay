import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listRepoFiles, walkFiles } from "./repo-files.mjs";

test("walks a tree without git, skipping build output", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-files-"));
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  mkdirSync(join(root, "cdk", "cdk.out"), { recursive: true });
  writeFileSync(join(root, "README.md"), "a");
  writeFileSync(join(root, "docs", "spec.md"), "b");
  writeFileSync(join(root, "node_modules", "x", "index.js"), "c");
  writeFileSync(join(root, "cdk", "cdk.out", "t.json"), "d");
  assert.deepEqual(walkFiles(root).sort(), ["README.md", join("docs", "spec.md")]);
  assert.deepEqual(listRepoFiles(root).sort(), ["README.md", join("docs", "spec.md")]);
});

test("uses git in a checkout", () => {
  assert.ok(listRepoFiles(process.cwd()).includes("package.json"));
});
