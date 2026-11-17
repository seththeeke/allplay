import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../../test-data/games";
import { variantLabel } from "../../src/pages/StatsPage";
import { createServices } from "../../src/services/createServices";
import { createMemoryStore } from "../../src/services/memory/memoryStore";
import { LOCAL_CONFIG, renderApp } from "../renderApp";

describe("settings page", () => {
  it("saves every change immediately and applies it", async () => {
    const user = userEvent.setup();
    const { services } = renderApp("/settings");
    await screen.findByRole("heading", { level: 2, name: "Text and card size: 125%" });
    await user.click(screen.getByRole("button", { name: "Bigger" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "Text and card size: 150%" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Size saved.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Smaller" }));
    await user.click(screen.getByRole("radio", { name: "Four-color deck" }));
    await user.click(screen.getByRole("switch", { name: "Make voice moves right away" }));
    await user.click(screen.getByRole("switch", { name: "Speak to me" }));
    await user.click(screen.getByRole("radio", { name: "Slow" }));
    await user.click(screen.getByRole("radio", { name: "Long pause" }));
    await user.click(screen.getByRole("radio", { name: "Reduce motion" }));
    expect(screen.getByText("Animations saved.")).toBeInTheDocument();
    await waitFor(async () => {
      expect((await services.preferences.get()).app).toMatchObject({
        zoomLevel: 1.25,
        theme: "FOUR_COLOR",
        autoConfirm: true,
        voiceOutputEnabled: true,
        speechRate: 0.75,
        listenTimeoutMs: 2000,
        reducedMotion: "ON",
      });
    });
    expect(document.documentElement.dataset["theme"]).toBe("FOUR_COLOR");
  });

  it("disables size buttons at the limits", async () => {
    const services = createServices(LOCAL_CONFIG, createMemoryStore(null));
    await services.preferences.patchApp({ zoomLevel: 3 });
    renderApp("/settings", services);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Bigger" })).toBeDisabled();
    });
    await services.preferences.patchApp({ zoomLevel: 1 });
  });
});

describe("stats page", () => {
  it("explains that nothing is finished yet", async () => {
    renderApp("/stats");
    expect(await screen.findByText(/No finished games yet/)).toBeInTheDocument();
  });

  it("shows results after a game is left and another is won", async () => {
    const store = createMemoryStore(null);
    const services = createServices(LOCAL_CONFIG, store, () => 7);
    const first = await services.sessions.start("spider-solitaire");
    await services.sessions.apply(first.session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
      source: "POINTER",
    });
    const second = await services.sessions.start("spider-solitaire", { suits: 2 });
    await services.sessions.abandon(second.session.sessionId, { expectedVersion: 0 });
    renderApp("/stats", services);
    expect(await screen.findByText("one suit, standard deal")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /^Spider Solitaire/ })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0%" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "None yet" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: /two suits/ })).not.toBeInTheDocument();
  });

  it("labels variants, falling back to raw values", () => {
    expect(variantLabel(CATALOG.games[0], "dealStyle=HOYLE;suits=4")).toBe(
      "four suits, Hoyle deal",
    );
    expect(variantLabel(CATALOG.games[0], "suits=3")).toBe("3");
    expect(variantLabel(undefined, "suits=3;colour=red")).toBe("3, red");
    expect(variantLabel(CATALOG.games[0], "colour")).toBe("");
  });
});
