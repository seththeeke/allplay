import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../src/services/errors";
import { freshServices, renderApp } from "../renderApp";

const ME = {
  playerId: "GUEST#g",
  kind: "GUEST" as const,
  tier: "GUEST" as const,
  displayName: null,
  email: null,
};

describe("game limits", () => {
  it("shows the games left on the home page and the game page", async () => {
    const services = freshServices();
    services.player.me = () =>
      Promise.resolve({
        ...ME,
        gameAllowance: { limit: 5, period: "DAY", used: 2, resetsAt: "2026-11-29T00:00:00.000Z" },
      });
    renderApp("/", services);
    expect(await screen.findByText("3 of 5 games left today")).toBeInTheDocument();
  });

  it("replaces New game with the limit message when no games are left", async () => {
    const services = freshServices();
    services.player.me = () =>
      Promise.resolve({
        ...ME,
        gameAllowance: { limit: 5, period: "DAY", used: 5, resetsAt: "2026-11-29T00:00:00.000Z" },
      });
    renderApp("/spider", services);
    await screen.findByRole("region", { name: "Card table" });
    expect(
      await screen.findAllByText("You have played your 5 games today. Come back tomorrow."),
    ).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "New game" })).not.toBeInTheDocument();
    expect(screen.getByText("0 of 5 games left today")).toBeInTheDocument();
  });

  it("says why no game was dealt when the server refuses the start", async () => {
    const services = freshServices();
    services.sessions.current = () => Promise.resolve(null);
    services.sessions.start = () =>
      Promise.reject(
        new ApiRequestError(429, {
          code: "GAME_LIMIT_REACHED",
          message: "You have played your 5 games today. Come back tomorrow.",
        }),
      );
    renderApp("/spider", services);
    expect(
      await screen.findByText("You have played your 5 games today. Come back tomorrow."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dealing the cards...")).not.toBeInTheDocument();
  });
});
