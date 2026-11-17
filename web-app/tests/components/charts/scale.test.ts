import { describe, expect, it } from "vitest";
import {
  formatNumber,
  labelEvery,
  niceMax,
  shortDate,
  ticks,
  yAt,
  CHART,
  plotHeight,
} from "../../../src/components/charts/scale";

describe("chart scale", () => {
  it("rounds maxima up to values that split into four whole ticks", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(152)).toBe(200);
    expect(niceMax(213)).toBe(400);
    expect(niceMax(2810)).toBe(4000);
    expect(niceMax(9.2)).toBe(10);
    expect(ticks(400)).toEqual([0, 100, 200, 300, 400]);
  });

  it("maps values onto the plot and spaces date labels", () => {
    expect(yAt(0, 100)).toBe(CHART.top + plotHeight);
    expect(yAt(100, 100)).toBe(CHART.top);
    expect(labelEvery(30)).toBe(5);
    expect(labelEvery(3)).toBe(1);
  });

  it("formats dates and numbers for labels", () => {
    expect(shortDate("2026-11-07")).toBe("11/7");
    expect(shortDate("bad")).toBe("0/0");
    expect(formatNumber(7230500)).toBe("7,230,500");
  });
});
