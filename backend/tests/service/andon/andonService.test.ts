import { describe, expect, it, vi } from "vitest";
import { createInMemoryRolePolicyStore } from "../../../src/dao/rolePolicy/inMemoryRolePolicyStore";
import { createInMemorySystemFlagDao } from "../../../src/dao/systemFlag/inMemorySystemFlagDao";
import { createLogger } from "../../../src/logger";
import {
  ANDON_DENY_POLICY,
  ANDON_POLICY_NAME,
  andonStagesFrom,
  createAndonGate,
  createAndonService,
  createDeployedAndonGate,
  createDeployedAndonService,
  identityRoleNames,
} from "../../../src/service/andon/andonService";
import { andonFlag } from "../../dao/systemFlag/systemFlagDaoContract";

const AT = new Date("2026-11-28T10:00:00.000Z");

describe("andon service", () => {
  it("names the four Identity Pool roles of a stage", () => {
    expect(identityRoleNames("Prod")).toEqual([
      "AllPlay-GuestRole-Prod",
      "AllPlay-PlayerRole-Prod",
      "AllPlay-PlayerPlusRole-Prod",
      "AllPlay-AdminRole-Prod",
    ]);
  });

  it("reads a cord never pulled, pulls it with the deny policy, and releases it", async () => {
    const policies = createInMemoryRolePolicyStore();
    const andon = createAndonService({
      flags: createInMemorySystemFlagDao(),
      policies,
      roleNames: identityRoleNames("Test"),
      now: () => AT,
    });
    expect(await andon.state()).toEqual({
      pulled: false,
      reason: null,
      pulledBy: null,
      changedAt: null,
    });
    expect(await andon.set({ pulled: true, reason: "AllPlay-Polly", pulledBy: "BUDGET" })).toEqual({
      pulled: true,
      reason: "AllPlay-Polly",
      pulledBy: "BUDGET",
      changedAt: AT.toISOString(),
    });
    expect(policies.policies.size).toBe(4);
    expect(policies.policies.get(`AllPlay-GuestRole-Test/${ANDON_POLICY_NAME}`)).toEqual(
      ANDON_DENY_POLICY,
    );
    const released = await andon.set({
      pulled: false,
      reason: "Released by an admin",
      pulledBy: "ADMIN",
      changedBy: "ACCT#admin",
    });
    expect(released.pulled).toBe(false);
    expect(policies.policies.size).toBe(0);
  });

  it("builds the deployed service and the stage list from the environment", () => {
    expect(createDeployedAndonService({ SYSTEM_FLAGS_TABLE: "t", STAGE: "Test" })).toHaveProperty(
      "set",
    );
    expect(createDeployedAndonService({})).toHaveProperty("state");
    const stages = andonStagesFrom({
      ANDON_TARGETS: JSON.stringify([
        { stage: "Test", table: "AllPlay-SystemFlags-Test" },
        { stage: "Prod", table: "AllPlay-SystemFlags-Prod" },
      ]),
    });
    expect(stages.map((entry) => entry.stage)).toEqual(["Test", "Prod"]);
    expect(() => andonStagesFrom({})).toThrow();
  });
});

describe("andon gate", () => {
  const logger = createLogger({ write: vi.fn() });

  it("caches the flag for the cache time", async () => {
    const flags = createInMemorySystemFlagDao();
    let clock = 0;
    const gate = createAndonGate(flags, logger, 30_000, () => clock);
    expect(await gate.isPulled()).toBe(false);
    await flags.put(andonFlag(true, AT.toISOString()));
    clock = 29_999;
    expect(await gate.isPulled()).toBe(false);
    clock = 30_000;
    expect(await gate.isPulled()).toBe(true);
  });

  it("lets play continue when the flag cannot be read", async () => {
    const write = vi.fn();
    const gate = createAndonGate(
      { get: () => Promise.reject(new Error("throttled")) },
      createLogger({ write }),
    );
    expect(await gate.isPulled()).toBe(false);
    expect(String(write.mock.calls[0]?.[1])).toContain("ANDON_FLAG_UNREADABLE");
  });

  it("is built only where a flag table is named", () => {
    expect(createDeployedAndonGate(logger, {})).toBeUndefined();
    expect(createDeployedAndonGate(logger, { SYSTEM_FLAGS_TABLE: "" })).toBeUndefined();
    expect(createDeployedAndonGate(logger, { SYSTEM_FLAGS_TABLE: "t" })).toHaveProperty("isPulled");
  });
});
