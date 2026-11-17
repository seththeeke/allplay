/*
 * ESLint rules shared by every package (cdk-stacks.md section 12). Each
 * package's eslint.config.js loads this file as the `local` plugin.
 */

/* Tooling directives keep their conventional `//` form. */
const DIRECTIVE_PATTERN =
  /^\s*(eslint-disable|eslint-enable|eslint-env|eslint\b|@ts-check|@ts-nocheck|@ts-ignore|@ts-expect-error|prettier-ignore|istanbul|c8|v8|#region|#endregion|\/ <reference)/;
const MAX_PROSE_LENGTH = 500;

function lineTextBefore(sourceCode, comment) {
  const lineText = sourceCode.lines[comment.loc.start.line - 1] ?? "";
  return lineText.slice(0, comment.loc.start.column);
}

function isOwnLine(sourceCode, comment) {
  return lineTextBefore(sourceCode, comment).trim() === "";
}

/*
 * Groups adjacent own-line `//` comments with the same indentation into one
 * run, so a multi-line `//` paragraph is reported and fixed as one block
 * comment. A trailing comment after code is always its own run.
 */
function groupLineCommentRuns(sourceCode, comments) {
  const runs = [];
  let current = [];
  for (const comment of comments) {
    if (comment.type !== "Line" || DIRECTIVE_PATTERN.test(comment.value)) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    const previous = current[current.length - 1];
    const continuesRun =
      previous !== undefined &&
      isOwnLine(sourceCode, comment) &&
      isOwnLine(sourceCode, previous) &&
      comment.loc.start.line === previous.loc.end.line + 1 &&
      comment.loc.start.column === current[0].loc.start.column;
    if (continuesRun) {
      current.push(comment);
    } else {
      if (current.length > 0) runs.push(current);
      current = [comment];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function mergedBlockText(indent, comments) {
  const texts = comments.map((comment) => comment.value.trim());
  if (texts.length === 1) return `/* ${texts[0]} */`;
  return `/*\n${texts.map((text) => `${indent} * ${text}`).join("\n")}\n${indent} */`;
}

/** Comment prose of a block comment, stopping at the first JSDoc tag line. */
function blockProse(value) {
  const lines = [];
  for (const line of value.split("\n")) {
    const trimmed = line.replace(/^\s*\*\s?/, "").trim();
    if (/^@\w+/.test(trimmed)) break;
    lines.push(trimmed);
  }
  return lines.join(" ").trim();
}

/** @type {import("eslint").Rule.RuleModule} */
const commentFormatRule = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "Comments must be block style, with prose of at most 500 characters." },
    schema: [],
    messages: {
      lineComment: "Use a block comment. `//` is allowed only for tooling directives (CLAUDE.md section 6).",
      tooLong: "Comment prose is {{length}} characters, over the 500 character cap (CLAUDE.md section 6).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      Program() {
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type !== "Block") continue;
          const length = blockProse(comment.value).length;
          if (length > MAX_PROSE_LENGTH) {
            context.report({ node: comment, messageId: "tooLong", data: { length: String(length) } });
          }
        }
        for (const run of groupLineCommentRuns(sourceCode, comments)) {
          const first = run[0];
          const last = run[run.length - 1];
          context.report({
            node: first,
            messageId: "lineComment",
            fix: (fixer) =>
              fixer.replaceTextRange(
                [first.range[0], last.range[1]],
                mergedBlockText(lineTextBefore(sourceCode, first), run),
              ),
          });
        }
      },
    };
  },
};

module.exports = {
  meta: { name: "allplay-local-rules" },
  rules: { "comment-format": commentFormatRule },
};
