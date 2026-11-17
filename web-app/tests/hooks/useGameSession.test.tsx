import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { toEnvelope } from "../../test-data/spider/envelope";
import { createSpider, parseOptions } from "../../test-data/spider/simulator";
import { useGameSession } from "../../src/hooks/useGameSession";
import { ApiRequestError } from "../../src/services/errors";
import { ServicesContext } from "../../src/services/ServicesContext";
import type { SessionService, Services } from "../../src/services/types";
import { freshServices } from "../renderApp";

const envelope = (version: number) =>
  toEnvelope({
    sessionId: "s1",
    status: "IN_PROGRESS",
    version,
    state: createSpider(parseOptions({}), 7),
  });

function setup(sessions: Partial<SessionService>) {
  const base = freshServices();
  const services: Services = { ...base, sessions: { ...base.sessions, ...sessions } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesContext.Provider value={services}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ServicesContext.Provider>
  );
  return renderHook(() => useGameSession("spider-solitaire"), { wrapper });
}

describe("useGameSession", () => {
  it("does nothing before the session loads", async () => {
    const { result } = setup({ current: () => new Promise(() => undefined) });
    await act(async () => {
      await result.current.apply("DEAL_ROW", "POINTER");
      await result.current.undo("POINTER");
      await result.current.requestHint();
    });
    expect(result.current.envelope).toBeUndefined();
    expect(result.current.message).toBeNull();
  });

  it("re-renders from the current envelope a version conflict carries", async () => {
    const current = envelope(5);
    const { result } = setup({
      current: () => Promise.resolve(envelope(0)),
      apply: () =>
        Promise.reject(
          new ApiRequestError(409, {
            code: "VERSION_CONFLICT",
            message: "The game has changed",
            current,
          }),
        ),
    });
    await waitFor(() => {
      expect(result.current.envelope?.session.version).toBe(0);
    });
    await act(() => result.current.apply("DEAL_ROW", "POINTER"));
    expect(result.current.envelope?.session.version).toBe(5);
    expect(result.current.message).toBe("The game has changed");
  });

  it("reports API errors without an envelope and unexpected failures", async () => {
    const { result } = setup({
      current: () => Promise.resolve(envelope(0)),
      undo: () =>
        Promise.reject(
          new ApiRequestError(404, { code: "NOT_FOUND", message: "Session not found" }),
        ),
      apply: () => Promise.reject(new Error("network")),
    });
    await waitFor(() => {
      expect(result.current.envelope).toBeDefined();
    });
    await act(() => result.current.undo("KEYBOARD"));
    expect(result.current.message).toBe("Session not found");
    await act(() => result.current.apply("DEAL_ROW", "KEYBOARD"));
    expect(result.current.message).toBe("Something went wrong. Please try again.");
  });

  it("starts a new game with chosen options and remembers them", async () => {
    const start = vi.fn((_gameId: string, options?: Record<string, unknown>) =>
      Promise.resolve({
        ...envelope(0),
        session: { ...envelope(0).session, options: (options ?? {}) as never },
      }),
    );
    const { result } = setup({ current: () => Promise.resolve(null), start });
    await waitFor(() => {
      expect(result.current.envelope).toBeDefined();
    });
    await act(() => result.current.newGame({ suits: 4 }));
    expect(start).toHaveBeenLastCalledWith("spider-solitaire", { suits: 4 });
    await waitFor(() => {
      expect(result.current.envelope?.session.options).toEqual({ suits: 4 });
    });
    act(() => {
      result.current.replace(envelope(9));
    });
    expect(result.current.envelope?.session.version).toBe(9);
  });
});
