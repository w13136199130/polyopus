import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// Build output lands inside the Python package (docs/49 §12): `src/polyopus/web`
// is a committed build artifact — CI rebuilds and fails on drift, exactly like
// contracts/generated. Never hand-edit files under it.
const OUT_DIR = fileURLToPath(new URL("../src/polyopus/web", import.meta.url));

// dev/preview proxy: same-origin cookies, no CORS (docs/49 F8). The same
// http-proxy config powers `vite preview`; e2e points the preview proxy at
// a dedicated FakeModel backend via POLY_API_TARGET.
const API_TARGET = process.env.POLY_API_TARGET || "http://127.0.0.1:8000";
const proxy = {
  "/api": { target: API_TARGET, changeOrigin: false },
  "/healthz": { target: API_TARGET, changeOrigin: false },
};

export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH || "/",
  // keep the deps-optimizer cache out of node_modules: some setups (AV,
  // sandboxes) block the esbuild service process from writing there.
  // POLY_VITE_CACHE overrides (e.g. point at %TEMP% in locked-down shells).
  cacheDir:
    process.env.POLY_VITE_CACHE ||
    fileURLToPath(new URL("./.vite", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("react-dom") ||
            id.includes("/react/") ||
            id.includes("react-router") ||
            id.includes("scheduler")
          ) {
            return "vendor-react";
          }
          if (id.includes("@tanstack")) return "vendor-query";
          return undefined;
        },
      },
    },
  },
  // dev/preview proxy: same-origin cookies, no CORS (docs/49 F8). The same
  // http-proxy config powers `vite preview`, so SSE-through-proxy can be
  // verified even where the dev optimizer cannot run (esbuild blocked by AV).
  server: {
    host: true, // listen on v4+v6 so 127.0.0.1 works everywhere
    proxy,
  },
  preview: {
    host: true,
    proxy,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  esbuild: {
    drop: mode === "production" ? ["debugger"] : [],
    // keep console.warn/error; strip the chatty ones (docs/49 §12)
    pure: mode === "production" ? ["console.log", "console.debug", "console.info"] : [],
  },
}));
