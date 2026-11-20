import type { CardView, SessionEnvelope, ZoneView } from "../models/api";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const WIDTH = 5;

/** A card as rank and suit letter, for example `10S`; face-down cards print as `--`. */
export function cardLabel(card: CardView): string {
  return card.faceUp ? `${RANKS[card.rank - 1] as string}${card.suit.charAt(0)}` : "--";
}

const pad = (text: string): string => text.padStart(WIDTH - 1).padEnd(WIDTH);

function zonesOf(envelope: SessionEnvelope, type: string): ZoneView[] {
  return envelope.view.zones.filter((zone) => zone.type === type);
}

/** The board as plain text: header line, numbered columns side by side, then the stock (game-engine.md Addendum A). */
export function renderBoard(envelope: SessionEnvelope): string {
  const { summary } = envelope.session;
  const columns = zonesOf(envelope, "tableau");
  const runs = zonesOf(envelope, "foundation");
  const stock = zonesOf(envelope, "stock")[0] as ZoneView;
  const depth = Math.max(1, ...columns.map((column) => column.count));
  const lines = [
    `Score ${String(summary["score"])}   Moves ${String(summary["moveCount"])}   Completed runs ${String(summary["completedRuns"])}/${String(runs.length)}`,
    "",
    columns.map((column) => pad(String(column.index))).join(""),
    columns.map(() => pad("---")).join(""),
  ];
  for (let row = 0; row < depth; row += 1) {
    lines.push(
      columns
        .map((column) => {
          const card = column.cards?.[row];
          return pad(card === undefined ? (row === 0 ? "." : "") : cardLabel(card));
        })
        .join("")
        .trimEnd(),
    );
  }
  lines.push(
    "",
    `Stock: ${String(stock.count)} cards, ${String(summary["stockDealsRemaining"])} deals left`,
  );
  const { status } = envelope.view;
  if (envelope.session.status === "WON")
    lines.push("", "You won. Type new to play again or quit to exit.");
  else if (status.blocked) lines.push("", "No moves left. Type undo, new or quit.");
  return lines.join("\n");
}
