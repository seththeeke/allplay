export interface PageHeadingProps {
  title: string;
  lead?: string | null | undefined;
}

export function PageHeading({ title, lead }: PageHeadingProps): React.JSX.Element {
  return (
    <header className="mb-6">
      <h1 className="text-4xl font-bold">{title}</h1>
      {lead === undefined || lead === null ? null : (
        <p className="mt-2 text-2xl text-muted">{lead}</p>
      )}
    </header>
  );
}
