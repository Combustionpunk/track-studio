// Tabs left open across a deploy (#88). Vite alone: the API answers are stubbed, and a newer server is simulated by
// adding x-app-version to them (this tab, from Vite, runs version "dev"). Desktop project only.
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "doesn't depend on touch"));

/** Answer the API (404 unless given) as a server running `version` would. */
async function server(page: Page, version: string | null, answers: Record<string, unknown> = {}) {
  await page.unrouteAll();
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = version ? { "x-app-version": version } : undefined;
    return path in answers ? route.fulfill({ json: answers[path], headers }) : route.fulfill({ status: 404, json: { error: "not-found", message: "no" }, headers });
  });
}

/** Set a marker that only survives in-app navigation (a full page load clears it). */
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { __mark?: number }).__mark === 1);

const banner = (page: Page) => page.getByRole("status").filter({ hasText: "Track Studio has been updated. Reload to get the latest version." });

test("a new version on an API answer: the banner shows and the next page is a full load", async ({ page }) => {
  await server(page, "dev");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await mark(page);
  await page.getByRole("link", { name: "Venues" }).click();
  await expect(page).toHaveURL(/\/v$/);
  expect(await marked(page)).toBe(true); // same version: in-app navigation as usual
  await expect(banner(page)).toHaveCount(0);

  await server(page, "new-build");
  await page.getByRole("link", { name: "New track" }).click(); // its API calls bring the new version
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByRole("button", { name: "Reload" })).toBeVisible();
  expect(await marked(page)).toBe(true);

  await page.getByRole("link", { name: "Venues" }).click();
  await expect(page).toHaveURL(/\/v$/);
  await expect.poll(() => marked(page)).toBe(false); // the browser loaded the page from the server
});

test("unsaved designer changes: only the banner, no automatic reload", async ({ page }) => {
  await server(page, "new-build");
  await page.goto("/new/design?length=22&width=12"); // a new design is unsaved from the start
  await expect(banner(page)).toBeVisible();
  await mark(page);
  page.on("dialog", (d) => d.accept()); // the designer's own "leave anyway?" question
  await page.getByRole("link", { name: "Venues" }).click();
  await expect(page).toHaveURL(/\/v$/);
  expect(await marked(page)).toBe(true); // the app navigated; nothing reloaded over the designer
  await expect(banner(page)).toBeVisible();
});

test("a page that throws shows the app's error page, never React Router's", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await server(page, null, { "/api/tracks/broken": {} }); // a track answer with nothing in it
  await page.goto("/t/broken");
  await expect(page.getByRole("heading", { name: "Something went wrong showing this page." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the library" })).toHaveAttribute("href", "/");
  await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Venues" })).toBeVisible(); // the header stays
  await page.getByText("Details", { exact: true }).click();
  await expect(page.locator(".ts-error-page__details code")).toContainText("TypeError");
  expect(errors.some((e) => e.includes("TypeError"))).toBe(true); // still logged
});

test("a chunk-load failure reloads once, and never loops", async ({ page }) => {
  await server(page, null);
  await page.goto("/");
  await page.evaluate(() => sessionStorage.clear());
  await mark(page);
  const preloadError = () => page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError", { cancelable: true })));
  await preloadError();
  await expect.poll(() => marked(page).catch(() => true)).toBe(false); // reloaded
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await mark(page);
  await preloadError();
  await page.waitForTimeout(500);
  expect(await marked(page)).toBe(true); // the same version failing again doesn't reload
});

/** Storage blocked as in a third-party frame: even reading window.sessionStorage throws (#90). */
const blockStorage = (page: Page) =>
  page.addInitScript(() =>
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    }),
  );
const preloadError = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError", { cancelable: true })));

test("storage blocked: a chunk failure doesn't reload or crash; the banner shows and the error page still works (#90)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await blockStorage(page);
  await server(page, null, { "/api/tracks/broken": {} });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await mark(page);
  await preloadError(page);
  await expect(banner(page)).toBeVisible();
  expect(await marked(page)).toBe(true); // no reload
  expect(errors.filter((e) => e.includes("insecure"))).toEqual([]);

  await page.goto("/t/broken"); // a page that throws: the app's error page, with Reload
  await expect(page.getByRole("heading", { name: "Something went wrong showing this page." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);
});

test("unsaved designer changes: a chunk failure shows the banner and doesn't reload (#90)", async ({ page }) => {
  await server(page, null);
  await page.goto("/new/design?length=22&width=12");
  await page.evaluate(() => sessionStorage.clear());
  await expect(banner(page)).toHaveCount(0);
  await mark(page);
  await preloadError(page);
  await expect(banner(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await marked(page)).toBe(true);
});

test("Back and Forward across a new version add no history entry (#90)", async ({ page }) => {
  await server(page, "dev");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Venues" }).click();
  await expect(page).toHaveURL(/\/v$/);
  const entries = await page.evaluate(() => history.length);
  await server(page, "new-build");
  await page.evaluate(() => import(/* @vite-ignore */ "/src/lib/version.ts").then((v) => v.noteServerVersion("new-build"))); // the app's own module instance
  await mark(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => marked(page).catch(() => false)).toBe(false); // a full load from the server
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await page.goForward();
  await expect(page).toHaveURL(/\/v$/); // Forward history kept
});
