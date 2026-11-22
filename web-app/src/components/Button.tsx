import type { ButtonHTMLAttributes, Ref } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  ref?: Ref<HTMLButtonElement>;
  /** A network call this button started is running: show a spinner and refuse further presses. */
  busy?: boolean;
  /** What the button says while busy, such as "Creating account". */
  busyLabel?: string;
  /** `compact` for toolbars: 44 px tall, still a comfortable target. */
  size?: "regular" | "compact";
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent border-accent",
  secondary: "bg-surface text-ink border-ink",
  quiet: "bg-transparent text-ink border-transparent underline",
};

/**
 * Oversized button: at least 56 px tall at default zoom, with a thick border
 * and large label. While busy it spins (a still ring under reduced motion),
 * changes its label and announces it, so a slow call is never silent.
 */
export function Button({
  variant = "primary",
  className = "",
  type = "button",
  busy = false,
  busyLabel,
  size = "regular",
  disabled,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <>
      <button
        type={type}
        disabled={disabled === true || busy}
        aria-busy={busy || undefined}
        className={`inline-flex cursor-pointer items-center justify-center gap-3 rounded-xl font-semibold ${size === "compact" ? "min-h-11 border-2 px-4 py-1 text-lg" : "min-h-14 border-4 px-6 py-2 text-xl"} disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-wait aria-busy:opacity-80 ${VARIANTS[variant]} ${className}`}
        {...rest}
      >
        {busy ? (
          <>
            <span
              aria-hidden="true"
              data-testid="spinner"
              className="inline-block size-6 shrink-0 rounded-full border-4 border-current border-t-transparent motion-safe:animate-spin"
            />
            {busyLabel === undefined ? children : `${busyLabel}...`}
          </>
        ) : (
          children
        )}
      </button>
      {busy ? (
        <span role="status" className="sr-only">
          {busyLabel ?? "Working"}
        </span>
      ) : null}
    </>
  );
}
