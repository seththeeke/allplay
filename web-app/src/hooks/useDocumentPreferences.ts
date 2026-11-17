import { useEffect } from "react";
import type { AppPreferences } from "../models/api";

/**
 * Applies theme, zoom and motion preferences to the document root, where the
 * theme stylesheets and root font size read them.
 */
export function useDocumentPreferences(preferences: AppPreferences): void {
  const { theme, zoomLevel, reducedMotion } = preferences;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset["theme"] = theme;
    root.dataset["motion"] = reducedMotion;
    root.style.fontSize = `${String(zoomLevel * 100)}%`;
  }, [theme, zoomLevel, reducedMotion]);
}
