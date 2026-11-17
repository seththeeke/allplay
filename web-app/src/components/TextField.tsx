export interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "email" | "password" | "text";
  autoComplete?: string;
  hint?: string;
  inputMode?: "numeric" | "text";
}

/** A large labelled field with an optional hint read with it by assistive technology. */
export function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  hint,
  inputMode,
}: TextFieldProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-2xl font-semibold">
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-lg text-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        type={type}
        required
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="min-h-14 rounded-xl border-4 border-line bg-surface px-4 text-2xl"
      />
    </div>
  );
}
