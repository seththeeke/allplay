import path from "node:path";
import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { boundaries } from "../../eslint.boundaries.js";

const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    ...(boundaries as Linter.Config[]),
  ],
});

async function ruleIds(relativePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(process.cwd(), relativePath),
  });
  return (result?.messages ?? []).map((message) => message.ruleId ?? "parse-error");
}

describe("cdk boundaries", () => {
  it("allows importing a backend route list file", async () => {
    expect(
      await ruleIds(
        "lib/constructs/ApiBundle.ts",
        'import { gameRoutes } from "../../../backend/src/controller/web-api/game/gameRoutes";',
      ),
    ).toEqual([]);
  });

  it("rejects importing any other backend file", async () => {
    expect(
      await ruleIds(
        "lib/constructs/ApiBundle.ts",
        'import { logger } from "../../../backend/src/logger";',
      ),
    ).toEqual(["no-restricted-imports"]);
    expect(
      await ruleIds(
        "lib/constructs/ApiBundle.ts",
        'import { start } from "../../../backend/src/controller/web-api/game/startSession";',
      ),
    ).toEqual(["no-restricted-imports"]);
  });
});
