/** Eight tooth angles, 45 degrees apart. */
const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * A gear drawn from two circles and eight teeth, in the text color. It is
 * decorative: the link it sits in carries the accessible name.
 */
export function GearIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-8"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="3" strokeWidth="2" />
      <circle cx="12" cy="12" r="6.5" strokeWidth="2" />
      {TEETH.map((angle) => {
        const radians = (angle * Math.PI) / 180;
        const point = (radius: number) => ({
          x: 12 + radius * Math.cos(radians),
          y: 12 + radius * Math.sin(radians),
        });
        const [from, to] = [point(6.5), point(9.5)];
        return <line key={angle} x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth="3" />;
      })}
    </svg>
  );
}
