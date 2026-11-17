import { useState } from "react";
import { Link } from "react-router";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { PageHeading } from "../components/PageHeading";
import { TextField } from "../components/TextField";
import { errorMessage } from "./errorMessage";
import { usePlayer } from "../hooks/usePlayer";
import { PASSWORD_RULE } from "../models/api";

/** Reset a password: request a code, then enter it with a new password. */
export function ForgotPasswordPage(): React.JSX.Element {
  const { service } = usePlayer();
  const [step, setStep] = useState<"EMAIL" | "CODE" | "DONE">("EMAIL");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="flex max-w-2xl flex-col gap-6">
      <PageHeading title="Reset your password" />
      {step === "EMAIL" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void service.requestPasswordReset(email).then(() => {
              setStep("CODE");
            });
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
          <Button type="submit">Send me a code</Button>
        </form>
      ) : null}
      {step === "CODE" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            service.confirmPasswordReset(email, code, password).then(
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
          <TextField
            id="new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            hint={PASSWORD_RULE}
            value={password}
            onChange={setPassword}
          />
          <FormError message={error} />
          <Button type="submit">Save new password</Button>
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
