import { useState } from "react";
import { Button } from "./Button";
import { TextField } from "./TextField";

export interface InvitePanelProps {
  onInvite: (email: string) => Promise<string>;
}

/**
 * Invites a player by email (productionalization.md section 3): Cognito
 * emails them a temporary password, which they change on first sign-in.
 */
export function InvitePanel({ onInvite }: InvitePanelProps): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="invite-heading"
      className="rounded-2xl border-4 border-line bg-surface p-4"
    >
      <h2 id="invite-heading" className="mb-3 text-3xl font-bold">
        Invite a player
      </h2>
      <form
        className="flex flex-col gap-3"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setNotice(null);
          onInvite(email).then(
            (invited) => {
              setNotice(`Invited ${invited}. Send them this site's link.`);
              setEmail("");
              setBusy(false);
            },
            (failure: unknown) => {
              setNotice(
                failure instanceof Error && failure.message !== ""
                  ? failure.message
                  : "The invitation failed.",
              );
              setBusy(false);
            },
          );
        }}
      >
        <TextField
          id="invite-email"
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={setEmail}
        />
        <Button type="submit" busy={busy} busyLabel="Inviting">
          Send invitation
        </Button>
      </form>
      {notice === null ? null : (
        <p role="status" className="mt-3 text-xl font-semibold">
          {notice}
        </p>
      )}
    </section>
  );
}
