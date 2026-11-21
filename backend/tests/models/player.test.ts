import { describe, expect, it } from "vitest";
import { emailKeyOf, GUEST_RETENTION_SECONDS, guestTtl } from "../../src/models/player";

describe("player keys", () => {
  it("normalizes emails and dates guest expiry 90 days out", () => {
    expect(emailKeyOf("  Pat@Example.COM ")).toBe("pat@example.com");
    expect(guestTtl(new Date("2026-11-21T00:00:00.000Z"))).toBe(
      Date.UTC(2026, 10, 21) / 1000 + GUEST_RETENTION_SECONDS,
    );
    expect(GUEST_RETENTION_SECONDS).toBe(7776000);
  });
});
