import { useOrbCanvas, ORB_PIXELS } from "../hooks/useOrbCanvas";
import { usePreferences } from "../hooks/usePreferences";
import type { OrbState } from "../voice/useConversation";

export interface VoiceOrbProps {
  state: OrbState;
  paused: boolean;
  onPress: () => void;
}

/**
 * The game speaker (conversational-ai.md section 8): a round view of a cloudy
 * sky, large while greeting and then small in the bottom left corner.
 * Pressing it pauses or resumes listening. With reduced motion it holds
 * still and the ring style shows each state.
 */
export function VoiceOrb({ state, paused, onPress }: VoiceOrbProps): React.JSX.Element {
  const { preferences } = usePreferences();
  const canvas = useOrbCanvas(state, preferences.reducedMotion);
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
      <canvas
        ref={canvas}
        aria-hidden="true"
        width={ORB_PIXELS}
        height={ORB_PIXELS}
        className="ap-orb-planet"
      />
      <span aria-hidden="true" className="ap-orb-ring" />
      {state === "PAUSED" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="ap-orb-slash">
          <line x1="4" y1="4" x2="20" y2="20" stroke="#000000" strokeWidth="5" />
          <line x1="4" y1="4" x2="20" y2="20" stroke="#ffffff" strokeWidth="2.5" />
        </svg>
      ) : null}
    </button>
  );
}
