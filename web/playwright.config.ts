import { defineConfig } from "@playwright/test";

/**
 * E2E (docs/49 §11). Runs against `vite preview` of the committed dist —
 * run `pnpm build` first (check.py enforces the order).
 *
 * Browsers: default channel "msedge" so Windows dev machines need no
 * download; CI sets PW_CHANNEL=chrome (GH runners ship Chrome, not Edge).
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: ".playwright-output",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://127.0.0.1:4177",
    channel: process.env.PW_CHANNEL || "msedge",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm preview --port 4177 --strictPort",
    url: "http://127.0.0.1:4177/__kit",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
