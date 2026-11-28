import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createMemoryGameService } from "../../src/services/memory/memoryGameService";
import { renderApp } from "../renderApp";

describe("home page", () => {
  it("lists every catalog game as a large tile link", async () => {
    renderApp("/");
    const links = await screen.findAllByRole("link", { name: /Play Spider Solitaire/ });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/spider",
      "/spider/two-suits",
      "/spider/four-suits",
    ]);
    for (const name of [
      "Spider Solitaire",
      "Spider Solitaire: Two Suits",
      "Spider Solitaire: Four Suits",
    ])
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
  });

  it("opens a game from its tile", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: /Spider Solitaire: Two Suits/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Spider Solitaire" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("two suits, standard deal")).toBeInTheDocument();
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
