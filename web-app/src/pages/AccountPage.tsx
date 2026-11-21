import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { usePlayer } from "../hooks/usePlayer";

/** Account: sign out, link a second sign-in method, or delete the account (authn-authz.md sections 6.1 and 8). */
export function AccountPage(): React.JSX.Element {
  const { player, run } = usePlayer();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const leave = (work: Parameters<typeof run>[0]) => () => {
    void run(work).then(() => navigate("/"));
  };
  return (
    <main className="flex flex-col gap-6">
      <PageHeading title="Account" lead={player?.email} />
      <div>
        <Button variant="secondary" onClick={leave((service) => service.signOut())}>
          Sign out
        </Button>
      </div>
      <section
        aria-labelledby="link-heading"
        className="max-w-2xl rounded-2xl border-4 border-line bg-surface p-4"
      >
        <h2 id="link-heading" className="text-2xl font-bold">
          Link another sign-in method
        </h2>
        <p className="text-xl text-muted">
          Signed in another way before, such as with Google after Apple? Link it, and both reach
          this account with all its games.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => {
            void run((service) => service.startLink()).then(() => navigate("/sign-in?link=1"));
          }}
        >
          Link another sign-in method
        </Button>
      </section>
      <section
        aria-labelledby="delete-heading"
        className="max-w-2xl rounded-2xl border-4 border-line bg-surface p-4"
      >
        <h2 id="delete-heading" className="text-2xl font-bold">
          Delete account
        </h2>
        <p className="text-xl text-muted">
          This removes your account, games, statistics and settings for good.
        </p>
        {confirmingDelete ? (
          <div className="mt-3 flex flex-wrap gap-3">
            <Button onClick={leave((service) => service.deleteAccount())}>
              Yes, delete my account
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmingDelete(false);
              }}
            >
              Keep my account
            </Button>
          </div>
        ) : (
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => {
              setConfirmingDelete(true);
            }}
          >
            Delete account
          </Button>
        )}
      </section>
    </main>
  );
}
