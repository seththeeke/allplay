import { useState } from "react";
import { Button } from "./Button";

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
 * A large password field with a Show and Hide toggle. The toggle is a text
 * button rather than an eye icon (CLAUDE.md section 6), with its pressed
 * state exposed to assistive technology.
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
          aria-controls={id}
          aria-pressed={shown}
          aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => {
            setShown(!shown);
          }}
        >
          {shown ? "Hide" : "Show"}
        </Button>
      </div>
    </div>
  );
}
