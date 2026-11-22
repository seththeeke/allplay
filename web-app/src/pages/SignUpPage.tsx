import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { PageHeading } from "../components/PageHeading";
import { PasswordChecklist } from "../components/PasswordChecklist";
import { PasswordField } from "../components/PasswordField";
import { passwordReady } from "../components/passwordChecks";
import { ProviderButtons } from "../components/ProviderButtons";
import { TextField } from "../components/TextField";
import { errorMessage } from "./errorMessage";
import { useBusy } from "../hooks/useBusy";
import { usePlayer } from "../hooks/usePlayer";

const message = (failure: unknown): string => errorMessage(failure, "Something went wrong.");

/** Create an account in two steps: email and a checked password, then the emailed code. */
export function SignUpPage(): React.JSX.Element {
  const { run, service } = usePlayer();
  const navigate = useNavigate();
  const { busy, track } = useBusy<"CREATE" | "CONFIRM" | "GOOGLE" | "APPLE">();
  const [step, setStep] = useState<"DETAILS" | "CODE">("DETAILS");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="flex max-w-2xl flex-col gap-6">
      <PageHeading title="Create an account" lead="Your games so far come with you." />
      {step === "DETAILS" ? (
        <>
          <ProviderButtons
            providers={service.providers}
            busy={busy === "GOOGLE" || busy === "APPLE" ? busy : null}
            onChoose={(provider) => {
              void track(
                provider,
                run((player) => player.signInWithProvider(provider)),
              ).then(() => navigate("/"));
            }}
          />
          <form
            className="flex flex-col gap-4"
            aria-busy={busy === "CREATE"}
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              if (!passwordReady(password, confirmation)) {
                setError("Your password does not meet every requirement yet.");
                return;
              }
              track("CREATE", service.signUp(email, password)).then(
                () => {
                  setStep("CODE");
                },
                (failure: unknown) => {
                  setError(message(failure));
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
            <PasswordField
              id="password"
              label="Password"
              autoComplete="new-password"
              describedBy="password-checks"
              value={password}
              onChange={setPassword}
            />
            <PasswordField
              id="password-confirmation"
              label="Confirm password"
              autoComplete="new-password"
              describedBy="password-checks"
              value={confirmation}
              onChange={setConfirmation}
            />
            <PasswordChecklist
              id="password-checks"
              password={password}
              confirmation={confirmation}
            />
            <FormError message={error} />
            <Button type="submit" busy={busy === "CREATE"} busyLabel="Creating account">
              Create account
            </Button>
          </form>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          aria-busy={busy === "CONFIRM"}
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            track(
              "CONFIRM",
              run((player) => player.confirmSignUp(email, code)),
            ).then(
              () => navigate("/"),
              (failure: unknown) => {
                setError(message(failure));
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
          <FormError message={error} />
          <Button type="submit" busy={busy === "CONFIRM"} busyLabel="Confirming">
            Confirm
          </Button>
        </form>
      )}
    </main>
  );
}
