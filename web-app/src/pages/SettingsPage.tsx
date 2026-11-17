import { useState } from "react";
import { Button } from "../components/Button";
import { ChoiceSetting } from "../components/ChoiceSetting";
import { PageHeading } from "../components/PageHeading";
import { ToggleSetting } from "../components/ToggleSetting";
import { usePreferences } from "../hooks/usePreferences";
import type { AppPreferences, PatchAppPreferences, Theme } from "../models/api";

const THEMES: { value: Theme; label: string }[] = [
  { value: "DEFAULT", label: "Standard" },
  { value: "HIGH_CONTRAST", label: "High contrast" },
  { value: "BLACK_AND_WHITE", label: "Black and white" },
  { value: "FOUR_COLOR", label: "Four-color deck" },
  { value: "DARK", label: "Dark" },
];

const MOTION: { value: AppPreferences["reducedMotion"]; label: string }[] = [
  { value: "SYSTEM", label: "Follow my device" },
  { value: "ON", label: "Reduce motion" },
  { value: "OFF", label: "Allow motion" },
];

const RATES = [
  { value: 0.75, label: "Slow" },
  { value: 1, label: "Normal" },
  { value: 1.25, label: "Fast" },
];

const TIMEOUTS = [
  { value: 800, label: "Short pause" },
  { value: 1200, label: "Normal pause" },
  { value: 2000, label: "Long pause" },
];

/** Every setting saves as soon as it changes (authn-authz.md section 1). */
export function SettingsPage(): React.JSX.Element {
  const { preferences, updateApp } = usePreferences();
  const [saved, setSaved] = useState<string | null>(null);
  const save = (patch: PatchAppPreferences, what: string): void => {
    updateApp(patch);
    setSaved(`${what} saved.`);
  };
  const zoomPercent = Math.round(preferences.zoomLevel * 100);
  return (
    <main className="flex flex-col gap-6">
      <PageHeading title="Settings" lead="Changes save automatically." />
      <p aria-live="polite" className="min-h-8 text-xl font-semibold">
        {saved}
      </p>
      <section
        aria-labelledby="zoom-heading"
        className="flex flex-wrap items-center gap-4 rounded-2xl border-4 border-line bg-surface p-4"
      >
        <h2 id="zoom-heading" className="mr-auto text-2xl font-bold">
          Text and card size: {zoomPercent}%
        </h2>
        <Button
          variant="secondary"
          disabled={preferences.zoomLevel <= 1}
          onClick={() => {
            save({ zoomLevel: preferences.zoomLevel - 0.25 }, "Size");
          }}
        >
          Smaller
        </Button>
        <Button
          variant="secondary"
          disabled={preferences.zoomLevel >= 3}
          onClick={() => {
            save({ zoomLevel: preferences.zoomLevel + 0.25 }, "Size");
          }}
        >
          Bigger
        </Button>
      </section>
      <ChoiceSetting
        name="theme"
        legend="Colors"
        value={preferences.theme}
        options={THEMES}
        onChange={(theme) => {
          save({ theme }, "Colors");
        }}
      />
      <ToggleSetting
        id="auto-confirm"
        label="Make voice moves right away"
        description="When on, a move you ask for happens without asking you to confirm it."
        checked={preferences.autoConfirm}
        onChange={(autoConfirm) => {
          save({ autoConfirm }, "Voice confirmation");
        }}
      />
      <ToggleSetting
        id="voice-output"
        label="Speak to me"
        description="Reads questions, hints and problems aloud."
        checked={preferences.voiceOutputEnabled}
        onChange={(voiceOutputEnabled) => {
          save({ voiceOutputEnabled }, "Voice output");
        }}
      />
      <ChoiceSetting
        name="speech-rate"
        legend="Speaking speed"
        value={preferences.speechRate}
        options={RATES}
        onChange={(speechRate) => {
          save({ speechRate }, "Speaking speed");
        }}
      />
      <ChoiceSetting
        name="listen-timeout"
        legend="How long to wait after I stop talking"
        value={preferences.listenTimeoutMs}
        options={TIMEOUTS}
        onChange={(listenTimeoutMs) => {
          save({ listenTimeoutMs }, "Listening pause");
        }}
      />
      <ChoiceSetting
        name="motion"
        legend="Animations"
        value={preferences.reducedMotion}
        options={MOTION}
        onChange={(reducedMotion) => {
          save({ reducedMotion }, "Animations");
        }}
      />
    </main>
  );
}
