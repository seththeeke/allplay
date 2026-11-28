import type { AppPreferences } from "../../src/models/api";

/** A value other than the default for every APP setting (productionalization.md section 12). */
export const CHANGED_SETTINGS: AppPreferences = {
  zoomLevel: 2.5,
  theme: "HIGH_CONTRAST",
  voiceOutputEnabled: true,
  voiceId: "Matthew",
  speechRate: 1.25,
  autoConfirm: true,
  reducedMotion: "ON",
  listenTimeoutMs: 2000,
  appHelpSeen: true,
  voiceMode: "TURN_BASED",
};
