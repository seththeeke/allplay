export interface EyeIconProps {
  /** Draws the eye struck through, for "hide". */
  crossed: boolean;
}

/**
 * An eye drawn from two curves and a pupil, struck through when crossed, in
 * the text color. Decorative: the button it sits in carries the name.
 */
export function EyeIcon({ crossed }: EyeIconProps): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12 Q12 2 22 12 Q12 22 2 12 Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <line x1="4" y1="20" x2="20" y2="4" /> : null}
    </svg>
  );
}
