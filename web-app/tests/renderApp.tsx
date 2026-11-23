import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/App";
import type { AppConfig } from "../src/config";
import { createServices } from "../src/services/createServices";
import { DEFAULT_APP_PREFERENCES } from "../src/models/api";
import { createMemoryStore, type MemoryStore } from "../src/services/memory/memoryStore";
import type { Services } from "../src/services/types";

export const LOCAL_CONFIG: AppConfig = { stage: "LOCAL", dataMode: "MEMORY" };

/** A memory store whose player chose turn-based voice (conversational-ai.md section 2). */
export function turnBasedStore(): MemoryStore {
  const store = createMemoryStore(null);
  store.write("allplay.memory.preferences", {
    app: { ...DEFAULT_APP_PREFERENCES, voiceMode: "TURN_BASED" },
    games: {},
  });
  return store;
}

/** Fresh in-memory services with no browser storage, so tests never share state. */
export function freshServices(): Services {
  return createServices(LOCAL_CONFIG, createMemoryStore(null));
}

export function renderApp(
  path = "/",
  services: Services = freshServices(),
): RenderResult & { services: Services } {
  const result = render(
    <App
      config={LOCAL_CONFIG}
      services={services}
      router={(children) => (
        <MemoryRouter initialEntries={[path]} useTransitions={false}>
          {children}
        </MemoryRouter>
      )}
    />,
  );
  return { ...result, services };
}
