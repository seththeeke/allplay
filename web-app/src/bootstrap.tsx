import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "aws-amplify/auth/enable-oauth-listener";
import { loadConfig } from "./config";
import { cognitoConfigOf, retryLinkedSignIn } from "./services/live/amplifyServices";
import "./index.css";

/** Loads stage configuration, then mounts the app; a config failure shows a plain error page. */
export async function bootstrap(
  container: HTMLElement | null = document.getElementById("root"),
): Promise<void> {
  if (container === null) throw new Error("Missing #root element");
  const root = createRoot(container);
  try {
    const config = await loadConfig();
    /* A Google or Apple sign-in that was just linked to an existing account is retried once (AA-2). */
    if (
      config.stage !== "LOCAL" &&
      cognitoConfigOf(config) !== null &&
      (await retryLinkedSignIn(globalThis.location, globalThis.sessionStorage))
    )
      return;
    root.render(
      <StrictMode>
        <App config={config} />
      </StrictMode>,
    );
  } catch (error) {
    const message = String(error);
    root.render(
      <main role="alert">
        <h1>All Play could not start</h1>
        <p>{message}</p>
      </main>,
    );
  }
}
