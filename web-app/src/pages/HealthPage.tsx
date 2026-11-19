import { Button } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { useHealth, type HealthCheck } from "../hooks/useHealth";
import { errorMessage } from "./errorMessage";

function describe(result: HealthCheck): string {
  if (result.httpStatus === 200 && result.body !== null) {
    return `The server answered ${String(result.httpStatus)} OK from the ${result.body.stage} stage in ${String(result.latencyMs)} ms.`;
  }
  return `The server answered ${String(result.httpStatus)}, which is not healthy.`;
}

/** Calls GET /v1/health and shows the server's answer (cdk-stacks.md section 5). */
export function HealthPage(): React.JSX.Element {
  const { result, error, checking, recheck } = useHealth();
  const healthy = result?.httpStatus === 200 && result.body !== null;
  let state = "CHECKING";
  let message = "Checking the server.";
  if (!checking && error !== null) {
    state = "UNHEALTHY";
    message = `The server could not be reached. ${errorMessage(error, "")}`.trim();
  } else if (!checking && result !== null) {
    state = healthy ? "HEALTHY" : "UNHEALTHY";
    message = describe(result);
  }
  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeading title="Server health" lead="Checks that the game server is up." />
      <p role="status" className="text-2xl" data-health={state}>
        {message}
      </p>
      {result === null ? null : (
        <p className="mt-2 text-xl text-muted">HTTP status: {String(result.httpStatus)}</p>
      )}
      <div className="mt-6">
        <Button onClick={recheck} disabled={checking}>
          Check again
        </Button>
      </div>
    </main>
  );
}
