import type { DayMetrics } from "../models/api";
import { LineChart } from "./charts/LineChart";
import { formatNumber } from "./charts/scale";
import { StatTile } from "./StatTile";

type Histogram =
  | "clientLatency"
  | "serverLatency"
  | "llmLatency"
  | "transcribeLatency"
  | "pollyLatency"
  | "moveLatency";

/** Every latency the admin page charts (productionalization.md section 7), with what it measures. */
export const LATENCIES: readonly { histogram: Histogram; title: string; summary: string }[] = [
  {
    histogram: "clientLatency",
    title: "Voice round trip",
    summary: "End of speech to the move on screen, measured in the browser.",
  },
  {
    histogram: "transcribeLatency",
    title: "Transcribe",
    summary: "End of speech to the final transcript, measured in the browser.",
  },
  {
    histogram: "serverLatency",
    title: "Decision",
    summary: "A voice turn on the server, from request to answer.",
  },
  {
    histogram: "llmLatency",
    title: "Language model",
    summary: "Each Bedrock call of a voice turn.",
  },
  {
    histogram: "pollyLatency",
    title: "Polly",
    summary:
      "Request to spoken audio ready, measured in the browser; cached replies are not counted.",
  },
  {
    histogram: "moveLatency",
    title: "Move",
    summary: "A move or undo on the server, from request to answer.",
  },
];

const ms = (value: number | null): string =>
  value === null ? "No data" : `${formatNumber(value)} ms`;

/** Today's median and 95th percentile of each latency, then 30 days of each as a chart. */
export function LatencySection({ days }: { days: DayMetrics[] }): React.JSX.Element {
  const today = days[days.length - 1];
  const periods = days.map((day) => day.period);
  return (
    <section aria-labelledby="latency-heading" className="flex flex-col gap-4">
      <h2 id="latency-heading" className="text-3xl font-bold">
        Latency
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        {LATENCIES.map(({ histogram, title }) => (
          <StatTile
            key={histogram}
            label={`${title} today`}
            value={ms(today?.[`${histogram}P50Ms`] ?? null)}
            detail={`95th percentile ${ms(today?.[`${histogram}P95Ms`] ?? null)}`}
          />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {LATENCIES.filter(({ histogram }) => histogram !== "clientLatency").map(
          ({ histogram, title, summary }) => (
            <LineChart
              key={histogram}
              title={`${title} latency`}
              summary={summary}
              periods={periods}
              unit=" ms"
              series={[
                {
                  name: "Median",
                  values: days.map((day) => day[`${histogram}P50Ms`] ?? 0),
                  colorClass: "text-series-1",
                },
                {
                  name: "95th percentile",
                  values: days.map((day) => day[`${histogram}P95Ms`] ?? 0),
                  colorClass: "text-series-2",
                  dashed: true,
                },
              ]}
            />
          ),
        )}
      </div>
    </section>
  );
}
