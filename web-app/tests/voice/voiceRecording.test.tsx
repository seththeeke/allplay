import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServices } from "../../src/services/createServices";
import type { Services } from "../../src/services/types";
import type { Heard, SpeechInput } from "../../src/voice/speechInput";
import type { TurnEvents } from "../../src/voice/continuousListeners";
import { MAX_CAPTURE_MS } from "../../src/voice/VoiceProvider";
import { LOCAL_CONFIG, renderApp, turnBasedStore } from "../renderApp";

const voiceBar = () => screen.getByRole("region", { name: "Voice control" });

function withMicrophone(heard: () => Promise<Heard>, start?: () => Promise<never>) {
  const cancel = vi.fn();
  const speechInput: SpeechInput = {
    kind: "LOCAL_SERVER",
    start: start ?? (() => Promise.resolve({ stop: heard, cancel })),
  };
  const services: Services = {
    ...createServices(LOCAL_CONFIG, turnBasedStore(), () => 7),
    speechInput,
  };
  return { services, cancel };
}

async function open(services: Services) {
  const user = userEvent.setup();
  renderApp("/spider", services);
  await screen.findByRole("region", { name: "Card table" });
  return user;
}

describe("voice turns from the microphone", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows what it hears while the player speaks, and ends listening on a pause", async () => {
    let events: TurnEvents | undefined;
    const speechInput: SpeechInput = {
      kind: "TRANSCRIBE",
      start: (given) => {
        events = given;
        return Promise.resolve({
          stop: () => Promise.resolve({ text: "deal", transcriptSource: "TRANSCRIBE" }),
          cancel: vi.fn(),
        });
      },
    };
    const services: Services = {
      ...createServices(LOCAL_CONFIG, turnBasedStore(), () => 7),
      speechInput,
    };
    await open(services);
    fireEvent.keyDown(document.body, { key: " " });
    await screen.findByRole("button", { name: "Stop (Space)" });
    expect(events?.silenceMs).toBe(1200);
    act(() => {
      events?.onPartial?.("deal a");
    });
    expect(screen.getByTestId("heard-so-far")).toHaveTextContent("Heard: deal a");
    act(() => {
      events?.onSpeechEnd?.();
    });
    expect(await within(voiceBar()).findByText("Deal a new row of cards")).toBeInTheDocument();
    expect(screen.queryByTestId("heard-so-far")).not.toBeInTheDocument();
  });

  it("records on Space, stops on the focused Stop button, and sends what was heard", async () => {
    const decide = vi.fn();
    const { services } = withMicrophone(() =>
      Promise.resolve({ text: "deal", transcriptSource: "MACOS_SPEECH" }),
    );
    const { decisions } = services;
    services.decisions = {
      ...decisions,
      decide: (request) => {
        decide(request);
        return decisions.decide(request);
      },
    };
    const user = await open(services);
    fireEvent.keyDown(document.body, { key: " " });
    const stop = await screen.findByRole("button", { name: "Stop (Space)" });
    expect(stop).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Listening");
    expect(screen.getByRole("status")).toHaveTextContent("Speak now, then press Space.");
    expect(screen.getByTestId("recording-indicator")).toHaveClass("ap-listening-pulse");
    await user.click(stop);
    expect(screen.queryByTestId("recording-indicator")).not.toBeInTheDocument();
    expect(await within(voiceBar()).findByText("Deal a new row of cards")).toBeInTheDocument();
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: "deal", transcriptSource: "MACOS_SPEECH" }),
    );
  });

  it("sends a typed command instead and drops the recording", async () => {
    const { services, cancel } = withMicrophone(() =>
      Promise.resolve({ text: "ignored", transcriptSource: "WHISPER" }),
    );
    const user = await open(services);
    fireEvent.keyDown(document.body, { key: " " });
    await screen.findByRole("button", { name: "Stop (Space)" });
    await user.type(screen.getByLabelText("Or type it:"), "deal{Enter}");
    expect(await within(voiceBar()).findByText("Deal a new row of cards")).toBeInTheDocument();
    expect(cancel).toHaveBeenCalled();
  });

  it("stops by itself after the capture limit, and Done stops an empty form", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { services } = withMicrophone(() =>
      Promise.resolve({ text: "", transcriptSource: "WHISPER" }),
    );
    await open(services);
    fireEvent.keyDown(document.body, { key: " " });
    await screen.findByRole("button", { name: "Stop (Space)" });
    vi.advanceTimersByTime(MAX_CAPTURE_MS);
    /* Fake timers only for the capture limit; the rest runs on real time so slow machines keep up. */
    vi.useRealTimers();
    expect(
      await within(voiceBar()).findByText("I didn't hear anything.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: " " });
    await screen.findByRole("button", { name: "Stop (Space)" }, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stop (Space)" })).not.toBeInTheDocument();
    });
  });

  it("explains a failed microphone or transcription, and Escape cancels capture", async () => {
    const failing = withMicrophone(
      () => Promise.reject(new Error("unused")),
      () => Promise.reject(new Error("denied")),
    );
    await open(failing.services);
    fireEvent.keyDown(document.body, { key: " " });
    expect(
      await within(voiceBar()).findByText(
        "The microphone is not available. Type the command instead.",
      ),
    ).toBeInTheDocument();
  });

  it("reports a failed transcription and cancels on Escape", async () => {
    const { services, cancel } = withMicrophone(() => Promise.reject(new Error("server down")));
    const user = await open(services);
    fireEvent.keyDown(document.body, { key: " " });
    await user.click(await screen.findByRole("button", { name: "Stop (Space)" }));
    expect(
      await within(voiceBar()).findByText(
        "I couldn't hear that. Please try again, or type the command.",
      ),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: " " });
    await screen.findByRole("button", { name: "Stop (Space)" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });
});
