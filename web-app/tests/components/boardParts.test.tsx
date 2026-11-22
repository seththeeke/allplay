import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CATALOG } from "../../test-data/games";
import { toEnvelope } from "../../test-data/spider/envelope";
import { createSpider, parseOptions } from "../../test-data/spider/simulator";
import { FoundationRow } from "../../src/components/FoundationRow";
import { GameBoard } from "../../src/components/GameBoard";
import { GameHeader } from "../../src/components/GameHeader";
import { TableauColumn } from "../../src/components/TableauColumn";
import type { ZoneView } from "../../src/models/api";
import { must } from "../must";

const king = {
  faceUp: true,
  cardId: "k",
  suit: "HEARTS",
  rank: 13,
  name: "king of hearts",
} as const;
const column = (cards: ZoneView["cards"]): ZoneView => ({
  zoneId: "tableau.3",
  type: "tableau",
  index: 3,
  label: "column 3",
  layout: "FAN_DOWN",
  region: "MAIN",
  count: cards?.length ?? 0,
  cards,
});

describe("TableauColumn", () => {
  it("describes empty, face-down-topped and face-up-topped columns", () => {
    render(<TableauColumn zone={column([])} />);
    render(<TableauColumn zone={column([{ faceUp: false }])} />);
    render(
      <TableauColumn
        zone={column([{ faceUp: false }, king])}
        highlightedCardIds={new Set(["k"])}
        targeted
      />,
    );
    expect(screen.getByRole("region", { name: "column 3, empty" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "column 3, 1 cards, top card face down" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "column 3, 2 cards, top card king of hearts" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "king of hearts" })).toHaveClass("outline-highlight");
  });

  it("treats a column with no card list as empty", () => {
    render(<TableauColumn zone={column(null)} />);
    expect(screen.getByRole("region", { name: "column 3, empty" })).toBeInTheDocument();
  });
});

describe("FoundationRow", () => {
  it("shows the king of each completed run", () => {
    const zone = (index: number, cards: ZoneView["cards"]): ZoneView => ({
      ...column(cards),
      zoneId: `foundation.${String(index)}`,
      type: "foundation",
      index,
      region: "TOP",
    });
    render(<FoundationRow zones={[zone(1, [king]), zone(2, []), zone(3, null)]} />);
    expect(screen.getByRole("region", { name: "Completed runs: 1 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "king of hearts" })).toBeInTheDocument();
  });
});

describe("GameBoard and GameHeader", () => {
  const envelope = toEnvelope({
    sessionId: "s",
    status: "IN_PROGRESS",
    version: 0,
    state: createSpider(parseOptions({}), 7),
  });

  it("renders without a stock zone", () => {
    const noStock = {
      ...envelope,
      view: {
        ...envelope.view,
        zones: envelope.view.zones.filter((zone) => zone.type !== "stock"),
      },
    };
    render(
      <GameBoard
        envelope={noStock}
        highlightedCardIds={new Set()}
        targetZoneIds={new Set()}
        onDeal={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Deal/ })).not.toBeInTheDocument();
  });

  it("shows zeros when the summary is empty and a deal count of zero", () => {
    const empty = { ...envelope, session: { ...envelope.session, summary: {} } };
    render(<GameHeader game={must(CATALOG.games[0])} envelope={empty} />);
    render(
      <GameBoard
        envelope={empty}
        highlightedCardIds={new Set()}
        targetZoneIds={new Set()}
        onDeal={vi.fn()}
      />,
    );
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Deal (0 left)" })).toBeInTheDocument();
  });
});
