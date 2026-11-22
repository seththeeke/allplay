import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBusy } from "../../src/hooks/useBusy";

describe("useBusy", () => {
  it("marks the action busy until its call settles, even when it fails", async () => {
    const { result } = renderHook(() => useBusy<"SAVE">());
    let fail: (error: Error) => void = () => undefined;
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current
        .track(
          "SAVE",
          new Promise((_, reject) => {
            fail = reject;
          }),
        )
        .catch(() => undefined);
    });
    expect(result.current.busy).toBe("SAVE");
    await act(async () => {
      fail(new Error("offline"));
      await pending;
    });
    expect(result.current.busy).toBeNull();
  });
});
