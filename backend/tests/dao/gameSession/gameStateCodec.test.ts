import { describe, expect, it } from "vitest";
import { decodeGameState, encodeGameState } from "../../../src/dao/gameSession/gameStateCodec";
import { sampleSession } from "./gameSessionDaoContract";

describe("game state codec", () => {
  it("round-trips a Spider state and keeps it under 8 KB", () => {
    const { state } = sampleSession();
    const bytes = encodeGameState(state);
    expect(bytes.byteLength).toBeLessThan(8 * 1024);
    expect(decodeGameState(bytes)).toEqual(state);
  });
});
