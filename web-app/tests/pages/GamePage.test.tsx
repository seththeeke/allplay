import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createServices } from "../../src/services/createServices";
import { createMemoryStore } from "../../src/services/memory/memoryStore";
import type { Services } from "../../src/services/types";
import { LOCAL_CONFIG, renderApp } from "../renderApp";
import { act } from "@testing-library/react";
import { pauseSignal } from "../../src/services/pauseSignal";

const seeded = (): Services => createServices(LOCAL_CONFIG, createMemoryStore(null), () => 7);

async function openSpider(services: Services = seeded()) {
  renderApp("/spider", services);
  await screen.findByRole("region", { name: "Card table" });
  return services;
}

describe("game page", () => {
  it("starts a game on a direct link and shows the full table", async () => {
    await openSpider();
    expect(screen.getByRole("heading", { level: 1, name: "Spider Solitaire" })).toBeInTheDocument();
    expect(screen.getByText("one suit, standard deal")).toBeInTheDocument();
    const table = screen.getByRole("region", { name: "Card table" });
    expect(within(table).getAllByRole("region", { name: /^column \d+, \d+ cards/ })).toHaveLength(
      10,
    );
    expect(
      within(table).getByRole("region", { name: "Completed runs: 0 of 8" }),
    ).toBeInTheDocument();
    expect(within(table).getAllByRole("img", { name: "face-down card" })).toHaveLength(44);
    expect(screen.getByRole("button", { name: "Deal (5 left)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("deals, undoes and starts a new game", async () => {
    const user = userEvent.setup();
    await openSpider();
    await user.click(screen.getByRole("button", { name: "Deal (5 left)" }));
    expect(await screen.findByRole("button", { name: "Deal (4 left)" })).toBeInTheDocument();
    expect(screen.getByText("499")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "Deal (5 left)" })).toBeInTheDocument();
    expect(screen.getByText("498")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New game" }));
    await waitFor(() => {
      expect(screen.getByText("500")).toBeInTheDocument();
    });
  });

  it("resumes the game in progress", async () => {
    const services = seeded();
    const started = await services.sessions.start("spider-solitaire", { suits: 4 });
    await services.sessions.apply(started.session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
      source: "POINTER",
    });
    await openSpider(services);
    expect(screen.getByText("four suits, standard deal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deal (4 left)" })).toBeInTheDocument();
  });

  it("shows a hint and highlights the cards it moves", async () => {
    const user = userEvent.setup();
    await openSpider();
    await user.click(screen.getByRole("button", { name: "Hint" }));
    expect(await screen.findByText(/^Move .* from column \d+ to/)).toBeInTheDocument();
    expect(document.querySelectorAll(".outline-highlight").length).toBeGreaterThanOrEqual(2);
  });

  it("offers undo and a new game from the blocked banner", async () => {
    const user = userEvent.setup();
    const services = seeded();
    const started = await services.sessions.start("spider-solitaire");
    await services.sessions.apply(started.session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
      source: "POINTER",
    });
    const current = services.sessions.current.bind(services.sessions);
    services.sessions.current = async (gameId) => {
      const envelope = await current(gameId);
      if (envelope !== null)
        envelope.view.status = { status: "IN_PROGRESS", blocked: true, canUndo: true };
      return envelope;
    };
    await openSpider(services);
    const banner = screen.getByRole("status");
    await user.click(within(banner).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "Deal (5 left)" })).toBeInTheDocument();
    services.sessions.current = current;
  });

  it("starts a new game from the won banner", async () => {
    const user = userEvent.setup();
    const services = seeded();
    const current = services.sessions.current.bind(services.sessions);
    services.sessions.current = async (gameId) => {
      const envelope = (await current(gameId)) ?? (await services.sessions.start(gameId));
      envelope.session.status = "WON";
      return envelope;
    };
    await openSpider(services);
    await user.click(within(screen.getByRole("status")).getByRole("button", { name: "New game" }));
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("hides the table and shows the paused banner while the andon cord is pulled", async () => {
    await openSpider();
    act(() => {
      pauseSignal.set(true);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("All Play is paused right now.");
    expect(screen.queryByRole("region", { name: "Card table" })).not.toBeInTheDocument();
    act(() => {
      pauseSignal.set(false);
    });
    expect(await screen.findByRole("region", { name: "Card table" })).toBeInTheDocument();
    expect(screen.queryByText("All Play is paused right now.")).not.toBeInTheDocument();
  });
});
