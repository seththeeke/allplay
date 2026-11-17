import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiModels = path.resolve(import.meta.dirname, "../backend/src/models/api");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@allplay/api-models": apiModels },
    /* The contract models live in backend/ but must use this package's zod, since CI installs one package at a time. */
    dedupe: ["zod"],
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [import.meta.dirname, apiModels] },
  },
  build: {
    sourcemap: true,
  },
});
