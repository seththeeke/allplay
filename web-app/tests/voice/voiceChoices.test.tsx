import { fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useVoice } from "../../src/hooks/useVoice";
import { createBrowserSpeechOutput } from "../../src/voice/speechOutput";
import { ambiguousServices } from "../ambiguous";
import { renderApp } from "../renderApp";

async function sayInGame(words: string) {
  const user = userEvent.setup();
  fireEvent.keyDown(document.body, { key: " " });
  await user.type(
    await screen.findByLabelText("Listening. Say what you want to do:"),
    `${words}{Enter}`,
  );
  return user;
}

describe("numbered choices", () => {
  it("lists choices, highlights them on the table and applies the number pressed", async () => {
    renderApp("/spider", await ambiguousServices());
    await screen.findByRole("region", { name: "Card table" });
    await sayInGame("the seven onto the eight");
    const bar = screen.getByRole("region", { name: "Voice control" });
    expect(
      await within(bar).findByRole("button", { name: /^1\. Move seven of / }),
    ).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /^2\. Move seven of / })).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Move to column/ }).length,
    ).toBeGreaterThanOrEqual(1);
    fireEvent.keyDown(document.body, { key: "7" });
    fireEvent.keyDown(document.body, { key: "2" });
    expect(await screen.findByText("499")).toBeInTheDocument();
  });

  it("applies a clicked choice, and Cancel closes the list", async () => {
    renderApp("/spider", await ambiguousServices());
    await screen.findByRole("region", { name: "Card table" });
    const user = await sayInGame("the seven onto the eight");
    const bar = screen.getByRole("region", { name: "Voice control" });
    await user.click(await within(bar).findByRole("button", { name: "Cancel (Esc)" }));
    expect(within(bar).queryByRole("button", { name: /^1\. / })).not.toBeInTheDocument();
    await sayInGame("the seven onto the eight");
    await user.click(await within(bar).findByRole("button", { name: /^1\. Move seven of / }));
    expect(await screen.findByText("499")).toBeInTheDocument();
  });

  it("goes back to the choices when listening is cancelled", async () => {
    renderApp("/spider", await ambiguousServices());
    await screen.findByRole("region", { name: "Card table" });
    await sayInGame("the seven onto the eight");
    fireEvent.keyDown(document.body, { key: " " });
    const input = await screen.findByLabelText("Listening. Say what you want to do:");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(await screen.findByRole("button", { name: /^1\. Move seven of / })).toBeInTheDocument();
  });
});

describe("voice plumbing", () => {
  it("requires the voice provider", () => {
    expect(() => renderHook(() => useVoice())).toThrow(/VoiceProvider/);
  });

  it("stays silent without browser speech support", () => {
    expect(() => {
      createBrowserSpeechOutput({}).speak("hello", 1);
    }).not.toThrow();
    const speak = vi.fn();
    const Utterance = vi.fn(function (this: { rate: number }) {
      this.rate = 1;
    });
    createBrowserSpeechOutput({
      speechSynthesis: { speak, cancel: vi.fn() } as unknown as SpeechSynthesis,
      SpeechSynthesisUtterance: Utterance as unknown as typeof SpeechSynthesisUtterance,
    }).speak("hello", 0.9);
    expect(speak).toHaveBeenCalledOnce();
    render(<p>done</p>);
  });
});
