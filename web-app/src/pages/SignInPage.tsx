import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { usePlayer } from "../hooks/usePlayer";

/** Prototype sign-in; Cognito, Google and Apple sign-in replace the body in AA-9. */
export function SignInPage(): React.JSX.Element {
  const { signIn } = usePlayer();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  return (
    <main>
      <PageHeading
        title="Sign in"
        lead="Signing in keeps your games and settings on every device."
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(email).then(() => navigate("/"));
        }}
        className="flex max-w-xl flex-col gap-4"
      >
        <label htmlFor="email" className="text-2xl font-semibold">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          className="min-h-14 rounded-xl border-4 border-line bg-surface px-4 text-2xl"
        />
        <Button type="submit">Sign in</Button>
      </form>
    </main>
  );
}
