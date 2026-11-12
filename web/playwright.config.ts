import { defineConfig } from "@playwright/test";

/**
 * E2E (docs/49 §11). Two servers:
 *  - API: `poly serve` on 8901 with FakeModel + a fixed admin password and a
 *    gitignored DB under data/ (persists across runs, tests stay independent
 *    by creating fresh threads each time)
 *  - web: `vite preview` of the committed dist with its /api proxy aimed at
 *    8901 (POLY_API_TARGET); run `pnpm build` first (check.py enforces it)
 *
 * Browsers: default channel "msedge" (no download on Windows dev boxes);
 * CI sets PW_CHANNEL=chrome (GH runners ship Chrome, not Edge).
 */
const API_PORT = 8901;

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".playwright-output",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://127.0.0.1:4177",
    channel: process.env.PW_CHANNEL || "msedge",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "uv run python -m polyopus serve --port 8901 --host 127.0.0.1",
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      cwd: "..",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        POLY_DB_PATH: "data/e2e-chat.db",
        POLY_WORKSPACE_DIR: "data/e2e-chat-ws",
        POLY_ADMIN_PASSWORD: "chat-e2e",
        POLY_MODEL_BASE_URL: "",
        POLY_MODEL_API_KEY: "",
        POLY_MODEL_NAME: "",
      },
    },
    {
      command: "pnpm preview --port 4177 --strictPort",
      url: "http://127.0.0.1:4177/__kit",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { POLY_API_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
