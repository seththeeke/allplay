import { describe, expect, it } from "vitest";
import type { DecisionResponse } from "../../../src/models/api";
import { loadPersonality } from "../../../src/service/conversation/personality";
import { speakTurn } from "../../../src/service/conversation/speakTurn";

const personality = loadPersonality({});
type Reply = Omit<DecisionResponse, "decisionId">;
const reply = (extra: Partial<Reply> = {}): Reply => ({
  outcome: "RESOLVED",
  displayText: "Original.",
  speech: "Original.",
  proposal: null,
  choices: null,
  appAction: null,
  session: null,
  ...extra,
});
const session = {} as NonNullable<Reply["session"]>;

describe("speaking a turn", () => {
  it("rotates short acknowledgements after an applied move", () => {
    const spoken = [0, 1, 5].map(
      (index) =>
        speakTurn({ outcome: "AUTO_APPLIED", response: reply() }, personality, index).speech,
    );
    expect(spoken).toEqual(["Done.", "All set.", "Done."]);
  });

  it("acknowledges an answered prompt, but keeps a reply that changed nothing", () => {
    expect(
      speakTurn({ outcome: "RESOLVED", response: reply({ session }) }, personality, 1).speech,
    ).toBe("All set.");
    expect(
      speakTurn(
        { outcome: "RESOLVED", response: reply({ appAction: { action: "ZOOM_IN" } }) },
        personality,
        0,
      ).speech,
    ).toBe("Done.");
    expect(speakTurn({ outcome: "RESOLVED", response: reply() }, personality, 0).speech).toBe(
      "Original.",
    );
  });

  it("acknowledges application actions except repeat and those that confirm", () => {
    const app = (appAction: Reply["appAction"]) =>
      speakTurn({ outcome: "APP_ACTION", response: reply({ appAction }) }, personality, 0).speech;
    expect(app({ action: "ZOOM_IN" })).toBe("Done.");
    expect(app({ action: "REPEAT" })).toBe("Original.");
    expect(app({ action: "SIGN_OUT" })).toBe("Original.");
    expect(app(null)).toBe("Original.");
  });

  it("asks about an unsure move and keeps a hint's own wording", () => {
    const proposal = { actionId: "A", text: "seven to column two" };
    expect(
      speakTurn({ outcome: "PROPOSED", response: reply({ proposal }) }, personality, 0).speech,
    ).toBe("Did you mean seven to column two?");
    expect(
      speakTurn({ outcome: "PROPOSED", hint: true, response: reply({ proposal }) }, personality, 0)
        .speech,
    ).toBe("Original.");
    expect(speakTurn({ outcome: "PROPOSED", response: reply() }, personality, 0).speech).toBe(
      "Original.",
    );
  });

  it("reads choices, refusals and other outcomes", () => {
    const choices = [
      { number: 1, actionId: "A", text: "to column two" },
      { number: 2, actionId: "B", text: "to column nine" },
    ];
    expect(
      speakTurn({ outcome: "CHOICES", response: reply({ choices }) }, personality, 0).speech,
    ).toBe("Which one? 1, to column two. 2, to column nine.");
    expect(speakTurn({ outcome: "CHOICES", response: reply() }, personality, 0).speech).toBe(
      "Which one? ",
    );
    expect(
      speakTurn({ outcome: "UNRECOGNIZED", refused: true, response: reply() }, personality, 0)
        .speech,
    ).toBe(personality.notAllowed);
    expect(speakTurn({ outcome: "UNRECOGNIZED", response: reply() }, personality, 0).speech).toBe(
      "Original.",
    );
    expect(speakTurn({ outcome: "ANSWERED", response: reply() }, personality, 0).speech).toBe(
      "Original.",
    );
  });
});
