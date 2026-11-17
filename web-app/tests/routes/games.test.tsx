import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createMemoryGameService } from "../../src/services/memory/memoryGameService";
import { renderApp } from "../renderApp";

describe("home page", () => {
  it("lists every catalog game as a large tile link", async () => {
    renderApp("/");
    const link = await screen.findByRole("link", { name: /Spider Solitaire/ });
    expect(link).toHaveAttribute("href", "/spider");
    expect(screen.getByRole("heading", { level: 3, name: "Spider Solitaire" })).toBeInTheDocument();
  });

  it("opens a game from its tile", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: /Spider Solitaire/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Spider Solitaire" }),
    ).toBeInTheDocument();
  });
});

describe("direct game routes", () => {
  it.each(["/spider", "/spider/"])("opens Spider Solitaire at %s", async (path) => {
    renderApp(path);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Spider Solitaire" }),
    ).toBeInTheDocument();
  });

  it("answers unknown paths as not found", async () => {
    renderApp("/checkers");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
  });
});

describe("memory game service", () => {
  it("serves the validated catalog", async () => {
    const { games } = await createMemoryGameService().list();
    expect(games.map((game) => game.path)).toEqual(["/spider"]);
  });
});
