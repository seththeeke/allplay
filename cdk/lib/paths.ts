import { fileURLToPath } from "node:url";

/** The backend package, whose Lambda entry points the AllPlayFunction construct bundles. */
export const BACKEND_DIR = fileURLToPath(new URL("../../backend/", import.meta.url));

/** The web app's production build, which the pipeline's synth step builds first. */
export const WEB_DIST_DIR = fileURLToPath(new URL("../../web-app/dist/", import.meta.url));
