/*
 * Architecture boundaries for backend/ (cdk-stacks.md sections 11.1 and 12,
 * game-engine.md section 16). Kept separate from eslint.config.js so the lint
 * tests exercise exactly these config objects.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
/** @type {import("eslint").ESLint.Plugin} */
export const localRules = require("../scripts/eslint/localRules.cjs");

const ENGINE = "src/game-engine";
const DYNAMODB_PACKAGES = ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb"];

const noDynamoDbOutsideDao = {
  paths: DYNAMODB_PACKAGES.map((name) => ({
    name,
    message: "Only dao/ talks to DynamoDB (cdk-stacks.md section 11.1).",
  })),
};

export const boundaries = [
  {
    plugins: { local: localRules },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/dao/**"],
    rules: {
      "no-restricted-imports": ["error", noDynamoDbOutsideDao],
    },
  },
  {
    files: ["src/controller/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          ...noDynamoDbOutsideDao,
          patterns: [
            {
              group: ["**/dao", "**/dao/**"],
              message: "Controllers call services, never DAOs (CLAUDE.md section 5).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/models/api/**/*.ts"],
    rules: {
      "local/import-boundary": [
        "error",
        {
          directory: "src/models/api",
          allowPackages: ["zod"],
          reason: "API contract models are shared with web-app and import only zod.",
        },
      ],
    },
  },
  {
    files: [`${ENGINE}/**/*.ts`],
    rules: {
      "local/import-boundary": [
        "error",
        {
          directory: ENGINE,
          allowPackages: ["zod"],
          reason: "The game engine is isolated (game-engine.md section 16).",
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "The engine reads no clock (game-engine.md section 7.5)." },
        { name: "process", message: "The engine reads no environment." },
        { name: "console", message: "The engine performs no I/O." },
        { name: "fetch", message: "The engine performs no I/O." },
        { name: "setTimeout", message: "The engine is synchronous and pure." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use the seeded generator in game-engine/random.",
        },
        {
          object: "crypto",
          property: "getRandomValues",
          message: "Use the seeded generator in game-engine/random.",
        },
        {
          object: "crypto",
          property: "randomUUID",
          message: "Use the seeded generator in game-engine/random.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    ignores: [`${ENGINE}/**`, "tests/game-engine/**"],
    rules: {
      "local/entry-only": [
        "error",
        {
          directory: ENGINE,
          entry: `${ENGINE}/index.ts`,
          reason: "Only the engine's public surface is importable (game-engine.md section 8).",
        },
      ],
    },
  },
];
