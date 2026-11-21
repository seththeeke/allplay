import type { SignInProvider } from "../hooks/usePlayer";
import { Button } from "./Button";

export interface ProviderButtonsProps {
  /** The providers the stage offers; none renders nothing. */
  providers: SignInProvider[];
  onChoose: (provider: SignInProvider) => void;
}

const LABELS: Record<SignInProvider, string> = {
  GOOGLE: "Continue with Google",
  APPLE: "Continue with Apple",
};

/** Google and Apple sign-in (authn-authz.md section 3.1), for the providers the stage has. */
export function ProviderButtons({
  providers,
  onChoose,
}: ProviderButtonsProps): React.JSX.Element | null {
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {providers.map((provider) => (
        <Button
          key={provider}
          variant="secondary"
          onClick={() => {
            onChoose(provider);
          }}
        >
          {LABELS[provider]}
        </Button>
      ))}
    </div>
  );
}
