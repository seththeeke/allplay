import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

export interface HelpStep {
  /** Matches a data-help-id attribute on the element this step points at. */
  target: string;
  title: string;
  body: string;
}

export interface HelpWalkthroughProps {
  steps: HelpStep[];
  onFinish: () => void;
}

/**
 * A step-by-step tour that highlights one part of the page at a time
 * (0-day-0-project-idea.md, Help Content). Shown on a player's first game and
 * replayable from the Help page.
 */
export function HelpWalkthrough({
  steps,
  onFinish,
}: HelpWalkthroughProps): React.JSX.Element | null {
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = steps[index];

  useEffect(() => {
    if (step === undefined) return undefined;
    const element = document.querySelector(`[data-help-id="${step.target}"]`);
    element?.setAttribute("data-help-highlight", "true");
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    heading.current?.focus();
    return () => {
      element?.removeAttribute("data-help-highlight");
    };
  }, [step]);

  if (step === undefined) return null;
  const last = index === steps.length - 1;
  return (
    <section
      aria-labelledby="help-step-title"
      className="fixed inset-x-4 top-24 z-30 mx-auto max-w-2xl rounded-2xl border-4 border-accent bg-surface p-6 shadow-2xl"
    >
      <p className="text-xl text-muted">
        Step {index + 1} of {steps.length}
      </p>
      <h2
        id="help-step-title"
        ref={heading}
        tabIndex={-1}
        className="mt-1 text-3xl font-bold outline-none"
      >
        {step.title}
      </h2>
      <p className="mt-3 text-2xl">{step.body}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {index > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              setIndex(index - 1);
            }}
          >
            Back
          </Button>
        ) : null}
        <Button
          onClick={() => {
            if (last) onFinish();
            else setIndex(index + 1);
          }}
        >
          {last ? "Start playing" : "Next"}
        </Button>
        {last ? null : (
          <Button variant="quiet" onClick={onFinish}>
            Skip the tour
          </Button>
        )}
      </div>
    </section>
  );
}
