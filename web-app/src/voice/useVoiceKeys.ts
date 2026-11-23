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
 * alone, and Enter on a focused button keeps its normal meaning. Nothing
 * listens unless voice is active, which is only while a game is open.
 */
export function useVoiceKeys(
  controls: VoiceControls,
  active = true,
  spaceHandler: { readonly current: (() => void) | null } = { current: null },
): void {
  const { phase, speaking, startListening, confirm, cancel, choose } = controls;
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && (phase !== "IDLE" || speaking)) {
        event.preventDefault();
        cancel();
        return;
      }
      if (isTextEntry(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === " " && spaceHandler.current !== null) {
        event.preventDefault();
        spaceHandler.current();
        return;
      }
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
  }, [active, phase, speaking, spaceHandler, startListening, confirm, cancel, choose]);
}
