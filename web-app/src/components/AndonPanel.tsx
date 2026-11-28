import { useState } from "react";
import type { AndonState } from "../models/api";
import { Button } from "./Button";

export interface AndonPanelProps {
  andon: AndonState | undefined;
  onChange: (pulled: boolean) => Promise<void>;
}

const BY_TEXT = { BUDGET: "a cost budget", ADMIN: "an admin" } as const;

/**
 * The andon cord (productionalization.md section 4.4): whether play is paused,
 * why, and one button to pause or restart it after a confirmation.
 */
export function AndonPanel({ andon, onChange }: AndonPanelProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const pulled = andon?.pulled ?? false;
  return (
    <section
      aria-labelledby="andon-heading"
      className={`rounded-2xl border-4 bg-surface p-4 ${pulled ? "border-accent" : "border-line"}`}
    >
      <h2 id="andon-heading" className="mb-3 text-3xl font-bold">
        Andon cord
      </h2>
      <p role="status" className="mb-3 text-2xl font-semibold">
        {andon === undefined
          ? "Checking..."
          : pulled
            ? `Play is paused in this stage, by ${BY_TEXT[andon.pulledBy ?? "ADMIN"]}: ${andon.reason ?? ""}.`
            : "Play is running."}
      </p>
      {(andon?.changedAt ?? null) === null ? null : (
        <p className="mb-3 text-xl text-muted">
          Last changed {andon?.changedAt?.slice(0, 16)} UTC.
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              setConfirming(false);
              void onChange(!pulled);
            }}
          >
            {pulled ? "Yes, restart play" : "Yes, pause play"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          disabled={andon === undefined}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {pulled ? "Restart play" : "Pause play"}
        </Button>
      )}
    </section>
  );
}
