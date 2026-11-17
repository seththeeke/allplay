export interface TooltipRow {
  name: string;
  value: string;
  colorClass: string;
}

export interface ChartTooltipProps {
  heading: string;
  rows: TooltipRow[];
  /** Horizontal position as a fraction of the chart width. */
  at: number;
}

/** Hover readout. Values use text colors; a small swatch carries series identity. */
export function ChartTooltip({ heading, rows, at }: ChartTooltipProps): React.JSX.Element {
  const flip = at > 0.6;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 rounded-lg border-2 border-line bg-surface px-3 py-2 text-lg shadow-lg"
      style={
        flip ? { right: `${String((1 - at) * 100 + 2)}%` } : { left: `${String(at * 100 + 2)}%` }
      }
    >
      <p className="font-bold">{heading}</p>
      {rows.map((row) => (
        <p key={row.name} className="flex items-center gap-2 whitespace-nowrap">
          <span
            aria-hidden="true"
            className={`inline-block size-3 rounded-sm bg-current ${row.colorClass}`}
          />
          <span className="text-muted">{row.name}</span>
          <span className="font-semibold">{row.value}</span>
        </p>
      ))}
    </div>
  );
}
