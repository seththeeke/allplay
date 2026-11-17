import { useState } from "react";
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

export interface LineSeries {
  name: string;
  values: number[];
  colorClass: string;
  dashed?: boolean;
}

export interface LineChartProps {
  title: string;
  summary: string;
  periods: string[];
  series: LineSeries[];
  unit?: string;
  reference?: { value: number; label: string };
}

/** Change over time: 2px lines on one axis, a crosshair and readout on hover, and a table view. */
export function LineChart({
  title,
  summary,
  periods,
  series,
  unit = "",
  reference,
}: LineChartProps): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(reference?.value ?? 0, ...series.flatMap((line) => line.values)));
  const step = periods.length > 1 ? plotWidth / (periods.length - 1) : 0;
  const xAt = (index: number): number => CHART.left + index * step;
  const format = (value: number): string => `${formatNumber(value)}${unit}`;
  return (
    <ChartFrame
      title={title}
      summary={summary}
      legend={series.map((line) => ({
        name: line.name,
        colorClass: line.colorClass,
        dashed: line.dashed ?? false,
      }))}
      table={{
        headers: ["Day", ...series.map((line) => line.name)],
        rows: periods.map((period, index) => [
          period,
          ...series.map((line) => format(line.values[index] ?? 0)),
        ]),
      }}
    >
      <svg
        viewBox={`0 0 ${String(CHART.width)} ${String(CHART.height)}`}
        className="w-full"
        aria-hidden="true"
      >
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
        {periods.map((period, index) =>
          index % labelEvery(periods.length) === 0 ? (
            <text
              key={period}
              x={xAt(index)}
              y={CHART.height - 8}
              textAnchor="middle"
              className="fill-muted text-[13px]"
            >
              {shortDate(period)}
            </text>
          ) : null,
        )}
        {reference === undefined ? null : (
          <g>
            <line
              x1={CHART.left}
              x2={CHART.width - CHART.right}
              y1={yAt(reference.value, max)}
              y2={yAt(reference.value, max)}
              className="stroke-ink"
              strokeDasharray="2 4"
            />
            <text
              x={CHART.left + 6}
              y={yAt(reference.value, max) + 16}
              textAnchor="start"
              className="fill-ink text-[13px]"
            >
              {reference.label}
            </text>
          </g>
        )}
        {hover === null ? null : (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={CHART.top}
            y2={CHART.height - CHART.bottom}
            className="stroke-muted"
          />
        )}
        {series.map((line) => (
          <g key={line.name} className={line.colorClass}>
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeDasharray={line.dashed === true ? "6 4" : undefined}
              points={line.values
                .map((value, index) => `${String(xAt(index))},${String(yAt(value, max))}`)
                .join(" ")}
            />
            {hover === null ? null : (
              <circle
                cx={xAt(hover)}
                cy={yAt(line.values[hover] ?? 0, max)}
                r={5}
                fill="currentColor"
                className="stroke-surface"
                strokeWidth={2}
              />
            )}
          </g>
        ))}
        {periods.map((period, index) => (
          <rect
            key={period}
            data-testid={`hit-${period}`}
            x={xAt(index) - step / 2}
            y={CHART.top}
            width={Math.max(step, 8)}
            height={CHART.height - CHART.top - CHART.bottom}
            fill="transparent"
            onMouseEnter={() => {
              setHover(index);
            }}
            onMouseLeave={() => {
              setHover(null);
            }}
          />
        ))}
      </svg>
      {hover === null ? null : (
        <ChartTooltip
          heading={periods[hover] ?? ""}
          at={periods.length > 1 ? hover / (periods.length - 1) : 0}
          rows={series.map((line) => ({
            name: line.name,
            value: format(line.values[hover] ?? 0),
            colorClass: line.colorClass,
          }))}
        />
      )}
    </ChartFrame>
  );
}
