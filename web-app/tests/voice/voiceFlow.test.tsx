import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServices } from "../../src/services/createServices";
import { createMemoryStore } from "../../src/services/memory/memoryStore";
import type { Services } from "../../src/services/types";
import { LOCAL_CONFIG, renderApp } from "../renderApp";

const seeded = (): Services => createServices(LOCAL_CONFIG, createMemoryStore(null), () => 7);
const voiceBar = () => screen.getByRole("region", { name: "Voice control" });

async function open(path = "/spider", services: Services = seeded()) {
  const user = userEvent.setup();
  renderApp(path, services);
  if (path === "/spider") await screen.findByRole("region", { name: "Card table" });
  else await screen.findByRole("button", { name: "Talk (Space)" });
  return { user, services };
}

async function say(user: ReturnType<typeof userEvent.setup>, words: string) {
  fireEvent.keyDown(document.body, { key: " " });
  const input = await screen.findByLabelText("Listening. Say what you want to do:");
  expect(input).toHaveFocus();
  await user.type(input, `${words}{Enter}`);
}

describe("voice turns in a game", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proposes a move, highlights it, and applies it on Enter", async () => {
    const { user } = await open();
    await say(user, "deal");
    expect(await within(voiceBar()).findByText("Deal a new row of cards")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Deal (4 left)" })).toBeInTheDocument();
  });

  it("cancels a proposal with Escape and with the Cancel button", async () => {
    const { user } = await open();
    await say(user, "deal");
    await within(voiceBar()).findByText("Deal a new row of cards");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(await within(voiceBar()).findByText("Cancelled.")).toBeInTheDocument();
    await say(user, "deal");
    await user.click(await screen.findByRole("button", { name: "Cancel (Esc)" }));
    expect(screen.getByRole("button", { name: "Deal (5 left)" })).toBeInTheDocument();
  });

  it("accepts a spoken yes and confirms with the Confirm button", async () => {
    const { user } = await open();
    await say(user, "deal");
    await within(voiceBar()).findByText("Deal a new row of cards");
    await say(user, "yes");
    expect(await screen.findByRole("button", { name: "Deal (4 left)" })).toBeInTheDocument();
    await say(user, "deal");
    await user.click(await screen.findByRole("button", { name: "Confirm (Enter)" }));
    expect(await screen.findByRole("button", { name: "Deal (3 left)" })).toBeInTheDocument();
  });

  it("applies moves at once with auto confirm on", async () => {
    const services = seeded();
    await services.preferences.patchApp({ autoConfirm: true });
    const { user } = await open("/spider", services);
    await say(user, "deal");
    expect(await screen.findByRole("button", { name: "Deal (4 left)" })).toBeInTheDocument();
  });

  it("explains when it does not understand and when nothing was said", async () => {
    const { user } = await open();
    await say(user, "sing me a song");
    expect(await within(voiceBar()).findByText(/I'm not sure what you mean/)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: " " });
    await user.type(await screen.findByLabelText("Listening. Say what you want to do:"), "{Enter}");
    expect(await within(voiceBar()).findByText("I didn't hear anything.")).toBeInTheDocument();
  });

  it("stops listening with Escape and ignores keys typed into the field", async () => {
    const { user } = await open();
    fireEvent.keyDown(document.body, { key: " " });
    const input = await screen.findByLabelText("Listening. Say what you want to do:");
    await user.type(input, "three to");
    expect(input).toHaveValue("three to");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Listening. Say what you want to do:")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "2" });
    fireEvent.keyDown(document.body, { key: " ", ctrlKey: true });
    expect(screen.queryByLabelText("Listening. Say what you want to do:")).not.toBeInTheDocument();
  });

  it("starts listening from the Talk button and cancels from the panel", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Talk (Space)" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Talk (Space)" })).toBeInTheDocument();
  });

  it("reports failures from the decider and from resolution", async () => {
    const services = seeded();
    const decide = services.decisions.decide.bind(services.decisions);
    services.decisions.resolve = () => Promise.reject(new Error("offline"));
    const { user } = await open("/spider", services);
    await say(user, "deal");
    await within(voiceBar()).findByText("Deal a new row of cards");
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(
      await within(voiceBar()).findByText("That move could not be made. Please try again."),
    ).toBeInTheDocument();
    services.decisions.decide = () => Promise.reject(new Error("offline"));
    await say(user, "deal");
    expect(
      await within(voiceBar()).findByText("Something went wrong. Please try again."),
    ).toBeInTheDocument();
    services.decisions.decide = decide;
  });
});

describe("voice application actions", () => {
  it("zooms and changes theme", async () => {
    const { user } = await open("/");
    await say(user, "zoom in");
    await waitFor(() => {
      expect(document.documentElement.style.fontSize).toBe("150%");
    });
    await say(user, "zoom out");
    await say(user, "zoom out");
    await waitFor(() => {
      expect(document.documentElement.style.fontSize).toBe("100%");
    });
    await say(user, "reset zoom");
    await say(user, "high contrast theme");
    await waitFor(() => {
      expect(document.documentElement.dataset["theme"]).toBe("HIGH_CONTRAST");
    });
    expect(document.documentElement.style.fontSize).toBe("125%");
  });

  it.each([
    ["show my stats", "Your statistics"],
    ["open settings", "Settings"],
    ["help", "Help"],
    ["sign in", "Sign in"],
  ])("navigates for %s", async (words, heading) => {
    const { user } = await open("/");
    await say(user, words);
    if (words === "sign in") fireEvent.keyDown(document.body, { key: "Enter" });
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("opens a game and goes home", async () => {
    const { user } = await open("/stats");
    await say(user, "play spider");
    await screen.findByRole("region", { name: "Card table" });
    await say(user, "go home");
    expect(await screen.findByRole("heading", { level: 1, name: "All Play" })).toBeInTheDocument();
  });

  it("confirms a new game, with options in a game and by opening the game elsewhere", async () => {
    const { user } = await open();
    await say(user, "new four suit game");
    expect(await within(voiceBar()).findByText("Start a new game?")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(await screen.findByText("four suits, standard deal")).toBeInTheDocument();
    await say(user, "go home");
    await screen.findByRole("heading", { level: 1, name: "All Play" });
    await say(user, "new game");
    await say(user, "yes");
    expect(await screen.findByRole("region", { name: "Card table" })).toBeInTheDocument();
    await say(user, "new game");
    await user.click(await screen.findByRole("button", { name: "Confirm (Enter)" }));
    expect(await screen.findByText("500")).toBeInTheDocument();
  });

  it("signs out after confirmation", async () => {
    const services = seeded();
    await services.player.signIn("pat@example.com");
    const { user } = await open("/", services);
    await screen.findByRole("link", { name: "Account" });
    await say(user, "sign out");
    expect(await within(voiceBar()).findByText("Sign out?")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("speaks responses when voice output is on, and repeats on request", async () => {
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        rate = 1;
        constructor(readonly text: string) {}
      },
    );
    const { user } = await open("/");
    await say(user, "auto confirm on");
    expect(speak).not.toHaveBeenCalled();
    await say(user, "repeat");
    expect(speak).toHaveBeenCalledTimes(1);
    await say(user, "turn voice on");
    await say(user, "show my stats");
    await waitFor(() => {
      expect(speak).toHaveBeenCalledTimes(2);
    });
    await say(user, "stop talking");
    vi.unstubAllGlobals();
  });
});
