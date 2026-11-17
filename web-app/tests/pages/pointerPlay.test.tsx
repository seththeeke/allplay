import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegalAction } from "../../src/models/api";
import { createServices } from "../../src/services/createServices";
import { createMemoryStore } from "../../src/services/memory/memoryStore";
import type { Services } from "../../src/services/types";
import { must } from "../must";
import { LOCAL_CONFIG, renderApp } from "../renderApp";

const seeded = (): Services => createServices(LOCAL_CONFIG, createMemoryStore(null), () => 7);

type Move = Extract<LegalAction["descriptor"], { kind: "MOVE_CARDS" }>;

async function open(): Promise<{ services: Services; moves: Move[] }> {
  const services = seeded();
  const envelope = await services.sessions.start("spider-solitaire");
  renderApp("/spider", services);
  await screen.findByRole("region", { name: "Card table" });
  const moves = envelope.legalActions.flatMap((action) =>
    action.descriptor.kind === "MOVE_CARDS" && action.descriptor.to.topCard !== null
      ? [action.descriptor]
      : [],
  );
  return { services, moves };
}

const cardButton = (move: Move) =>
  screen.getByRole("button", { name: `${must(move.cards[0]).name}, ${move.from.label}` });

describe("tap to select, tap to move", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("highlights legal destinations for a selected card and moves on a tap", async () => {
    const user = userEvent.setup();
    const { moves } = await open();
    const move = must(moves[0]);
    await user.click(cardButton(move));
    expect(cardButton(move)).toHaveAttribute("aria-pressed", "true");
    const target = screen.getByRole("button", { name: `Move to ${move.to.label}` });
    await user.click(target);
    await waitFor(() => {
      expect(screen.getByText("499")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^Move to / })).not.toBeInTheDocument();
  });

  it("moves when the player taps a card in a destination column", async () => {
    const user = userEvent.setup();
    const { moves } = await open();
    const move = must(moves[0]);
    await user.click(cardButton(move));
    const destinationTop = must(move.to.topCard);
    await user.click(
      screen.getByRole("button", { name: `${destinationTop.name}, ${move.to.label}` }),
    );
    await waitFor(() => {
      expect(screen.getByText("499")).toBeInTheDocument();
    });
  });

  it("deselects on a second tap and on a tap of a column that is not a destination", async () => {
    const user = userEvent.setup();
    const { moves } = await open();
    const move = must(moves[0]);
    await user.click(cardButton(move));
    await user.click(cardButton(move));
    expect(cardButton(move)).toHaveAttribute("aria-pressed", "false");
    await user.click(cardButton(move));
    await user.click(screen.getByRole("button", { name: move.from.label }));
    expect(cardButton(move)).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: move.from.label }));
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("says when a card cannot move", async () => {
    const user = userEvent.setup();
    const { moves } = await open();
    const movable = new Set(moves.map((move) => `${must(move.cards[0]).name}, ${move.from.label}`));
    const stuck = screen
      .getAllByRole("button", { name: /, column \d+$/ })
      .find((button) => !movable.has(button.getAttribute("aria-label") ?? ""));
    await user.click(must(stuck));
    expect(await screen.findByText(/can't move right now\.$/)).toBeInTheDocument();
  });
});

describe("drag and drop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function dragTo(move: Move, zoneId: string | null, distance = 80): void {
    const card = cardButton(move);
    const drop = zoneId === null ? null : document.querySelector(`[data-zone-id="${zoneId}"]`);
    document.elementFromPoint = vi.fn(() => drop);
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10 + distance / 2, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10 + distance, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 10 + distance, clientY: 10 });
    fireEvent.click(card);
  }

  it("moves cards dropped on a legal column", async () => {
    const { moves } = await open();
    const move = must(moves[0]);
    dragTo(move, move.to.zoneId);
    await waitFor(() => {
      expect(screen.getByText("499")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /aria-pressed/ })).not.toBeInTheDocument();
  });

  it("explains a drop on an illegal column and ignores drops off the table or on the same column", async () => {
    const { moves } = await open();
    const move = must(moves[0]);
    const illegal = ["tableau.1", "tableau.2", "tableau.3"].find(
      (zoneId) =>
        zoneId !== move.from.zoneId &&
        !moves.some(
          (other) => other.from.zoneId === move.from.zoneId && other.to.zoneId === zoneId,
        ),
    );
    dragTo(move, must(illegal));
    expect(await screen.findByText("Those cards can't go there.")).toBeInTheDocument();
    dragTo(move, null);
    dragTo(move, move.from.zoneId);
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("treats a small movement as a tap and ignores other mouse buttons", async () => {
    const { moves } = await open();
    const move = must(moves[0]);
    const card = cardButton(move);
    fireEvent.pointerDown(card, { button: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 14, clientY: 12 });
    fireEvent.pointerUp(window, { clientX: 14, clientY: 12 });
    fireEvent.click(card);
    expect(cardButton(move)).toHaveAttribute("aria-pressed", "true");
  });
});
