import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useDocumentPreferences } from "../../src/hooks/useDocumentPreferences";
import { tierAtLeast } from "../../src/hooks/usePlayer";
import { usePreferences } from "../../src/hooks/usePreferences";
import { useServices } from "../../src/hooks/useServices";
import { DEFAULT_APP_PREFERENCES } from "../../src/models/api";
import { ServicesContext } from "../../src/services/ServicesContext";
import type { Services } from "../../src/services/types";
import { freshServices } from "../renderApp";

function wrapper(services: Services) {
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <ServicesContext.Provider value={services}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ServicesContext.Provider>
  );
}

describe("usePreferences", () => {
  it("resolves game overrides over application preferences", async () => {
    const services = freshServices();
    await services.preferences.patchApp({ zoomLevel: 1.5, theme: "DARK" });
    await services.preferences.patchGame("spider-solitaire", { overrides: { zoomLevel: 2 } });
    const { result } = renderHook(() => usePreferences("spider-solitaire"), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.preferences).toMatchObject({ zoomLevel: 2, theme: "DARK" });
  });

  it("updates optimistically and saves application and game changes", async () => {
    const services = freshServices();
    const { result } = renderHook(() => usePreferences("spider-solitaire"), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    act(() => {
      result.current.updateApp({ theme: "HIGH_CONTRAST" });
      result.current.updateGame({ helpSeen: true });
    });
    await waitFor(() => {
      expect(result.current.preferences.theme).toBe("HIGH_CONTRAST");
      expect(result.current.game.helpSeen).toBe(true);
    });
    expect((await services.preferences.get()).games["spider-solitaire"]?.helpSeen).toBe(true);
  });

  it("returns defaults before loading and ignores game updates without a game", async () => {
    const services = freshServices();
    const { result } = renderHook(() => usePreferences(), { wrapper: wrapper(services) });
    expect(result.current.preferences).toEqual(DEFAULT_APP_PREFERENCES);
    act(() => {
      result.current.updateGame({ helpSeen: true });
      result.current.updateApp({ zoomLevel: 3 });
    });
    await waitFor(() => {
      expect(result.current.preferences.zoomLevel).toBe(3);
    });
    expect((await services.preferences.get()).games).toEqual({});
  });
});

describe("useServices", () => {
  it("requires the services context", () => {
    expect(() => renderHook(() => useServices())).toThrow(/ServicesContext/);
  });
});

describe("tierAtLeast", () => {
  it("orders tiers", () => {
    expect(tierAtLeast("ADMIN", "PLAYER")).toBe(true);
    expect(tierAtLeast("PLAYER_PLUS", "PLAYER")).toBe(true);
    expect(tierAtLeast("GUEST", "PLAYER")).toBe(false);
    expect(tierAtLeast("PLAYER", "ADMIN")).toBe(false);
  });
});

describe("useDocumentPreferences", () => {
  it("writes theme, motion and zoom to the document root", () => {
    renderHook(() => {
      useDocumentPreferences({
        ...DEFAULT_APP_PREFERENCES,
        theme: "FOUR_COLOR",
        zoomLevel: 2,
        reducedMotion: "ON",
      });
    });
    const root = document.documentElement;
    expect(root.dataset["theme"]).toBe("FOUR_COLOR");
    expect(root.dataset["motion"]).toBe("ON");
    expect(root.style.fontSize).toBe("200%");
  });
});
