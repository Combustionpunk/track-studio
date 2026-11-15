// Browser tests (Playwright): tablet touch in the designer (#16). Run with `pnpm --filter @track-studio/web test:e2e`.
// They start the web app on its own (Vite, no API server: blank designs need none). PW_CHROMIUM points at a Chromium
// to use instead of Playwright's download (CT 102 needs one with local system libraries; see the PR notes). CI runs
// them on every PR that touches the web app (.github/workflows/e2e.yml, #119).
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5179);
const executablePath = process.env.PW_CHROMIUM || undefined;
const touch = { ...devices["Desktop Chrome"], hasTouch: true, isMobile: false, launchOptions: { executablePath, args: ["--no-sandbox"] } };

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  // in CI (.github/workflows/e2e.yml) a test gets one retry: a few are known to fail once under load, then pass (#93)
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  outputDir: "../../node_modules/.e2e-results",
  // in CI, keep a trace and a screenshot of each failure for the workflow's artefact
  use: { baseURL: `http://localhost:${PORT}`, trace: process.env.CI ? "retain-on-failure" : "off", screenshot: process.env.CI ? "only-on-failure" : "off" },
  webServer: { command: `pnpm exec vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    { name: "tablet-landscape", use: { ...touch, viewport: { width: 1024, height: 768 } } },
    { name: "tablet-portrait", use: { ...touch, viewport: { width: 768, height: 1024 } } },
    { name: "desktop-mouse", use: { ...devices["Desktop Chrome"], viewport: { width: 1200, height: 860 }, launchOptions: { executablePath, args: ["--no-sandbox"] } } },
    // a phone (#120): 375 × 812 with touch, for the specs that know about it (the other specs are tablet and laptop tests)
    { name: "phone", use: { ...touch, viewport: { width: 375, height: 812 }, isMobile: true }, testMatch: ["**/layout.e2e.ts", "**/bottom-sheet.e2e.ts", "**/phone-edit.e2e.ts"] },
  ],
});
