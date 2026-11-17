/*
 * Boundaries for cdk/ (cdk-stacks.md sections 5 and 12). The only sanctioned
 * import from backend/ is a bundle's import-free route list.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {import("eslint").ESLint.Plugin} */
export const localRules = require("../scripts/eslint/localRules.cjs");

export const boundaries = [
  {
    plugins: { local: localRules },
  },
  {
    files: ["bin/**/*.ts", "lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)backend/(?!src/controller/web-api/[^/]+/[^/]+Routes$)",
              message:
                "cdk/ may import only backend route list files (<bundle>Routes.ts), which import nothing (cdk-stacks.md section 5).",
            },
          ],
        },
      ],
    },
  },
];
