import type { OrbState } from "../voice/useConversation";

export interface VoiceOrbProps {
  state: OrbState;
  paused: boolean;
  onPress: () => void;
}

/**
 * The game speaker (conversational-ai.md section 8): large while greeting,
 * then small in the bottom left corner. Pressing it pauses or resumes
 * listening. With reduced motion each state is a still ring style.
 */
export function VoiceOrb({ state, paused, onPress }: VoiceOrbProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-help-id="talk"
      data-testid="voice-orb"
      data-state={state}
      aria-pressed={paused}
      aria-label={paused ? "Resume listening (Space)" : "Pause listening (Space)"}
      onClick={onPress}
      className="ap-orb"
    >
      <span aria-hidden="true" className="ap-orb-ring" />
      <span aria-hidden="true" className="ap-orb-core" />
      {state === "PAUSED" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="ap-orb-slash">
          <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="3" />
        </svg>
      ) : null}
    </button>
  );
}
