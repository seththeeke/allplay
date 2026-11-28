import { expect, it } from "vitest";
import type { SystemFlagDao } from "../../../src/dao/systemFlag/systemFlagDao";
import type { SystemFlag } from "../../../src/models/systemFlag";

/** An andon flag written at `at`. */
export function andonFlag(pulled: boolean, at: string, changedBy?: string): SystemFlag {
  return {
    flagId: "ANDON",
    isAndonCordPulled: pulled,
    reason: pulled ? "AllPlay-Polly" : "Released by an admin",
    pulledBy: changedBy === undefined ? "BUDGET" : "ADMIN",
    changedAt: at,
    ...(changedBy === undefined ? {} : { changedBy }),
    entityVersion: 1,
    createdAt: at,
    updatedAt: at,
  };
}

/** Behavior every SystemFlagDao shares. The flag table holds one item, so each run starts from its current state. */
export function systemFlagDaoContract(make: () => SystemFlagDao): void {
  it("writes the andon flag, keeps its first createdAt and reads it back", async () => {
    const dao = make();
    const first = await dao.put(andonFlag(true, "2026-11-28T10:00:00.000Z"));
    expect(first).toMatchObject({ isAndonCordPulled: true, pulledBy: "BUDGET" });
    const second = await dao.put(andonFlag(false, "2026-11-28T11:00:00.000Z", "ACCT#admin"));
    expect(second).toMatchObject({
      isAndonCordPulled: false,
      pulledBy: "ADMIN",
      changedBy: "ACCT#admin",
      createdAt: first.createdAt,
    });
    const third = await dao.put(andonFlag(false, "2026-11-28T12:00:00.000Z"));
    expect(third.changedBy).toBeUndefined();
    expect(await dao.get("ANDON")).toEqual(third);
  });
}
