// Checks on the Advanced tab (#113): on Quick, "How to draw" heads the right-hand column and there are no checks; a
// Submit blocked by an error says why by the button, and "See Checks" goes to Advanced with the checks in view. The
// author's saved track (lanes overlapping) is answered from a fixture, so only Vite is needed. Mouse at 1200 px and at
// 860 px (the stacked column). SHOTS=<dir> saves screenshots there.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS;
const doc = JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/engine/test/fixtures/extra/overlap-straights.rctrack.json", import.meta.url)), "utf8"));
const ID = "t-checks";

async function serve(page: Page) {
  const now = "2026-11-10T12:00:00Z";
  const track = {
    id: ID, name: doc.info.name, status: "draft", author: { id: "u1", username: "alice", name: "Alice" }, revision: 1, approvedRevision: null, publicRevision: 1,
    newerRevision: null, errors: 1, derivedFrom: null, latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: doc.area, footprint: { width: 0, height: 0 },
    venue: null, venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
  };
  const can = { edit: true, submit: true, approve: false, archive: false, adapt: false, copy: true };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: { id: 1, username: "alice", name: "Alice", avatarUrl: null, organiser: false, admin: false, moderator: false } });
    if (path === "/api/config") return route.fulfill({ json: { devLogin: false, forumUrl: "", baseUrl: "", organiserGroup: "" } });
    if (path === `/api/tracks/${ID}`) return route.fulfill({ json: { track, doc: { ...doc, id: ID, revision: 1 }, can, usedAt: null, lapStats: null } });
    if (path === `/api/tracks/${ID}/r/1`) return route.fulfill({ json: { ...doc, id: ID, revision: 1 } });
    if (path === "/api/venues") return route.fulfill({ json: { venues: [] } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
}

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 860 });
  await serve(page);
  await page.goto(`/t/${ID}/edit`);
  await page.evaluate(() => (localStorage.clear(), sessionStorage.clear()));
  await page.reload();
  await expect(page.locator("svg.plan-svg")).toBeVisible();
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png`, fullPage: true });
};

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "mouse only"));

for (const width of [1200, 860]) {
  test(`${width} px: Quick has How to draw on top and no checks; a blocked Submit's See Checks goes to Advanced › Checks`, async ({ page }) => {
    await open(page, width);
    const side = page.locator(".designer-side");
    await expect(page.locator(".mode-toggle").getByRole("button", { name: "Quick" })).toHaveAttribute("aria-pressed", "true");
    await expect(side.locator(":scope > *").first()).toHaveText(/^How to draw/);
    await expect(page.locator(".checks-panel:not(.venue-check)")).toHaveCount(0);
    // it opens, and it's about Quick's gestures
    await side.locator("summary", { hasText: "How to draw" }).click();
    await expect(side.getByText("inside handle to cut the corner back")).toBeVisible();

    // Submit waits on the overlap, says so by the button, and offers the way to the checks
    const submit = page.getByRole("button", { name: "Submit track" });
    await expect(submit).toBeDisabled();
    const why = page.locator(".designer-bar #submit-why");
    await expect(why).toContainText("Submit is waiting on 1 error. Lanes overlap by 0.60 m here.", { timeout: 15_000 });
    await expect(submit).toHaveAttribute("aria-describedby", "submit-why");
    await shot(page, "1-quick");

    await why.getByRole("button", { name: "See Checks" }).click();
    await expect(page.locator(".mode-toggle").getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");
    const checks = side.locator(".checks-panel:not(.venue-check)");
    await expect(checks).toContainText("Lanes overlap by 0.60 m here");
    await expect(checks).toBeInViewport();
    await expect(checks.getByRole("heading", { name: "Checks" })).toBeFocused();
    // one reason, under the checks, and Submit still blocked
    await expect(page.locator("#submit-why")).toHaveCount(1);
    await expect(checks.locator("#submit-why")).toContainText("Submit is waiting on 1 error.");
    await expect(submit).toBeDisabled();
    await shot(page, "2-advanced-checks");

    // Show still highlights the problem on the plan
    await checks.getByRole("button", { name: "Show" }).first().click();
    await expect(page.locator("circle.plan-highlight")).toBeVisible();
  });
}

test("375 px: the phone's view-only designer is as before", async ({ page }) => {
  await open(page, 375);
  await expect(page.getByRole("heading", { name: "Design on a laptop or tablet" })).toBeVisible();
  await shot(page, "3-phone");
});
