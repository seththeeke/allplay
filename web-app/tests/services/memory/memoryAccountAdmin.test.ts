import { describe, expect, it } from "vitest";
import { PASSWORD_RULE } from "../../../src/models/api";
import { createMemoryAdminService } from "../../../src/services/memory/memoryAdminService";
import { createMemoryPlayerService } from "../../../src/services/memory/memoryPlayerService";
import { createMemoryStore } from "../../../src/services/memory/memoryStore";

const TODAY = new Date("2026-12-02T15:00:00.000Z");

describe("memory player service account flows", () => {
  it("signs in with providers and confirms sign-up codes", async () => {
    const players = createMemoryPlayerService(createMemoryStore(null));
    expect((await players.signInWithProvider("APPLE")).email).toBe("apple.player@example.com");
    await expect(players.signUp("pat@example.com", "weak")).rejects.toThrow(PASSWORD_RULE);
    await expect(players.signUp("pat@example.com", "Spider2026")).resolves.toBeUndefined();
    await expect(players.confirmSignUp("pat@example.com", "12ab")).rejects.toThrow(/6-digit code/);
    expect((await players.confirmSignUp("pat@example.com", " 123456 ")).tier).toBe("PLAYER");
  });

  it("resets passwords and deletes accounts", async () => {
    const players = createMemoryPlayerService(createMemoryStore(null));
    await expect(players.requestPasswordReset("pat@example.com")).resolves.toBeUndefined();
    await expect(
      players.confirmPasswordReset("pat@example.com", "1", "Spider2026"),
    ).rejects.toThrow(/6-digit code/);
    await expect(players.confirmPasswordReset("pat@example.com", "123456", "weak")).rejects.toThrow(
      PASSWORD_RULE,
    );
    await expect(
      players.confirmPasswordReset("pat@example.com", "123456", "Spider2026"),
    ).resolves.toBeUndefined();
    await players.signIn("pat@example.com", "Spider2026");
    expect((await players.deleteAccount()).kind).toBe("GUEST");
    expect((await players.me()).kind).toBe("GUEST");
  });
});

describe("memory admin service", () => {
  it("filters metrics by date range", async () => {
    const admin = createMemoryAdminService(() => TODAY);
    const { days } = await admin.metrics("2026-11-26", "2026-12-02");
    expect(days.map((day) => day.period)).toEqual([
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
  });

  it("lists failures for a day and puts a started deployment first", async () => {
    const admin = createMemoryAdminService(() => TODAY);
    expect(
      (await admin.failures("2026-12-02")).decisions.every((row) =>
        row.createdAt.startsWith("2026-12-02"),
      ),
    ).toBe(true);
    expect((await admin.deployments()).deployments).toHaveLength(3);
    const { executionId } = await admin.startDeployment();
    const [first] = (await admin.deployments()).deployments;
    expect(first).toMatchObject({ executionId, status: "IN_PROGRESS", trigger: "ADMIN" });
  });

  it("uses the current time by default", async () => {
    expect((await createMemoryAdminService().deployments()).deployments).toHaveLength(3);
  });
});
