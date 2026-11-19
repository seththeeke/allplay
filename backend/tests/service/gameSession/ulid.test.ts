import { describe, expect, it } from "vitest";
import { newUlid } from "../../../src/service/gameSession/ulid";

describe("newUlid", () => {
  it("encodes time then randomness in 26 Crockford base32 characters", () => {
    expect(newUlid(0, new Uint8Array(10))).toBe("0".repeat(26));
    expect(newUlid(1, new Uint8Array(10).fill(255))).toBe(`${"0".repeat(9)}1${"Z".repeat(16)}`);
    expect(newUlid(Date.UTC(2026, 10, 19))).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("sorts by creation time", () => {
    expect(newUlid(1000) < newUlid(2000)).toBe(true);
  });
});
