import { useContext, useEffect } from "react";
import { VoiceContext, type VoiceControls, type VoiceGameTarget } from "../voice/VoiceContext";

export function useVoice(): VoiceControls {
  const voice = useContext(VoiceContext);
  if (voice === null) throw new Error("useVoice must be used inside VoiceProvider");
  return voice;
}

/** Registers the game on screen as the target of voice game actions while it is mounted. */
export function useVoiceGameTarget(target: VoiceGameTarget | null): void {
  const { setGameTarget } = useVoice();
  useEffect(() => {
    setGameTarget(target);
    return () => {
      setGameTarget(null);
    };
  });
}
