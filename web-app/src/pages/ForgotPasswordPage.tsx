import { useState } from "react";
import { Link } from "react-router";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { PageHeading } from "../components/PageHeading";
import { PasswordChecklist } from "../components/PasswordChecklist";
import { PasswordField } from "../components/PasswordField";
import { passwordReady } from "../components/passwordChecks";
import { TextField } from "../components/TextField";
import { errorMessage } from "./errorMessage";
import { useBusy } from "../hooks/useBusy";
import { usePlayer } from "../hooks/usePlayer";

/** Reset a password: request a code, then enter it with a new, checked password. */
export function ForgotPasswordPage(): React.JSX.Element {
  const { service } = usePlayer();
  const [step, setStep] = useState<"EMAIL" | "CODE" | "DONE">("EMAIL");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const { busy, track } = useBusy<"SEND" | "SAVE">();
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="flex max-w-2xl flex-col gap-6">
      <PageHeading title="Reset your password" />
      {step === "EMAIL" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            track("SEND", service.requestPasswordReset(email)).then(
              () => {
                setStep("CODE");
              },
              (failure: unknown) => {
                setError(errorMessage(failure, "Something went wrong."));
              },
            );
          }}
        >
          <TextField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
          />
          <FormError message={error} />
          <Button type="submit" busy={busy === "SEND"} busyLabel="Sending the code">
            Send me a code
          </Button>
        </form>
      ) : null}
      {step === "CODE" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (!passwordReady(password, confirmation)) {
              setError("Your new password does not meet every requirement yet.");
              return;
            }
            track("SAVE", service.confirmPasswordReset(email, code, password)).then(
              () => {
                setStep("DONE");
              },
              (failure: unknown) => {
                setError(errorMessage(failure, "Something went wrong."));
              },
            );
          }}
        >
          <p className="text-2xl">We sent a 6-digit code to {email}.</p>
          <TextField
            id="code"
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={setCode}
          />
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            describedBy="password-checks"
            value={password}
            onChange={setPassword}
          />
          <PasswordField
            id="new-password-confirmation"
            label="Confirm new password"
            autoComplete="new-password"
            describedBy="password-checks"
            value={confirmation}
            onChange={setConfirmation}
          />
          <PasswordChecklist id="password-checks" password={password} confirmation={confirmation} />
          <FormError message={error} />
          <Button type="submit" busy={busy === "SAVE"} busyLabel="Saving">
            Save new password
          </Button>
        </form>
      ) : null}
      {step === "DONE" ? (
        <p className="text-2xl">
          Your password is changed.{" "}
          <Link className="underline" to="/sign-in">
            Sign in
          </Link>
        </p>
      ) : null}
    </main>
  );
}
