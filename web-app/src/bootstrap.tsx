import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./config";
import "./index.css";

/** Loads stage configuration, then mounts the app; a config failure shows a plain error page. */
export async function bootstrap(
  container: HTMLElement | null = document.getElementById("root"),
): Promise<void> {
  if (container === null) throw new Error("Missing #root element");
  const root = createRoot(container);
  try {
    const config = await loadConfig();
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
