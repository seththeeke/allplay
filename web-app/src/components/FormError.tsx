export function FormError({ message }: { message: string | null }): React.JSX.Element {
  return (
    <p role="alert" className="min-h-8 text-xl font-semibold text-hearts">
      {message}
    </p>
  );
}
