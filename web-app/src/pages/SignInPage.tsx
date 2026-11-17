import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { PageHeading } from "../components/PageHeading";
import { ProviderButtons } from "../components/ProviderButtons";
import { TextField } from "../components/TextField";
import { errorMessage } from "./errorMessage";
import { usePlayer, type PlayerService } from "../hooks/usePlayer";
import type { PlayerMe } from "../models/api";

/** Sign in with Google, Apple, or email and password (authn-authz.md section 7.1). */
export function SignInPage(): React.JSX.Element {
  const { run } = usePlayer();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const attempt = (work: (service: PlayerService) => Promise<PlayerMe>): void => {
    setError(null);
    run(work).then(
      () => navigate("/"),
      (failure: unknown) => {
        setError(errorMessage(failure, "Sign in failed. Please try again."));
      },
    );
  };
  return (
    <main className="flex max-w-2xl flex-col gap-6">
      <PageHeading
        title="Sign in"
        lead="Signing in keeps your games and settings on every device."
      />
      <ProviderButtons
        onChoose={(provider) => {
          attempt((service) => service.signInWithProvider(provider));
        }}
      />
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          attempt((service) => service.signIn(email, password));
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
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <FormError message={error} />
        <Button type="submit">Sign in</Button>
      </form>
      <p className="flex flex-wrap gap-6 text-2xl">
        <Link className="underline" to="/forgot-password">
          Forgot your password?
        </Link>
        <Link className="underline" to="/sign-up">
          Create an account
        </Link>
      </p>
    </main>
  );
}
