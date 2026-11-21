import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { PageHeading } from "../components/PageHeading";
import { ProviderButtons } from "../components/ProviderButtons";
import { TextField } from "../components/TextField";
import { errorMessage } from "./errorMessage";
import { usePlayer } from "../hooks/usePlayer";
import { PASSWORD_RULE } from "../models/api";

const message = (failure: unknown): string => errorMessage(failure, "Something went wrong.");

/** Create an account in two steps: email and password, then the emailed code. */
export function SignUpPage(): React.JSX.Element {
  const { run, service } = usePlayer();
  const navigate = useNavigate();
  const [step, setStep] = useState<"DETAILS" | "CODE">("DETAILS");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="flex max-w-2xl flex-col gap-6">
      <PageHeading title="Create an account" lead="Your games so far come with you." />
      {step === "DETAILS" ? (
        <>
          <ProviderButtons
            providers={service.providers}
            onChoose={(provider) => {
              void run((player) => player.signInWithProvider(provider)).then(() => navigate("/"));
            }}
          />
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              service.signUp(email, password).then(
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
            <TextField
              id="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              hint={PASSWORD_RULE}
              value={password}
              onChange={setPassword}
            />
            <FormError message={error} />
            <Button type="submit">Create account</Button>
          </form>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            run((player) => player.confirmSignUp(email, code)).then(
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
          <Button type="submit">Confirm</Button>
        </form>
      )}
    </main>
  );
}
