import { useState } from "react";
import { Button } from "./Button";
import { IoEyeOffOutline, IoEyeOutline } from "react-icons/io5";

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  /** Ids of text that describes the field, such as the requirement checklist. */
  describedBy?: string;
}

/**
 * A large password field with an eye toggle that shows or hides the text.
 * The toggle is named "Show password" or "Hide password" and exposes its
 * pressed state to assistive technology.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
}: PasswordFieldProps): React.JSX.Element {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-2xl font-semibold">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={shown ? "text" : "password"}
          required
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="min-h-14 min-w-0 flex-1 rounded-xl border-4 border-line bg-surface px-4 text-2xl"
        />
        <Button
          variant="secondary"
          className="min-w-14 px-3"
          aria-controls={id}
          aria-pressed={shown}
          aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
          title={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => {
            setShown(!shown);
          }}
        >
          {shown ? (
            <IoEyeOffOutline aria-hidden="true" className="size-8" />
          ) : (
            <IoEyeOutline aria-hidden="true" className="size-8" />
          )}
        </Button>
      </div>
    </div>
  );
}
