import path from "node:path";
import { RuleTester, type Rule } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import { localRules } from "../../eslint.boundaries.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: "module" },
});

const rules = (localRules.rules ?? {}) as Record<string, Rule.RuleModule>;
const rule = (name: string): Rule.RuleModule => {
  const found = rules[name];
  if (found === undefined) throw new Error(`missing rule ${name}`);
  return found;
};

const file = (relative: string): string => path.join(process.cwd(), relative);
const longProse = "word ".repeat(120).trim();

ruleTester.run("comment-format", rule("comment-format"), {
  valid: [
    { code: "/* a short block comment */\nconst a = 1;" },
    {
      code: "/**\n * Describes f.\n * @param x the input\n */\nfunction f(x: number) { return x; }",
    },
    { code: "// eslint-disable-next-line no-console\nconsole.log(1);" },
    {
      code: `/**\n * Short prose.\n * @param x ${longProse}\n */\nfunction f(x: number) { return x; }`,
    },
  ],
  invalid: [
    {
      code: "// explain why\nconst a = 1;",
      output: "/* explain why */\nconst a = 1;",
      errors: [{ messageId: "lineComment" }],
    },
    {
      code: "// first line\n// second line\nconst a = 1;",
      output: "/*\n * first line\n * second line\n */\nconst a = 1;",
      errors: [{ messageId: "lineComment" }],
    },
    {
      code: "const a = 1; // trailing\n// own line\nconst b = 2;",
      output: "const a = 1; /* trailing */\n/* own line */\nconst b = 2;",
      errors: [{ messageId: "lineComment" }, { messageId: "lineComment" }],
    },
    {
      code: `/* ${longProse} ${longProse} */\nconst a = 1;`,
      errors: [{ messageId: "tooLong" }],
    },
  ],
});

ruleTester.run("import-boundary", rule("import-boundary"), {
  valid: [
    {
      code: 'import { a } from "./rules/schema"; import { z } from "zod";',
      filename: file("src/game-engine/index.ts"),
      options: [{ directory: "src/game-engine", allowPackages: ["zod"] }],
    },
    {
      code: 'export * from "../primitives/expressions";',
      filename: file("src/game-engine/rules/schema.ts"),
      options: [{ directory: "src/game-engine" }],
    },
    {
      code: 'const m = await import("./lazy");',
      filename: file("src/game-engine/index.ts"),
      options: [{ directory: "src/game-engine" }],
    },
  ],
  invalid: [
    {
      code: 'import { logger } from "../logger";',
      filename: file("src/game-engine/index.ts"),
      options: [{ directory: "src/game-engine", allowPackages: ["zod"] }],
      errors: [{ messageId: "outside" }],
    },
    {
      code: 'import { readFileSync } from "node:fs";',
      filename: file("src/game-engine/index.ts"),
      options: [{ directory: "src/game-engine", allowPackages: ["zod"] }],
      errors: [{ messageId: "package" }],
    },
    {
      code: 'export { x } from "../../service/thing";',
      filename: file("src/game-engine/rules/schema.ts"),
      options: [{ directory: "src/game-engine", reason: "Isolated." }],
      errors: [{ messageId: "outside" }],
    },
  ],
});

ruleTester.run("entry-only", rule("entry-only"), {
  valid: [
    {
      code: 'import { compileRules } from "../game-engine";',
      filename: file("src/service/gameSession.ts"),
      options: [{ directory: "src/game-engine", entry: "src/game-engine/index.ts" }],
    },
    {
      code: 'import { compileRules } from "../game-engine/index";',
      filename: file("src/service/gameSession.ts"),
      options: [{ directory: "src/game-engine", entry: "src/game-engine/index.ts" }],
    },
    {
      code: 'import { compileRules } from "../game-engine/index.js"; import { z } from "zod";',
      filename: file("src/service/gameSession.ts"),
      options: [{ directory: "src/game-engine", entry: "src/game-engine/index.ts" }],
    },
    {
      code: 'import { random } from "./random/xoshiro";',
      filename: file("src/game-engine/index.ts"),
      options: [{ directory: "src/game-engine", entry: "src/game-engine/index.ts" }],
    },
  ],
  invalid: [
    {
      code: 'import { shuffle } from "../game-engine/random/shuffle";',
      filename: file("src/service/gameSession.ts"),
      options: [{ directory: "src/game-engine", entry: "src/game-engine/index.ts" }],
      errors: [{ messageId: "deepImport" }],
    },
  ],
});
