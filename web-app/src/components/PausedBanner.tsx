/** The full-width notice shown on every page while play is paused (productionalization.md section 4.3). */
export function PausedBanner(): React.JSX.Element {
  return (
    <div role="alert" className="border-b-4 border-accent bg-surface px-4 py-3 text-center">
      <p className="text-2xl font-bold">All Play is paused right now.</p>
      <p className="text-xl">Please try again later. Your games are saved.</p>
    </div>
  );
}
