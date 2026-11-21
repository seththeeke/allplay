import { useState } from "react";
import type { DuplicateAccountsResponse } from "../models/api";
import { Button } from "./Button";

export interface DuplicatesPanelProps {
  duplicates: DuplicateAccountsResponse["duplicates"];
  onMerge: (primaryPlayerId: string, duplicatePlayerId: string) => Promise<void>;
}

const PROVIDER_TEXT = { COGNITO: "email", GOOGLE: "Google", APPLE: "Apple" } as const;

/**
 * Accounts that share an email (authn-authz.md section 6.2). Each newer
 * account can be folded into the oldest, after a confirmation, because the
 * merge deletes the newer account's sign-in user.
 */
export function DuplicatesPanel({ duplicates, onMerge }: DuplicatesPanelProps): React.JSX.Element {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="duplicates-heading"
      className="rounded-2xl border-4 border-line bg-surface p-4"
    >
      <h2 id="duplicates-heading" className="mb-3 text-3xl font-bold">
        Duplicate accounts
      </h2>
      {notice === null ? null : (
        <p role="status" className="mb-3 text-xl font-semibold">
          {notice}
        </p>
      )}
      {duplicates.length === 0 ? (
        <p className="text-xl text-muted">No accounts share an email.</p>
      ) : (
        <ul className="flex flex-col gap-4 text-xl">
          {duplicates.map(({ emailKey, accounts }) => {
            const [primary, ...newer] = accounts;
            return (
              <li key={emailKey} className="flex flex-col gap-2">
                <p className="font-semibold">{emailKey}</p>
                <p className="text-muted">
                  Keeps {primary?.playerId} ({primary?.createdAt.slice(0, 10)})
                </p>
                {newer.map((account) => (
                  <div key={account.playerId} className="flex flex-wrap items-center gap-3">
                    <span>
                      {account.playerId}, {account.createdAt.slice(0, 10)},{" "}
                      {account.signInProviders.map((p) => PROVIDER_TEXT[p]).join(" and ") ||
                        "no sign-in recorded"}
                    </span>
                    {confirming === account.playerId ? (
                      <>
                        <Button
                          onClick={() => {
                            setConfirming(null);
                            void onMerge(primary?.playerId ?? "", account.playerId).then(
                              () => {
                                setNotice(`Merged ${account.playerId}.`);
                              },
                              () => {
                                setNotice(`Could not merge ${account.playerId}.`);
                              },
                            );
                          }}
                        >
                          Yes, merge into the oldest
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setConfirming(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setConfirming(account.playerId);
                        }}
                      >
                        Merge
                      </Button>
                    )}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
