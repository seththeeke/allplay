import { useState } from "react";
import type { Deployment } from "../models/api";
import { Button } from "./Button";

export interface DeploymentsPanelProps {
  deployments: Deployment[];
  onDeploy: () => Promise<void>;
}

const STATUS_TEXT: Record<Deployment["status"], string> = {
  IN_PROGRESS: "In progress",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  STOPPED: "Stopped",
  SUPERSEDED: "Superseded",
};

/** Recent pipeline runs and the on-demand deploy, which always asks first. */
export function DeploymentsPanel({
  deployments,
  onDeploy,
}: DeploymentsPanelProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="deployments-heading"
      className="rounded-2xl border-4 border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="deployments-heading" className="mr-auto text-3xl font-bold">
          Deployments
        </h2>
        {confirming ? (
          <>
            <p className="text-xl font-semibold">Deploy the latest code to Test, then Prod?</p>
            <Button
              onClick={() => {
                setConfirming(false);
                void onDeploy().then(() => {
                  setNotice("Deployment started.");
                });
              }}
            >
              Confirm
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            onClick={() => {
              setConfirming(true);
            }}
          >
            Deploy now
          </Button>
        )}
      </div>
      <p aria-live="polite" className="min-h-8 text-xl font-semibold">
        {notice}
      </p>
      <table className="w-full text-left text-lg">
        <thead>
          <tr className="border-b-2 border-line">
            <th scope="col" className="p-2">
              Started
            </th>
            <th scope="col" className="p-2">
              Trigger
            </th>
            <th scope="col" className="p-2">
              Status
            </th>
            <th scope="col" className="p-2">
              Stages
            </th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((deployment) => (
            <tr key={deployment.executionId} className="border-b border-line">
              <td className="p-2">{deployment.startedAt.replace("T", " ").slice(0, 16)}</td>
              <td className="p-2">
                {deployment.trigger === "ADMIN"
                  ? "Admin"
                  : deployment.trigger === "SCHEDULE"
                    ? "Daily"
                    : "Manual"}
              </td>
              <td className="p-2 font-semibold">{STATUS_TEXT[deployment.status]}</td>
              <td className="p-2">
                {deployment.stages
                  .map((stage) => `${stage.name}: ${STATUS_TEXT[stage.status]}`)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
