import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/App";
import type { AppConfig } from "../src/config";
import { createServices } from "../src/services/createServices";
import { createMemoryStore } from "../src/services/memory/memoryStore";
import type { Services } from "../src/services/types";

export const LOCAL_CONFIG: AppConfig = { stage: "LOCAL", dataMode: "MEMORY" };

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
      router={(children) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>}
    />,
  );
  return { ...result, services };
}
