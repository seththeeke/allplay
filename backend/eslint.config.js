import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { boundaries } from "./eslint.boundaries.js";

export default tseslint.config(
  {
    ignores: ["node_modules", "coverage", "dist", "cli/dist", ".local", "tests/lint/fixtures/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  ...boundaries,
  {
    rules: {
      "local/comment-format": "error",
      "no-console": "error",
      eqeqeq: "error",
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
);
