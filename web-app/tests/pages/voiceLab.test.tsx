import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryVoiceLabService } from "../../src/services/memory/memoryVoiceLabService";
import type { Services, VoiceLabService } from "../../src/services/types";
import { freshServices, renderApp } from "../renderApp";

const recording = vi.hoisted(() => ({
  start: vi.fn(() =>
    Promise.resolve({ stop: () => Promise.resolve(new Uint8Array([1])), cancel: () => undefined }),
  ),
}));
vi.mock("../../src/voice/audioCapture", () => ({ startRecording: recording.start }));

function withLab(lab: Partial<VoiceLabService>): Services {
  return { ...freshServices(), voiceLab: { ...createMemoryVoiceLabService(), ...lab } };
}

describe("Voice Lab page", () => {
  afterEach(() => {
    recording.start.mockClear();
  });

  it("shows providers, records, transcribes, sends and lists what the backend recorded", async () => {
    const user = userEvent.setup();
    renderApp(
      "/voice-lab",
      withLab({
        status: () =>
          Promise.resolve({
            preset: "local",
            capabilities: {
              speechIn: {
                setting: "auto",
                provider: "macos-speech",
                available: true,
                detail: "ok",
              },
              llm: {
                setting: "claude-api",
                provider: "none",
                available: false,
                detail: "Arrives with AD-14.",
              },
            },
          }),
        transcribe: () =>
          Promise.resolve({
            text: "move 3 to 7",
            transcriptSource: "MACOS_SPEECH",
            provider: "macos-speech",
            latencyMs: 412,
          }),
      }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Voice Lab" })).toBeVisible();
    expect(await screen.findByText("Preset: local")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "speechIn" })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Arrives with AD-14.")).toBeInTheDocument();
    expect(screen.getByText("No commands yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByText("Recording. Say a command, then stop.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop and transcribe" }));
    expect(await screen.findByText("Heard by macos-speech in 412 ms.")).toBeInTheDocument();
    expect(screen.getByLabelText("Transcript")).toHaveValue("move 3 to 7");
    expect(
      screen.getByText("Source: MACOS_SPEECH. Edit it or type a command."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send to backend" }));
    expect(await screen.findByText('I heard "move 3 to 7".')).toBeInTheDocument();
    expect(await screen.findByText("move 3 to 7", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/\(MACOS_SPEECH, UNRECOGNIZED,/)).toBeInTheDocument();
  });

  it("sends typed commands and explains empty input and failures", async () => {
    const user = userEvent.setup();
    renderApp(
      "/voice-lab",
      withLab({ transcribe: () => Promise.reject(new Error("Helper not built.")) }),
    );
    await user.click(await screen.findByRole("button", { name: "Send to backend" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Say or type a command first.");
    await user.type(screen.getByLabelText("Transcript"), "deal");
    expect(screen.getByText("Source: TYPED. Edit it or type a command.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send to backend" }));
    expect(await screen.findByText(/\(TYPED, UNRECOGNIZED,/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await user.click(await screen.findByRole("button", { name: "Stop and transcribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Helper not built.");
  });

  it("reports a missing server, microphone refusal and backend failures", async () => {
    const user = userEvent.setup();
    recording.start.mockImplementationOnce(() => Promise.reject(new Error("")));
    renderApp(
      "/voice-lab",
      withLab({
        status: () => Promise.reject(new Error("offline")),
        send: () => Promise.reject(new Error("Backend down.")),
      }),
    );
    expect(await screen.findByText(/The local server did not answer/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await waitFor(() => {
      expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText("Transcript"), "hint");
    await user.click(screen.getByRole("button", { name: "Send to backend" }));
    expect(await screen.findByText("Backend down.")).toBeInTheDocument();
  });
});
