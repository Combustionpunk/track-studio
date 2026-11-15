// Transient (#135): before / after screenshots of the brand change. SHOTS=<dir>, THEME=<id> (the member's theme).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS;
const THEME = process.env.THEME;
const REF = fileURLToPath(new URL("../../../reference/", import.meta.url));
const doc = JSON.parse(readFileSync(`${REF}examples/freeform-at-sports-hall-b.rctrack.json`, "utf8"));
const hall = JSON.parse(readFileSync(`${REF}venues/sports-hall-b.rcvenue.json`, "utf8"));
const ID = "t-brand";

async function serve(page: Page) {
  const now = "2026-11-12T12:00:00Z";
  const track = {
    id: ID, name: doc.info.name, status: "approved", author: { id: "u1", username: "alice", name: "Alice" }, revision: 1, approvedRevision: 1, publicRevision: 1,
    newerRevision: null, errors: 0, derivedFrom: null, latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: hall.area, footprint: { width: 0, height: 0 },
    venue: null, venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: { id: 1, username: "alice", name: "Alice", avatarUrl: null, organiser: false, admin: false, moderator: false, ...(THEME ? { theme: THEME } : {}) } });
    if (path === "/api/config") return route.fulfill({ json: { devLogin: false, forumUrl: "", baseUrl: "", organiserGroup: "" } });
    if (path === `/api/tracks/${ID}`) return route.fulfill({ json: { track, doc: { ...doc, id: ID, revision: 1 }, can: { edit: true, submit: true } } });
    if (path === `/api/tracks/${ID}/r/1`) return route.fulfill({ json: { ...doc, id: ID, revision: 1 } });
    if (path === "/api/venues/venue-2") return route.fulfill({ json: { venue: { id: "venue-2", name: "Sports hall B" }, doc: hall } });
    if (path === "/api/venues") return route.fulfill({ json: { venues: [{ id: "venue-2", name: "Sports hall B" }] } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
}

const name = (page: Page, n: string) => `${SHOTS}/${THEME ?? "default"}-${n}-${page.viewportSize()!.width}.png`;
async function settle(page: Page) {
  await expect(page.locator(".pending")).toHaveCount(0);
  await expect(page.getByText("alice").first()).toBeAttached();
  await page.waitForTimeout(600);
}

test("track page, 2D and 3D", async ({ page }, info) => {
  test.skip(!SHOTS || info.project.name !== "desktop-mouse");
  if (process.env.W) await page.setViewportSize({ width: Number(process.env.W), height: 812 });
  await serve(page);
  await page.goto(`/t/${ID}`);
  await expect(page.locator("svg.plan-svg")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: name(page, "track"), fullPage: true });
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator(".plan3d")).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: name(page, "track3d") });
});

test("designer", async ({ page }, info) => {
  test.skip(!SHOTS || info.project.name !== "desktop-mouse" || !!process.env.W);
  await serve(page);
  await page.goto(`/t/${ID}/edit`);
  await page.evaluate(() => (localStorage.clear(), sessionStorage.clear()));
  await page.reload();
  await page.locator(".mode-toggle").getByRole("button", { name: "Advanced" }).click();
  await expect(page.locator("svg.plan-svg")).toBeVisible();
  await expect(page.locator(".checks-pill", { hasText: "Checking" })).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: name(page, "designer") });
});
