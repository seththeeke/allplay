import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GAME_HELP_STEPS } from "../../src/pages/helpSteps";
import { freshServices, renderApp } from "../renderApp";

const highlighted = () =>
  document.querySelector("[data-help-highlight]")?.getAttribute("data-help-id");

describe("first-game tour", () => {
  it("walks through every step, highlighting each target, and is not shown again", async () => {
    const user = userEvent.setup();
    const services = freshServices();
    renderApp("/spider", services);
    expect(await screen.findByRole("heading", { level: 2, name: "Talk to play" })).toHaveFocus();
    expect(screen.getByText(`Step 1 of ${String(GAME_HELP_STEPS.length)}`)).toBeInTheDocument();
    expect(highlighted()).toBe("talk");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(highlighted()).toBe("board");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { level: 2, name: "Talk to play" })).toBeInTheDocument();
    for (let step = 1; step < GAME_HELP_STEPS.length; step += 1) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(highlighted()).toBe("settings");
    expect(screen.queryByRole("button", { name: "Skip the tour" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start playing" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { level: 2, name: "Make it easier to see" }),
      ).not.toBeInTheDocument();
    });
    expect(highlighted()).toBeUndefined();
    expect((await services.preferences.get()).games["spider-solitaire"]?.helpSeen).toBe(true);
  });

  it("can be skipped", async () => {
    const user = userEvent.setup();
    renderApp("/spider");
    await user.click(await screen.findByRole("button", { name: "Skip the tour" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { level: 2, name: "Talk to play" }),
      ).not.toBeInTheDocument();
    });
  });

  it("does not appear once seen", async () => {
    const services = freshServices();
    await services.preferences.patchGame("spider-solitaire", { helpSeen: true });
    renderApp("/spider", services);
    await screen.findByRole("region", { name: "Card table" });
    expect(
      screen.queryByRole("heading", { level: 2, name: "Talk to play" }),
    ).not.toBeInTheDocument();
  });
});

describe("help page", () => {
  it("lists commands and keys, and replays a game's tour", async () => {
    const user = userEvent.setup();
    const services = freshServices();
    await services.preferences.patchGame("spider-solitaire", { helpSeen: true });
    renderApp("/help", services);
    expect(screen.getByText('"three to seven"')).toBeInTheDocument();
    expect(screen.getByText("Space")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Show the Spider Solitaire tour" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "Talk to play" }),
    ).toBeInTheDocument();
  });
});
