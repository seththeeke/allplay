import type { SignInProvider } from "../hooks/usePlayer";
import { Button } from "./Button";

export interface ProviderButtonsProps {
  onChoose: (provider: SignInProvider) => void;
}

/** Google and Apple sign-in (authn-authz.md section 3.1). */
export function ProviderButtons({ onChoose }: ProviderButtonsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button
        variant="secondary"
        onClick={() => {
          onChoose("GOOGLE");
        }}
      >
        Continue with Google
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          onChoose("APPLE");
        }}
      >
        Continue with Apple
      </Button>
    </div>
  );
}
