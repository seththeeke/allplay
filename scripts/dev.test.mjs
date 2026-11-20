import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAllPlayProcesses } from "./dev.mjs";

const root = "/work/allplay";

test("stops only this checkout's local server and Vite processes", () => {
  const psLines = [
    "  101 node /work/allplay/web-app/node_modules/.bin/vite",
    "  102 node /work/allplay/backend/node_modules/.bin/tsx src/local/start.ts",
    "  103 node /work/other/web/node_modules/.bin/vite preview --port 4317",
    "  104 node /work/allplay/backend/node_modules/.bin/vitest run",
    "  105 node /work/allplay-copy/web-app/node_modules/.bin/vite",
    "  106 npm run dev:server /work/allplay",
    "  107 /work/allplay/backend/.local/kokoro/venv/bin/python /work/allplay/backend/src/local/kokoro/worker.py m v",
    "garbage line",
  ];
  assert.deepEqual(selectAllPlayProcesses({ psLines, root, self: 106 }), [101, 102, 107]);
});

test("adds port listeners whose working directory is inside the checkout", () => {
  const cwd = { 201: "/work/allplay/backend", 202: "/work/other", 203: "/work/allplay" };
  assert.deepEqual(
    selectAllPlayProcesses({
      psLines: [],
      root,
      portPids: [201, 202, 203, 204],
      cwdOf: (pid) => cwd[pid] ?? null,
      self: 1,
    }),
    [201, 203],
  );
});
