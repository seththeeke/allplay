import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionResponse } from "../../src/models/api";
import { createServices } from "../../src/services/createServices";
import { createMemoryStore } from "../../src/services/memory/memoryStore";
import type { Services } from "../../src/services/types";
import type { ListenHandlers } from "../../src/voice/continuousListeners";
import type { SpeechOutput } from "../../src/voice/speechOutput";
import { GREETING_MAX_MS } from "../../src/voice/useConversation";
import { LOCAL_CONFIG, renderApp } from "../renderApp";

function setup(options: { listen?: boolean; autoEnd?: boolean; micFails?: boolean } = {}) {
  const ends: (() => void)[] = [];
  const speak = vi.fn<SpeechOutput["speak"]>((_text, _rate, _voice, onEnd) => {
    if (options.autoEnd === false) {
      if (onEnd !== undefined) ends.push(onEnd);
    } else onEnd?.();
  });
  const stopOutput = vi.fn();
  const listener = { setSpeaking: vi.fn(), setSilenceMs: vi.fn(), stop: vi.fn() };
  let heard: ListenHandlers | null = null;
  const listen = vi.fn((on: ListenHandlers) => {
    heard = on;
    return options.micFails === true
      ? Promise.reject(new Error("denied"))
      : Promise.resolve(listener);
  });
  const base = createServices(LOCAL_CONFIG, createMemoryStore(null), () => 7);
  const services: Services = {
    ...base,
    speechOutput: { speak, stop: stopOutput },
    speechInput: {
      kind: "LOCAL_SERVER",
      start: null,
      listen: options.listen === false ? null : listen,
    },
  };
  const mic = (): ListenHandlers => {
    if (heard === null) throw new Error("not listening");
    return heard;
  };
  return { services, speak, stopOutput, listener, listen, mic, ends };
}

async function open(services: Services) {
  await services.preferences.patchGame("spider-solitaire", { helpSeen: true });
  renderApp("/spider", services);
  await screen.findByRole("region", { name: "Card table" });
}

const orb = () => screen.getByTestId("voice-orb");
const say = async (mic: () => ListenHandlers, text: string) => {
  await act(async () => {
    mic().onSpeechStart();
    mic().onHeard({ text, transcriptSource: "WHISPER" });
    await Promise.resolve();
  });
};

