import { test } from "node:test";
import assert from "node:assert/strict";
import { findEmoji, isChecked } from "./check-docs.mjs";

/* Emoji are built from code points so this test file passes the check it tests. */
const ROCKET = String.fromCodePoint(0x1f680);
const WARNING_AS_EMOJI = String.fromCodePoint(0x26a0, 0xfe0f);

test("finds an emoji with its line and column", () => {
  const findings = findEmoji(`plain line\nship it ${ROCKET} now`);
  assert.deepEqual(findings, [{ line: 2, column: 9, character: ROCKET }]);
});

test("finds a text symbol forced to emoji presentation", () => {
  assert.equal(findEmoji(`warning ${WARNING_AS_EMOJI}`).length, 1);
});

test("allows plain text, arrows and typographic symbols", () => {
  assert.deepEqual(findEmoji("a -> b, (c) 2026, x * y, column 3 to column 7"), []);
});

test("checks source and doc extensions only", () => {
  assert.equal(isChecked("docs/day-0-designs/data-model.md"), true);
  assert.equal(isChecked("backend/src/logger.ts"), true);
  assert.equal(isChecked("web-app/public/card.png"), false);
});
