import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpWalkthrough } from "../../../src/components/HelpWalkthrough";
import { LineChart } from "../../../src/components/charts/LineChart";
import { StackedBarChart } from "../../../src/components/charts/StackedBarChart";

describe("charts with sparse data", () => {
  it("draws a single-day line chart with missing values and no reference line", () => {
    render(
      <LineChart
        title="One day"
        summary="A single point."
        periods={["2026-12-02"]}
        series={[
          { name: "First", values: [5], colorClass: "text-series-1" },
          { name: "Second", values: [], colorClass: "text-series-2" },
        ]}
      />,
    );
    const hit = screen.getByTestId("hit-2026-12-02");
    fireEvent.mouseEnter(hit);
    expect(screen.getByRole("status")).toHaveTextContent("Second0");
    expect(screen.getByRole("list", { name: "One day legend" })).toBeInTheDocument();
  });

  it("draws a single-day stacked bar with a missing segment", () => {
    render(
      <StackedBarChart
        title="Bars"
        summary="One bar."
        periods={["2026-12-02"]}
        series={[
          { name: "Plain", values: [3], colorClass: "text-series-1" },
          { name: "Missing", values: [], colorClass: "text-series-2" },
        ]}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("hit-2026-12-02"));
    expect(within(screen.getByRole("status")).getByText("Total").nextSibling).toHaveTextContent(
      "3",
    );
  });

  it("renders nothing for an empty help tour", () => {
    const { container } = render(<HelpWalkthrough steps={[]} onFinish={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