describe("conversational voice", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("greets, settles into listening, and makes a move without asking", async () => {
    const t = setup();
    await open(t.services);
    await waitFor(() => {
      expect(t.speak.mock.calls[0]?.[0]).toBe("Game's started. Let me know what you'd like to do.");
    });
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalled();
    });
    expect(orb()).toHaveAttribute("data-state", "IDLE");
    await say(t.mic, "deal");
    expect(await screen.findByRole("button", { name: "Deal (4 left)" })).toBeInTheDocument();
    await waitFor(() => {
      expect(t.speak.mock.calls.at(-1)?.[0]).toBe("Done.");
    });
    expect(screen.queryByRole("button", { name: "Talk (Space)" })).not.toBeInTheDocument();
  });

  it("shows the greeting large until speech ends, then opens the microphone", async () => {
    const t = setup({ autoEnd: false });
    await open(t.services);
    expect((await screen.findAllByText(/Game's started/)).length).toBeGreaterThan(0);
    expect(orb()).toHaveAttribute("data-state", "GREETING");
    expect(t.listen).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(t.ends.length).toBeGreaterThan(0);
    });
    act(() => {
      t.ends[0]?.();
    });
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(document.querySelector(".ap-orb-greeting")).toBeNull();
    });
  });

  it("stops talking when the player talks over it, and shows that it hears them", async () => {
    const t = setup({ autoEnd: false });
    await open(t.services);
    await waitFor(() => {
      expect(t.ends.length).toBeGreaterThan(0);
    });
    act(() => {
      t.ends[0]?.();
    });
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalled();
    });
    await say(t.mic, "deal");
    await waitFor(() => {
      expect(orb()).toHaveAttribute("data-state", "SPEAKING");
    });
    await waitFor(() => {
      expect(t.listener.setSpeaking).toHaveBeenLastCalledWith(true);
    });
    act(() => {
      t.mic().onSpeechStart();
    });
    expect(t.stopOutput).toHaveBeenCalled();
    expect(orb()).toHaveAttribute("data-state", "HEARING");
    expect(screen.getByText("Hearing you")).toBeInTheDocument();
    act(() => {
      t.mic().onNothing();
    });
    expect(orb()).toHaveAttribute("data-state", "IDLE");
    act(() => {
      t.mic().onSpeechStart();
      t.mic().onError(new Error("down"));
    });
    expect(orb()).toHaveAttribute("data-state", "IDLE");
  });

  it("stays silent on side talk and keeps a waiting prompt", async () => {
    const t = setup();
    const decide = vi.spyOn(t.services.decisions, "decide");
    await open(t.services);
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalled();
    });
    const spoken = t.speak.mock.calls.length;
    await say(t.mic, "dinner is ready everybody");
    await waitFor(() => {
      expect(decide).toHaveBeenCalled();
    });
    await act(async () => {
      await decide.mock.results[0]?.value;
    });
    expect(t.speak.mock.calls.length).toBe(spoken);
    expect(decide.mock.calls[0]?.[0].context.voiceMode).toBe("CONVERSATIONAL");
  });

  it("asks when unsure, then confirms by button and speaks the acknowledgement", async () => {
    const t = setup();
    const proposal: DecisionResponse = {
      decisionId: "d1",
      outcome: "PROPOSED",
      displayText: "Did you mean deal?",
      speech: "Did you mean deal?",
      proposal: { actionId: "DEAL_ROW", text: "Deal a new row of cards" },
      choices: null,
      appAction: null,
      session: null,
    };
    vi.spyOn(t.services.decisions, "decide").mockResolvedValueOnce(proposal);
    await open(t.services);
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalled();
    });
    await say(t.mic, "maybe deal");
    const dock = screen.getByRole("region", { name: "Voice control" });
    await within(dock).findByText("Deal a new row of cards");
    fireEvent.click(within(dock).getByRole("button", { name: "Confirm (Enter)" }));
    expect(await screen.findByRole("button", { name: "Deal (4 left)" })).toBeInTheDocument();
    await waitFor(() => {
      expect(t.speak.mock.calls.at(-1)?.[0]).toBe("Done.");
    });
  });

  it("pauses and resumes with Space and the orb, closing the microphone", async () => {
    const t = setup();
    const user = userEvent.setup();
    await open(t.services);
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(orb()).toHaveAttribute("aria-label", "Pause listening (Space)");
    });
    fireEvent.keyDown(document.body, { key: " " });
    await waitFor(() => {
      expect(t.listener.stop).toHaveBeenCalledTimes(1);
    });
    expect(orb()).toHaveAttribute("data-state", "PAUSED");
    expect(orb()).toHaveAttribute("aria-pressed", "true");
    await user.click(orb());
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalledTimes(2);
    });
    expect(orb()).toHaveAttribute("aria-pressed", "false");
  });

  it("closes the microphone while the tab is hidden", async () => {
    const t = setup();
    await open(t.services);
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(orb()).toHaveAttribute("data-state", "IDLE");
    });
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => {
      expect(t.listener.stop).toHaveBeenCalled();
    });
    hidden.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalledTimes(2);
    });
  });

  it("offers typing when the microphone is unavailable", async () => {
    const t = setup({ micFails: true });
    const user = userEvent.setup();
    await open(t.services);
    expect(await screen.findByText(/Microphone unavailable/)).toBeInTheDocument();
    expect(orb()).toHaveAttribute("data-state", "PAUSED");
    await user.click(screen.getByRole("button", { name: "Type" }));
    const field = screen.getByLabelText("Type a command");
    expect(field).toHaveFocus();
    await user.type(field, "   {Enter}");
    expect(screen.getByLabelText("Type a command")).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "deal{Enter}");
    expect(await screen.findByRole("button", { name: "Deal (4 left)" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Type a command")).not.toBeInTheDocument();
  });

  it("works with typing alone when no continuous input exists", async () => {
    const t = setup({ listen: false });
    await open(t.services);
    await waitFor(() => {
      expect(orb()).toHaveAttribute("data-state", "PAUSED");
    });
    expect(t.listen).not.toHaveBeenCalled();
  });

  it("does not greet or listen while the first-game tour is open", async () => {
    const t = setup();
    renderApp("/spider", t.services);
    await screen.findByRole("heading", { level: 2, name: "Just talk to play" });
    expect(t.speak).not.toHaveBeenCalled();
    expect(t.listen).not.toHaveBeenCalled();
  });

  it("moves on when the greeting cannot be fetched or never ends", async () => {
    const t = setup({ autoEnd: false });
    vi.spyOn(t.services.decisions, "greet").mockRejectedValueOnce(new Error("down"));
    await open(t.services);
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalled();
    });
    const slow = setup({ autoEnd: false });
    const timer = vi.spyOn(globalThis, "setTimeout");
    await open(slow.services);
    await waitFor(() => {
      expect(slow.ends.length).toBeGreaterThan(0);
    });
    const done = timer.mock.calls.find(([, ms]) => ms === GREETING_MAX_MS)?.[0] as () => void;
    act(() => {
      done();
    });
    await waitFor(() => {
      expect(slow.listen).toHaveBeenCalled();
    });
  });

  it("stops the voice and microphone on leaving the game", async () => {
    const t = setup();
    const user = userEvent.setup();
    await open(t.services);
    await waitFor(() => {
      expect(t.listen).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(orb()).toHaveAttribute("data-state", "IDLE");
    });
    await user.click(screen.getByRole("link", { name: /settings/i }));
    await waitFor(() => {
      expect(t.listener.stop).toHaveBeenCalled();
    });
    expect(t.stopOutput).toHaveBeenCalled();
  });
});
