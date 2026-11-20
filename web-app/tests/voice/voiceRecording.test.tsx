import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServices } from "../../src/services/createServices";
import { createMemoryStore } from "../../src/services/memory/memoryStore";
import type { Services } from "../../src/services/types";
import type { Heard, SpeechInput } from "../../src/voice/speechInput";
import { MAX_CAPTURE_MS } from "../../src/voice/VoiceProvider";
import { LOCAL_CONFIG, renderApp } from "../renderApp";

const voiceBar = () => screen.getByRole("region", { name: "Voice control" });

function withMicrophone(heard: () => Promise<Heard>, start?: () => Promise<never>) {
  const cancel = vi.fn();
  const speechInput: SpeechInput = {
    kind: "LOCAL_SERVER",
    start: start ?? (() => Promise.resolve({ stop: heard, cancel })),
  };
  const services: Services = {
    ...createServices(LOCAL_CONFIG, createMemoryStore(null), () => 7),
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
    expect(screen.getByRole("status")).toHaveTextContent("Recording. Speak now");
    await user.click(stop);
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
    expect(await within(voiceBar()).findByText("I didn't hear anything.")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: " " });
    await screen.findByRole("button", { name: "Stop (Space)" });
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
