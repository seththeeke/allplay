import { DeploymentsPanel } from "../components/DeploymentsPanel";
import { DuplicatesPanel } from "../components/DuplicatesPanel";
import { LineChart } from "../components/charts/LineChart";
import { formatNumber } from "../components/charts/scale";
import { StackedBarChart } from "../components/charts/StackedBarChart";
import { PageHeading } from "../components/PageHeading";
import { StatTile } from "../components/StatTile";
import { useAdmin } from "../hooks/useAdmin";

const ROUND_TRIP_TARGET_MS = 2000;

/** Product metrics and deployments (0-day-0-project-idea.md, Admin Functions and Key Metrics). */
export function AdminPage(): React.JSX.Element {
  const { days, failures, deployments, deploy, duplicates, mergeAccounts } = useAdmin();
  const periods = days.map((day) => day.period);
  const today = days[days.length - 1];
  const failureRate =
    today === undefined || today.decisions === 0
      ? 0
      : Math.round(((today.hardFailures + today.softFailures) / today.decisions) * 100);
  return (
    <main className="flex flex-col gap-6">
      <PageHeading title="Admin" lead="Product metrics for the last 30 days, and deployments." />
      {today === undefined ? (
        <p className="rounded-2xl border-4 border-line bg-surface p-4 text-2xl">
          No product metrics are recorded for these days yet. Counting starts with the first game or
          voice turn of a day.
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatTile
              label="Total players"
              value={formatNumber(today.totalPlayers)}
              detail={`${formatNumber(today.totalAccounts)} with accounts`}
            />
            <StatTile
              label="Active players"
              value={formatNumber(today.activePlayers30d)}
              detail="played in the last 30 days"
            />
            <StatTile
              label="Turn failures today"
              value={`${String(failureRate)}%`}
              detail={`${formatNumber(today.hardFailures)} hard, ${formatNumber(today.softFailures)} soft`}
            />
            <StatTile
              label="Median round trip today"
              value={`${((today.clientLatencyP50Ms ?? 0) / 1000).toFixed(1)} s`}
              detail={`target under ${String(ROUND_TRIP_TARGET_MS / 1000)} s`}
            />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <LineChart
              title="Active players"
              summary="Players who played in the last 30 days, measured each day."
              periods={periods}
              series={[
                {
                  name: "Active players",
                  values: days.map((day) => day.activePlayers30d),
                  colorClass: "text-series-1",
                },
              ]}
            />
            <StackedBarChart
              title="Turn failures"
              summary="Voice turns that failed each day. Hard: not understood, invalid or rejected. Soft: player picked from choices."
              periods={periods}
              series={[
                {
                  name: "Hard failures",
                  values: days.map((day) => day.hardFailures),
                  colorClass: "text-series-1",
                },
                {
                  name: "Soft failures",
                  values: days.map((day) => day.softFailures),
                  colorClass: "text-series-2",
                  hatched: true,
                },
              ]}
            />
            <LineChart
              title="Voice round trip"
              summary="Time from the end of speech to the move appearing, in milliseconds."
              periods={periods}
              unit=" ms"
              reference={{ value: ROUND_TRIP_TARGET_MS, label: "2 s target" }}
              series={[
                {
                  name: "Median",
                  values: days.map((day) => day.clientLatencyP50Ms ?? 0),
                  colorClass: "text-series-1",
                },
                {
                  name: "95th percentile",
                  values: days.map((day) => day.clientLatencyP95Ms ?? 0),
                  colorClass: "text-series-2",
                  dashed: true,
                },
              ]}
            />
          </div>
          <section
            aria-labelledby="failures-heading"
            className="rounded-2xl border-4 border-line bg-surface p-4"
          >
            <h2 id="failures-heading" className="mb-3 text-3xl font-bold">
              Recent turn failures
            </h2>
            <ul className="flex flex-col gap-2 text-xl">
              {failures.map((failure) => (
                <li key={failure.decisionId}>
                  <span className="font-semibold">&ldquo;{failure.transcript}&rdquo;</span>{" "}
                  <span className="text-muted">
                    {failure.outcome.toLowerCase().replace("_", " ")},{" "}
                    {failure.failureClass.toLowerCase()}
                    {failure.clientLatencyMs === null
                      ? ""
                      : `, ${formatNumber(failure.clientLatencyMs)} ms`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <DeploymentsPanel deployments={deployments} onDeploy={deploy} />
      <DuplicatesPanel duplicates={duplicates} onMerge={mergeAccounts} />
    </main>
  );
}
