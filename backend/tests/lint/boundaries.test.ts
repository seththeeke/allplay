import path from "node:path";
import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { boundaries } from "../../eslint.boundaries.js";

/* Lints virtual files with exactly the boundary config objects eslint.config.js uses. */
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

describe("backend layering", () => {
  it("rejects a controller importing a DAO", async () => {
    expect(
      await ruleIds(
        "src/controller/web-api/game/startSession.ts",
        'import { put } from "../../../dao/gameSession/gameSessionDao";',
      ),
    ).toEqual(["no-restricted-imports"]);
  });

  it("allows a controller importing a service", async () => {
    expect(
      await ruleIds(
        "src/controller/web-api/game/startSession.ts",
        'import { start } from "../../../service/gameSession/gameSessionService";',
      ),
    ).toEqual([]);
  });

  it("rejects the DynamoDB client outside dao/", async () => {
    expect(
      await ruleIds(
        "src/service/player/playerService.ts",
        'import { DynamoDBClient } from "@aws-sdk/client-dynamodb";',
      ),
    ).toEqual(["no-restricted-imports"]);
    expect(
      await ruleIds(
        "src/controller/web-api/player/getMe.ts",
        'import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";',
      ),
    ).toEqual(["no-restricted-imports"]);
  });

  it("allows the DynamoDB client inside dao/", async () => {
    expect(
      await ruleIds(
        "src/dao/player/playerDao.ts",
        'import { DynamoDBClient } from "@aws-sdk/client-dynamodb";',
      ),
    ).toEqual([]);
  });
});

describe("API contract models", () => {
  it("may import zod and each other only", async () => {
    expect(
      await ruleIds(
        "src/models/api/session.ts",
        'import { z } from "zod"; import { Card } from "./card";',
      ),
    ).toEqual([]);
    expect(
      await ruleIds("src/models/api/session.ts", 'import { logger } from "../../logger";'),
    ).toEqual(["local/import-boundary"]);
    expect(await ruleIds("src/models/api/session.ts", 'import { v4 } from "uuid";')).toEqual([
      "local/import-boundary",
    ]);
  });
});

describe("game engine isolation", () => {
  it("rejects imports from outside the engine and non-zod packages", async () => {
    expect(
      await ruleIds(
        "src/game-engine/interpreter/apply.ts",
        'import { logger } from "../../logger";',
      ),
    ).toEqual(["local/import-boundary"]);
    expect(
      await ruleIds(
        "src/game-engine/interpreter/apply.ts",
        'import { randomBytes } from "node:crypto";',
      ),
    ).toEqual(["local/import-boundary"]);
  });

  it("rejects clocks, randomness and I/O globals", async () => {
    expect(
      await ruleIds("src/game-engine/random/seed.ts", "export const now = Date.now();"),
    ).toEqual(["no-restricted-globals"]);
    expect(
      await ruleIds("src/game-engine/random/seed.ts", "export const r = Math.random();"),
    ).toEqual(["no-restricted-properties"]);
    expect(await ruleIds("src/game-engine/random/seed.ts", 'console.info("x");')).toEqual([
      "no-restricted-globals",
    ]);
    expect(
      await ruleIds("src/game-engine/random/seed.ts", 'export const e = process.env["X"];'),
    ).toEqual(["no-restricted-globals"]);
  });

  it("allows engine-internal imports and zod", async () => {
    expect(
      await ruleIds(
        "src/game-engine/interpreter/apply.ts",
        'import { z } from "zod"; import { s } from "../rules/schema";',
      ),
    ).toEqual([]);
  });

  it("lets the rest of the backend import only the engine entry", async () => {
    expect(
      await ruleIds(
        "src/service/gameSession/gameSessionService.ts",
        'import { compileRules } from "../../game-engine";',
      ),
    ).toEqual([]);
    expect(
      await ruleIds(
        "src/service/gameSession/gameSessionService.ts",
        'import { shuffle } from "../../game-engine/random/shuffle";',
      ),
    ).toEqual(["local/entry-only"]);
  });

  it("lets engine unit tests import engine internals", async () => {
    expect(
      await ruleIds(
        "tests/game-engine/random/shuffle.test.ts",
        'import { shuffle } from "../../../src/game-engine/random/shuffle";',
      ),
    ).toEqual([]);
  });
});
