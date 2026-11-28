import { useState } from "react";
import { Button } from "./Button";
import { FormError } from "./FormError";
import { PasswordChecklist } from "./PasswordChecklist";
import { PasswordField } from "./PasswordField";
import { passwordReady } from "./passwordChecks";

export interface NewPasswordFormProps {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
}

/** "Choose your password" for an invited player's first sign-in (productionalization.md section 3). */
export function NewPasswordForm({
  busy,
  error,
  onSubmit,
}: NewPasswordFormProps): React.JSX.Element {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      aria-busy={busy}
      aria-labelledby="new-password-heading"
      onSubmit={(event) => {
        event.preventDefault();
        if (passwordReady(password, confirmation)) onSubmit(password);
      }}
    >
      <h2 id="new-password-heading" className="text-3xl font-bold">
        Choose your password
      </h2>
      <p className="text-xl">Your invitation password works once. Pick one of your own.</p>
      <PasswordField
        id="new-password"
        label="New password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        describedBy="new-password-checks"
      />
      <PasswordField
        id="new-password-again"
        label="Type it again"
        autoComplete="new-password"
        value={confirmation}
        onChange={setConfirmation}
      />
      <PasswordChecklist id="new-password-checks" password={password} confirmation={confirmation} />
      <FormError message={error} />
      <Button type="submit" busy={busy} busyLabel="Saving password">
        Save password and sign in
      </Button>
    </form>
  );
}
