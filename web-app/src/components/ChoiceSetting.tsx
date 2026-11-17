export interface ChoiceOption<T extends string | number> {
  value: T;
  label: string;
}

export interface ChoiceSettingProps<T extends string | number> {
  name: string;
  legend: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
}

/** A large radio group: every option is a full-width target with a visible label. */
export function ChoiceSetting<T extends string | number>({
  name,
  legend,
  value,
  options,
  onChange,
}: ChoiceSettingProps<T>): React.JSX.Element {
  return (
    <fieldset className="rounded-2xl border-4 border-line bg-surface p-4">
      <legend className="px-2 text-2xl font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => {
          const id = `${name}-${String(option.value)}`;
          const checked = option.value === value;
          return (
            <label
              key={id}
              htmlFor={id}
              className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-4 px-4 text-xl font-semibold ${checked ? "border-accent" : "border-line"}`}
            >
              <input
                id={id}
                type="radio"
                name={name}
                className="size-6 accent-accent"
                checked={checked}
                onChange={() => {
                  onChange(option.value);
                }}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
