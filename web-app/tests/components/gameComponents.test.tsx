import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CATALOG } from "../../test-data/games";
import { toEnvelope } from "../../test-data/spider/envelope";
import { createSpider, parseOptions } from "../../test-data/spider/simulator";
import { optionLabels } from "../../src/components/GameHeader";
import { StatusBanner } from "../../src/components/StatusBanner";
import { StockPile } from "../../src/components/StockPile";
import type { SessionEnvelope } from "../../src/models/api";
import { must } from "../must";

const spider = must(CATALOG.games[0]);

function envelope(): SessionEnvelope {
  return toEnvelope({
    sessionId: "s",
    status: "IN_PROGRESS",
    version: 0,
    state: createSpider(parseOptions({}), 7),
  });
}

describe("StatusBanner", () => {
  it("renders nothing while play continues", () => {
    const { container } = render(
      <StatusBanner envelope={envelope()} onUndo={vi.fn()} onNewGame={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers undo and a new game when blocked", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const blocked = envelope();
    blocked.view.status = { status: "IN_PROGRESS", blocked: true, canUndo: true };
    render(<StatusBanner envelope={blocked} onUndo={onUndo} onNewGame={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("No moves left.");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("announces a win with the final score and no undo", () => {
    const won = envelope();
    won.session.status = "WON";
    won.session.summary = { score: 1182 };
    render(<StatusBanner envelope={won} onUndo={vi.fn()} onNewGame={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("You won. Final score 1182.");
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("reports a win from the view status and a blocked game without undo", () => {
    const wonView = envelope();
    wonView.view.status = { status: "WON", blocked: false, canUndo: false };
    wonView.session.summary = {};
    render(<StatusBanner envelope={wonView} onUndo={vi.fn()} onNewGame={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Final score 0.");
  });
});

describe("StockPile", () => {
  const stock = must(envelope().view.zones.find((zone) => zone.type === "stock"));

  it("deals when allowed", async () => {
    const user = userEvent.setup();
    const onDeal = vi.fn();
    const deal = envelope().legalActions.find((action) => action.actionId === "DEAL_ROW");
    render(<StockPile zone={stock} dealAction={deal} dealsRemaining={5} onDeal={onDeal} />);
    await user.click(screen.getByRole("button", { name: "Deal (5 left)" }));
    expect(onDeal).toHaveBeenCalledWith("DEAL_ROW");
  });

  it("explains why dealing is not allowed", () => {
    render(<StockPile zone={stock} dealAction={undefined} dealsRemaining={5} onDeal={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Deal (5 left)" })).toHaveAccessibleDescription(
      "Fill empty columns first",
    );
  });

  it("says when the stock is empty", () => {
    render(
      <StockPile
        zone={{ ...stock, count: 0 }}
        dealAction={undefined}
        dealsRemaining={0}
        onDeal={vi.fn()}
      />,
    );
    expect(screen.getByText("No cards left to deal")).toBeInTheDocument();
  });
});

describe("optionLabels", () => {
  it("speaks known options and falls back to raw values", () => {
    expect(optionLabels(spider, { suits: 2, dealStyle: "HOYLE" })).toBe("two suits, Hoyle deal");
    expect(optionLabels(spider, { suits: 3 })).toBe("3");
  });
});
