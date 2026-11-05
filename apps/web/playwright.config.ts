// Browser tests (Playwright): tablet touch in the designer (#16). Run with `pnpm --filter @track-studio/web test:e2e`.
// They start the web app on its own (Vite, no API server: blank designs need none). PW_CHROMIUM points at a Chromium
// to use instead of Playwright's download (CT 102 needs one with local system libraries; see the PR notes).
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5179);
const executablePath = process.env.PW_CHROMIUM || undefined;
const touch = { ...devices["Desktop Chrome"], hasTouch: true, isMobile: false, launchOptions: { executablePath, args: ["--no-sandbox"] } };

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../node_modules/.e2e-results",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  webServer: { command: `pnpm exec vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    { name: "tablet-landscape", use: { ...touch, viewport: { width: 1024, height: 768 } } },
    { name: "tablet-portrait", use: { ...touch, viewport: { width: 768, height: 1024 } } },
    { name: "desktop-mouse", use: { ...devices["Desktop Chrome"], viewport: { width: 1200, height: 860 }, launchOptions: { executablePath, args: ["--no-sandbox"] } } },
  ],
});
