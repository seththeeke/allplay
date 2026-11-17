import { useEffect } from "react";
import type { VoiceControls } from "./VoiceContext";

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * The key map (action-decision.md section 3.3): Space talks, Enter confirms,
 * Escape cancels, 1 to 4 pick a choice. Keys typed into form fields are left
 * alone, and Enter on a focused button keeps its normal meaning.
 */
export function useVoiceKeys(controls: VoiceControls): void {
  const { phase, startListening, confirm, cancel, choose } = controls;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && phase !== "IDLE") {
        event.preventDefault();
        cancel();
        return;
      }
      if (isTextEntry(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === " " && phase !== "LISTENING" && phase !== "DECIDING") {
        event.preventDefault();
        startListening();
        return;
      }
      if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        if (phase === "PROPOSAL" || phase === "CONFIRM_APP") {
          event.preventDefault();
          confirm();
        }
        return;
      }
      if (phase === "CHOICES" && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        choose(Number(event.key));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [phase, startListening, confirm, cancel, choose]);
}
