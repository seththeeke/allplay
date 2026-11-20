import { Button } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { TextField } from "../components/TextField";
import { useVoiceLab } from "../hooks/useVoiceLab";

/**
 * Manual test bench for the voice path (local-development.md section 5):
 * each stage of a turn, from the local server's providers to what the backend
 * recorded.
 */
export function VoiceLabPage(): React.JSX.Element {
  const lab = useVoiceLab();
  const capabilities = Object.entries(lab.status.data?.capabilities ?? {});
  const busy = lab.phase === "TRANSCRIBING" || lab.phase === "SENDING";
  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeading
        title="Voice Lab"
        lead="Speak or type a command and watch it reach the backend."
      />

      <section aria-labelledby="lab-server" className="mb-8">
        <h2 id="lab-server" className="text-3xl font-bold">
          1. Local server
        </h2>
        {lab.status.isError ? (
          <p role="alert" className="mt-2 text-xl">
            The local server did not answer. Start it with npm run dev:server in backend/.
          </p>
        ) : (
          <table className="mt-2 w-full text-left text-xl">
            <caption className="text-left text-lg text-muted">
              Preset: {lab.status.data?.preset ?? "checking"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Provider</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map(([name, capability]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{capability.provider}</td>
                  <td>{capability.available ? "Ready" : capability.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="lab-speak" className="mb-8">
        <h2 id="lab-speak" className="text-3xl font-bold">
          2. Speak
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {lab.phase === "RECORDING" ? (
            <Button onClick={() => void lab.stop()}>Stop and transcribe</Button>
          ) : (
            <Button onClick={() => void lab.record()} disabled={busy}>
              Start recording
            </Button>
          )}
          <p role="status" className="text-xl">
            {lab.phase === "RECORDING" ? "Recording. Say a command, then stop." : null}
            {lab.phase === "TRANSCRIBING" ? "Transcribing." : null}
            {lab.phase === "IDLE" && lab.transcription !== null
              ? `Heard by ${lab.transcription.provider} in ${String(lab.transcription.latencyMs)} ms.`
              : null}
          </p>
        </div>
      </section>

      <section aria-labelledby="lab-send" className="mb-8">
        <h2 id="lab-send" className="text-3xl font-bold">
          3. Command
        </h2>
        <div className="mt-2 flex flex-col gap-4">
          <TextField
            id="lab-transcript"
            label="Transcript"
            value={lab.transcript}
            onChange={(value) => {
              lab.type(value);
            }}
            hint={`Source: ${lab.source}. Edit it or type a command.`}
          />
          <div>
            <Button onClick={() => void lab.send()} disabled={busy}>
              Send to backend
            </Button>
          </div>
          {lab.error === null ? null : (
            <p role="alert" className="text-xl">
              {lab.error}
            </p>
          )}
          {lab.reply === null ? null : (
            <div aria-live="polite" className="text-xl">
              <p>
                Backend reply: <strong>{lab.reply.outcome}</strong>
              </p>
              <p>{lab.reply.displayText}</p>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="lab-recent">
        <h2 id="lab-recent" className="text-3xl font-bold">
          4. Recorded by the backend
        </h2>
        {(lab.recent.data ?? []).length === 0 ? (
          <p className="mt-2 text-xl">No commands yet.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2 text-xl">
            {(lab.recent.data ?? []).map((decision) => (
              <li key={decision.decisionId}>
                <strong>{decision.transcript}</strong> ({decision.transcriptSource},{" "}
                {decision.outcome}, {new Date(decision.createdAt).toLocaleTimeString()})
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
