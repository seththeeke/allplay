import { passwordChecks } from "./passwordChecks";

export interface PasswordChecklistProps {
  id: string;
  password: string;
  confirmation: string;
}

/**
 * The password requirements, updated as the player types. Each line says
 * "Done" or "Needed" in words, so the state never rests on color alone.
 */
export function PasswordChecklist({
  id,
  password,
  confirmation,
}: PasswordChecklistProps): React.JSX.Element {
  return (
    <div id={id} className="flex flex-col gap-1">
      <p id={`${id}-title`} className="text-xl font-semibold">
        Your password needs:
      </p>
      <ul aria-labelledby={`${id}-title`} className="flex flex-col gap-1 text-xl">
        {passwordChecks(password, confirmation).map((check) => (
          <li key={check.text} className={check.met ? "text-ink" : "text-muted"}>
            <span className="inline-block w-28 font-bold">{check.met ? "Done:" : "Needed:"}</span>{" "}
            {check.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
