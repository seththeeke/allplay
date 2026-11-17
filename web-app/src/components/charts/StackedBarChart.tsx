import { useId, useState } from "react";
import { ChartFrame } from "./ChartFrame";
import { ChartTooltip } from "./ChartTooltip";
import {
  CHART,
  formatNumber,
  labelEvery,
  niceMax,
  plotWidth,
  shortDate,
  ticks,
  yAt,
} from "./scale";

export interface BarSeries {
  name: string;
  values: number[];
  colorClass: string;
  /** Hatched fill, so the series never depends on color alone. */
  hatched?: boolean;
}

export interface StackedBarChartProps {
  title: string;
  summary: string;
  periods: string[];
  series: [BarSeries, BarSeries];
}

const GAP = 2;

/** Two stacked parts of a daily total, with a 2px surface gap between segments and a hover readout. */
export function StackedBarChart({
  title,
  summary,
  periods,
  series,
}: StackedBarChartProps): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const hatchId = useId();
  const totals = periods.map((_, index) =>
    series.reduce((sum, bar) => sum + (bar.values[index] ?? 0), 0),
  );
  const max = niceMax(Math.max(...totals));
  const slot = plotWidth / Math.max(periods.length, 1);
  const barWidth = Math.max(slot - 4, 3);
  const xAt = (index: number): number => CHART.left + index * slot + (slot - barWidth) / 2;
  return (
    <ChartFrame
      title={title}
      summary={summary}
      legend={series.map((bar) => ({
        name: bar.name,
        colorClass: bar.colorClass,
        hatched: bar.hatched ?? false,
      }))}
      table={{
        headers: ["Day", ...series.map((bar) => bar.name), "Total"],
        rows: periods.map((period, index) => [
          period,
          ...series.map((bar) => formatNumber(bar.values[index] ?? 0)),
          formatNumber(totals[index] ?? 0),
        ]),
      }}
    >
      <svg
        viewBox={`0 0 ${String(CHART.width)} ${String(CHART.height)}`}
        className="w-full"
        aria-hidden="true"
      >
        <defs className={series[1].colorClass}>
          <pattern
            id={hatchId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="currentColor" fillOpacity="0.3" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="3" />
          </pattern>
        </defs>
        {ticks(max).map((tick) => (
          <g key={tick}>
            <line
              x1={CHART.left}
              x2={CHART.width - CHART.right}
              y1={yAt(tick, max)}
              y2={yAt(tick, max)}
              className="stroke-line"
              strokeOpacity={0.35}
            />
            <text
              x={CHART.left - 8}
              y={yAt(tick, max) + 5}
              textAnchor="end"
              className="fill-muted text-[13px]"
            >
              {formatNumber(tick)}
            </text>
          </g>
        ))}
        {periods.map((period, index) => {
          let base = 0;
          return (
            <g key={period} opacity={hover === null || hover === index ? 1 : 0.55}>
              {series.map((bar, part) => {
                const value = bar.values[index] ?? 0;
                const top = yAt(base + value, max);
                const bottom = yAt(base, max) - (part === 0 ? 0 : GAP);
                base += value;
                return (
                  <rect
                    key={bar.name}
                    x={xAt(index)}
                    y={top}
                    width={barWidth}
                    height={Math.max(bottom - top, 0)}
                    rx={part === series.length - 1 ? 2 : 0}
                    className={bar.colorClass}
                    fill={bar.hatched === true ? `url(#${hatchId})` : "currentColor"}
                  />
                );
              })}
              {index % labelEvery(periods.length) === 0 ? (
                <text
                  x={xAt(index) + barWidth / 2}
                  y={CHART.height - 8}
                  textAnchor="middle"
                  className="fill-muted text-[13px]"
                >
                  {shortDate(period)}
                </text>
              ) : null}
              <rect
                data-testid={`hit-${period}`}
                x={CHART.left + index * slot}
                y={CHART.top}
                width={slot}
                height={CHART.height - CHART.top - CHART.bottom}
                fill="transparent"
                onMouseEnter={() => {
                  setHover(index);
                }}
                onMouseLeave={() => {
                  setHover(null);
                }}
              />
            </g>
          );
        })}
      </svg>
      {hover === null ? null : (
        <ChartTooltip
          heading={periods[hover] ?? ""}
          at={periods.length > 1 ? hover / (periods.length - 1) : 0}
          rows={[
            ...series.map((bar) => ({
              name: bar.name,
              value: formatNumber(bar.values[hover] ?? 0),
              colorClass: bar.colorClass,
            })),
            {
              name: "Total",
              value: formatNumber(totals[hover] ?? 0),
              colorClass: "text-transparent",
            },
          ]}
        />
      )}
    </ChartFrame>
  );
}
