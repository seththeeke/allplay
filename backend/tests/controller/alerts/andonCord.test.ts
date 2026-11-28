import { describe, expect, it, vi } from "vitest";
import { budgetName, createAndonCordHandler } from "../../../src/controller/alerts/andonCord";
import { createInMemoryRolePolicyStore } from "../../../src/dao/rolePolicy/inMemoryRolePolicyStore";
import { createInMemorySystemFlagDao } from "../../../src/dao/systemFlag/inMemorySystemFlagDao";
import { createLogger } from "../../../src/logger";
import {
  createAndonService,
  identityRoleNames,
  type AndonService,
} from "../../../src/service/andon/andonService";

const MESSAGE =
  "AWS Budget Notification November 28, 2026\nAWS Account 000000000000\n\nDear AWS Customer,\n\nBudget Name: AllPlay-Transcribe\nBudget Type: Cost\n";

const sns = (message: string) => ({ Records: [{ Sns: { Message: message, Subject: "Budget" } }] });

function stage(name: string) {
  const flags = createInMemorySystemFlagDao();
  return {
    flags,
    entry: {
      stage: name,
      andon: createAndonService({
        flags,
        policies: createInMemoryRolePolicyStore(),
        roleNames: identityRoleNames(name),
      }),
    },
  };
}

describe("andon cord handler", () => {
  it("reads the budget name from the notification", () => {
    expect(budgetName(MESSAGE)).toBe("AllPlay-Transcribe");
    expect(budgetName("something else")).toBe("AWS Budgets");
  });

  it("pulls the cord in every stage", async () => {
    const test = stage("Test");
    const prod = stage("Prod");
    await createAndonCordHandler(
      [test.entry, prod.entry],
      createLogger({ write: vi.fn() }),
    )(sns(MESSAGE));
    for (const { flags } of [test, prod]) {
      expect(await flags.get("ANDON")).toMatchObject({
        isAndonCordPulled: true,
        reason: "AllPlay-Transcribe",
        pulledBy: "BUDGET",
      });
    }
  });

  it("still pulls the other stages when one fails, then rethrows for a retry", async () => {
    const prod = stage("Prod");
    const broken: AndonService = {
      state: () => Promise.reject(new Error("unused")),
      set: () => Promise.reject(new Error("access denied")),
    };
    const handler = createAndonCordHandler(
      [{ stage: "Test", andon: broken }, prod.entry],
      createLogger({ write: vi.fn() }),
    );
    await expect(handler(sns(MESSAGE))).rejects.toThrow("access denied");
    expect((await prod.flags.get("ANDON"))?.isAndonCordPulled).toBe(true);
  });

  it("ignores an event that is not an SNS delivery", async () => {
    const test = stage("Test");
    const write = vi.fn();
    await createAndonCordHandler([test.entry], createLogger({ write }))({ hello: "world" });
    expect(await test.flags.get("ANDON")).toBeNull();
    expect(String(write.mock.calls[0]?.[1])).toContain("ANDON_EVENT_UNREADABLE");
  });
});
