// The designer's layout shell (#120): under 640 px a phone gets the view-only screen; the laptop and the tablet keep
// their layouts, with no errors on the console. SHOTS=<dir> saves a screenshot of each (the PR's before and after
// pictures). The API is answered from the reference files, so only Vite is needed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS;
const REF = fileURLToPath(new URL("../../../reference/", import.meta.url));
const doc = JSON.parse(readFileSync(`${REF}examples/freeform-at-sports-hall-b.rctrack.json`, "utf8"));
const hall = JSON.parse(readFileSync(`${REF}venues/sports-hall-b.rcvenue.json`, "utf8"));
const ID = "t-layout";

/** Answer the edit page's API calls: the track (editable), its revision 1, and its venue; collect page errors. */
async function serve(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const now = "2026-11-12T12:00:00Z";
  const track = {
    id: ID, name: doc.info.name, status: "draft", author: { id: "u1", username: "alice", name: "Alice" }, revision: 1, approvedRevision: null, publicRevision: 1,
    newerRevision: null, errors: 0, derivedFrom: null, latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: hall.area, footprint: { width: 0, height: 0 },
    venue: null, venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/tracks/${ID}`) return route.fulfill({ json: { track, doc: { ...doc, id: ID, revision: 1 }, can: { edit: true, submit: true } } });
    if (path === `/api/tracks/${ID}/r/1`) return route.fulfill({ json: { ...doc, id: ID, revision: 1 } });
    if (path === "/api/venues/venue-2") return route.fulfill({ json: { venue: { id: "venue-2", name: "Sports hall B" }, doc: hall } });
    if (path === "/api/venues") return route.fulfill({ json: { venues: [{ id: "venue-2", name: "Sports hall B" }] } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  return errors;
}

/** The track open in the designer, with nothing kept from an earlier test. */
async function open(page: Page, mode?: "Quick" | "Advanced") {
  await page.goto(`/t/${ID}/edit`);
  await page.evaluate(() => (localStorage.clear(), sessionStorage.clear()));
  await page.reload();
  if (mode) await page.locator(".mode-toggle").getByRole("button", { name: mode }).click();
  await expect(page.locator("svg.plan-svg")).toBeVisible();
}

/** For a screenshot: the bake has settled (no "Checking…" anywhere) and the plan has fitted itself. */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await expect(page.locator(".pending")).toHaveCount(0);
  await expect(page.locator(".checks-pill", { hasText: "Checking" })).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const none = async (page: Page, selectors: string[]) => {
  for (const s of selectors) await expect(page.locator(s), s).toHaveCount(0);
};

test.describe("laptop", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "the laptop layout"));
  for (const mode of ["Quick", "Advanced"] as const) {
    test(`${mode}: the bar, the palette, the plan and the side column`, async ({ page }) => {
      const errors = await serve(page);
      await open(page, mode);
      await expect(page.locator(".designer")).toHaveClass(new RegExp(`designer-${mode.toLowerCase()}`));
      await expect(page.locator(".designer-bar")).toBeVisible();
      await expect(page.locator(".designer-palette")).toBeVisible();
      await expect(page.locator(".designer-side")).toBeVisible();
      await expect(page.locator(".designer-plan-wrap svg.plan-svg")).toBeVisible();
      await expect(page.locator(".designer-side").getByText(mode === "Quick" ? "How to draw" : "Checks").first()).toBeVisible();
      await none(page, [".designer-dock", ".designer-phone", ".checks-pill", ".designer-touch"]);
      await shot(page, `1200-${mode.toLowerCase()}`);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("tablet", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "tablet-landscape", "the tablet layout"));
  test("Quick: the plan with the dock and the checks pill, no columns", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await expect(page.locator(".designer")).toHaveClass(/designer-touch/);
    await expect(page.locator(".designer-bar")).toBeVisible();
    await expect(page.locator(".designer-dock")).toBeVisible();
    await expect(page.locator(".checks-pill")).toBeVisible();
    await expect(page.locator(".designer-dock").getByRole("button", { name: "Add point" })).toBeVisible();
    await none(page, [".designer-palette", ".designer-side", ".designer-phone"]);
    await shot(page, "1024-tablet");
    expect(errors).toEqual([]);
  });
});

test.describe("phone", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));
  test("the view-only screen: the plan to look at, nothing to edit with", async ({ page }) => {
    expect(page.viewportSize()).toEqual({ width: 375, height: 812 });
    const errors = await serve(page);
    await open(page);
    await expect(page.locator(".designer-phone")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Design on a laptop or tablet" })).toBeVisible();
    await expect(page.locator(".phone-plan svg.plan-svg")).toBeVisible();
    await expect(page.locator(".figures").getByText("Lap")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy link to this design" })).toBeVisible();
    await none(page, [".designer-grid", ".designer-palette", ".designer-side", ".designer-dock", ".mode-toggle", "[role=toolbar]", ".designer-hint"]);
    await shot(page, "375-phone");
    expect(errors).toEqual([]);
  });
});
