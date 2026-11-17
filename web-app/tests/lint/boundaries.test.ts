import path from "node:path";
import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { boundaries } from "../../eslint.boundaries.js";

const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    },
    ...(boundaries as Linter.Config[]),
  ],
});

async function ruleIds(relativePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(process.cwd(), relativePath),
  });
  return (result?.messages ?? []).map((message) => message.ruleId ?? "parse-error");
}

describe("web-app boundaries", () => {
  it("rejects components and pages importing services", async () => {
    expect(
      await ruleIds(
        "src/components/Card.tsx",
        'import { getSession } from "../services/sessionService";',
      ),
    ).toEqual(["no-restricted-imports"]);
    expect(
      await ruleIds(
        "src/pages/GamePage.tsx",
        'import { getSession } from "../services/sessionService";',
      ),
    ).toEqual(["no-restricted-imports"]);
  });

  it("allows components to use hooks", async () => {
    expect(
      await ruleIds("src/components/Card.tsx", 'import { useSession } from "../hooks/useSession";'),
    ).toEqual([]);
  });

  it("allows hooks to use services", async () => {
    expect(
      await ruleIds(
        "src/hooks/useSession.ts",
        'import { getSession } from "../services/sessionService";',
      ),
    ).toEqual([]);
  });

  it("rejects reaching into backend/ instead of the api-models alias", async () => {
    expect(
      await ruleIds(
        "src/hooks/useSession.ts",
        'import { S } from "../../../backend/src/models/api/session";',
      ),
    ).toEqual(["no-restricted-imports"]);
    expect(
      await ruleIds(
        "src/components/Card.tsx",
        'import { S } from "../../../backend/src/models/api/session";',
      ),
    ).toEqual(["no-restricted-imports"]);
    expect(
      await ruleIds("src/hooks/useSession.ts", 'import { S } from "@allplay/api-models/session";'),
    ).toEqual([]);
  });

  it("caps components at 200 lines", async () => {
    const longComponent = Array.from(
      { length: 201 },
      (_, index) => `const v${index} = ${index};`,
    ).join("\n");
    expect(await ruleIds("src/components/Long.tsx", longComponent)).toEqual(["max-lines"]);
    expect(await ruleIds("src/pages/LongPage.tsx", longComponent)).toEqual([]);
  });
});
