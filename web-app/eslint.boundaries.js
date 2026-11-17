/*
 * Architecture boundaries for web-app/ (cdk-stacks.md sections 11.2 and 12).
 * Kept separate from eslint.config.js so the lint tests exercise exactly these
 * config objects.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {import("eslint").ESLint.Plugin} */
export const localRules = require("../scripts/eslint/localRules.cjs");

const NO_BACKEND_PATHS = {
  group: ["**/backend/**"],
  message:
    "Import API contract models through @allplay/api-models only (cdk-stacks.md section 11.2).",
};

const NO_SERVICES = {
  group: ["**/services", "**/services/**"],
  message: "Components and pages call hooks, never services (CLAUDE.md section 5).",
};

/* A later config object replaces earlier no-restricted-imports options, so each block lists every pattern it needs. */
export const boundaries = [
  {
    plugins: { local: localRules },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_BACKEND_PATHS] }],
    },
  },
  {
    files: ["src/components/**/*.tsx", "src/pages/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_BACKEND_PATHS, NO_SERVICES] }],
    },
  },
  {
    files: ["src/components/**/*.tsx"],
    rules: {
      "max-lines": ["error", { max: 200, skipBlankLines: false, skipComments: false }],
    },
  },
];
