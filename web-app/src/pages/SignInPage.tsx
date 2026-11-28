import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { PageHeading } from "../components/PageHeading";
import { PasswordField } from "../components/PasswordField";
import { NewPasswordForm } from "../components/NewPasswordForm";
import { ProviderButtons } from "../components/ProviderButtons";
import { nextPath } from "../routes/InviteGate";
import { TextField } from "../components/TextField";
import { errorMessage } from "./errorMessage";
import { useBusy } from "../hooks/useBusy";
import { NewPasswordRequiredError, usePlayer, type PlayerService } from "../hooks/usePlayer";
import type { PlayerMe } from "../models/api";

/** Sign in with Google, Apple, or email and password (authn-authz.md section 7.1). */
export function SignInPage(): React.JSX.Element {
  const { run, service } = usePlayer();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { busy, track } = useBusy<"EMAIL" | "GOOGLE" | "APPLE" | "NEW_PASSWORD">();
  const [choosing, setChoosing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const attempt = (
    key: "EMAIL" | "GOOGLE" | "APPLE" | "NEW_PASSWORD",
    work: (service: PlayerService) => Promise<PlayerMe>,
  ): void => {
    setError(null);
    track(key, run(work)).then(
      /* Only a finished link returns a guest from a sign-in: the device signed out to switch accounts. */
      (me) => navigate(me.kind === "GUEST" ? "/sign-in?linked=1" : nextPath(search.get("next"))),
      (failure: unknown) => {
        if (failure instanceof NewPasswordRequiredError) {
          setChoosing(true);
          return;
        }
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
      {service.inviteOnly ? (
        <p role="status" className="rounded-2xl border-4 border-line bg-surface p-4 text-2xl">
          All Play Test is invite only. Sign in with the email your invitation went to.
        </p>
      ) : null}
      {choosing ? (
        <NewPasswordForm
          busy={busy === "NEW_PASSWORD"}
          error={error}
          onSubmit={(newPassword) => {
            attempt("NEW_PASSWORD", (player) => player.completeNewPassword(newPassword));
          }}
        />
      ) : null}
      {search.has("link") ? (
        <p role="status" className="rounded-2xl border-4 border-line bg-surface p-4 text-2xl">
          Now sign in with the other method. Its games and settings move into the account you
          started from.
        </p>
      ) : null}
      {search.has("linked") ? (
        <p role="status" className="rounded-2xl border-4 border-line bg-surface p-4 text-2xl">
          Linked. Sign in again with either method to reach your account.
        </p>
      ) : null}
      <ProviderButtons
        providers={service.providers}
        busy={busy === "GOOGLE" || busy === "APPLE" ? busy : null}
        onChoose={(provider) => {
          attempt(provider, (service) => service.signInWithProvider(provider));
        }}
      />
      <form
        hidden={choosing}
        className="flex flex-col gap-4"
        aria-busy={busy === "EMAIL"}
        onSubmit={(event) => {
          event.preventDefault();
          attempt("EMAIL", (service) => service.signIn(email, password));
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
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <FormError message={error} />
        <Button type="submit" busy={busy === "EMAIL"} busyLabel="Signing in">
          Sign in
        </Button>
      </form>
      <p className="flex flex-wrap gap-6 text-2xl">
        <Link className="underline" to="/forgot-password">
          Forgot your password?
        </Link>
        {service.inviteOnly ? null : (
          <Link className="underline" to="/sign-up">
            Create an account
          </Link>
        )}
      </p>
    </main>
  );
}
