import type { ReactNode } from "react";

export interface LegendEntry {
  name: string;
  colorClass: string;
  dashed?: boolean;
  hatched?: boolean;
}

export interface ChartFrameProps {
  title: string;
  summary: string;
  legend: LegendEntry[];
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
}

/** Title, legend (two or more series), the chart, and a table view of the same numbers. */
export function ChartFrame({
  title,
  summary,
  legend,
  table,
  children,
}: ChartFrameProps): React.JSX.Element {
  return (
    <figure className="rounded-2xl border-4 border-line bg-surface p-4">
      <figcaption>
        <h3 className="text-2xl font-bold">{title}</h3>
        <p className="text-lg text-muted">{summary}</p>
      </figcaption>
      {legend.length > 1 ? (
        <ul aria-label={`${title} legend`} className="mt-2 flex flex-wrap gap-4 text-lg">
          {legend.map((entry) => (
            <li key={entry.name} className="flex items-center gap-2">
              <svg aria-hidden="true" width="28" height="12" className={entry.colorClass}>
                <line
                  x1="2"
                  x2="26"
                  y1="6"
                  y2="6"
                  stroke="currentColor"
                  strokeWidth={entry.hatched === true ? 8 : 3}
                  strokeDasharray={
                    entry.dashed === true ? "6 4" : entry.hatched === true ? "2 2" : undefined
                  }
                />
              </svg>
              {entry.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative mt-2">{children}</div>
      <details className="mt-3 text-lg">
        <summary className="cursor-pointer font-semibold">Show as a table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr>
              {table.headers.map((header) => (
                <th key={header} scope="col" className="border-b-2 border-line p-1">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={String(row[0])}>
                {row.map((cell, index) => (
                  <td key={`${String(row[0])}-${String(index)}`} className="p-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
