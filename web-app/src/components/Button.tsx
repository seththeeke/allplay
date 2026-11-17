import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent border-accent",
  secondary: "bg-surface text-ink border-ink",
  quiet: "bg-transparent text-ink border-transparent underline",
};

/** Oversized button: at least 56 px tall at default zoom, with a thick border and large label. */
export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={`min-h-14 rounded-xl border-4 px-6 py-2 text-xl font-semibold disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
