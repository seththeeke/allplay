export interface StatTileProps {
  label: string;
  value: string;
  detail: string;
}

/** A headline number with its context; used where a chart would add nothing. */
export function StatTile({ label, value, detail }: StatTileProps): React.JSX.Element {
  return (
    <div className="rounded-2xl border-4 border-line bg-surface p-4">
      <p className="text-xl text-muted">{label}</p>
      <p className="text-5xl font-bold">{value}</p>
      <p className="mt-1 text-lg text-muted">{detail}</p>
    </div>
  );
}
