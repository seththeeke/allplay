export interface ToggleSettingProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off switch with a large target and a plain-language description. */
export function ToggleSetting({
  id,
  label,
  description,
  checked,
  onChange,
}: ToggleSettingProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 rounded-2xl border-4 border-line bg-surface p-4">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-describedby={`${id}-description`}
        className="size-8 shrink-0 accent-accent"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <div>
        <label htmlFor={id} className="text-2xl font-bold">
          {label}
        </label>
        <p id={`${id}-description`} className="text-xl text-muted">
          {description}
        </p>
      </div>
    </div>
  );
}
