// The shared RC Misfits top bar (#149): <rm-header site="tracks"> from brand v0.2.0 on every page with the site's chrome,
// Track Studio's own pages in a bar under it. Signed in: the username and Sign out, which POSTs /auth/logout (never a GET
// link); signed out: Sign in to the forum. Forum, Meetings and Timing come from the server's config. On a phone the
// bar's menu and the designer's sheets take turns, so their layers never overlap; the designer keeps Save and ⋯, and with
// ?phone3d=1 its 3D button, the 3D view's controls and the figures line.
// SHOTS=<dir> saves screenshots for the PR. The API is stubbed, so only Vite is needed.
import { expect, test, type Page } from "@playwright/test";
import { open, serve, shot, toolBtn, toolbar } from "./phone-helper.js";

const ME = { id: 1, username: "alice", name: "Alice", avatarUrl: null, organiser: false, admin: false, moderator: false };
const CONFIG = { devLogin: false, forumUrl: "http://forum.test", timingUrl: "http://timing.test", baseUrl: "", organiserGroup: "organisers" };

/** The library's API: signed in as alice or signed out; records each sign-out request's method. */
async function library(page: Page, signedIn: boolean) {
  const logouts: string[] = [];
  let me: typeof ME | null = signedIn ? ME : null;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: me });
    if (path === "/api/config") return route.fulfill({ json: CONFIG });
    if (path === "/api/tracks") return route.fulfill({ json: { tracks: [] } });
    if (path === "/api/venues") return route.fulfill({ json: { venues: [] } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route("**/auth/logout", (route) => {
    logouts.push(route.request().method());
    me = null;
    return route.fulfill({ json: { ok: true, redirect: null } });
  });
  return logouts;
}

const bar = (page: Page) => page.locator("rm-header");
const menuButton = (page: Page) => bar(page).getByRole("button", { name: "Menu" });
const panel = (page: Page) => bar(page).locator(".rm-header__panel");

/** two boxes overlap */
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe("laptop", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "a laptop"));

  test("the shared bar: Track Studio current, the server's links, the username; Sign out POSTs", async ({ page }) => {
    const logouts = await library(page, true);
    await page.goto("/");
    await expect(bar(page).locator(".rm-header__site")).toHaveText("Track Studio");
    await expect(bar(page).getByRole("link", { name: "Tracks" })).toHaveAttribute("aria-current", "page");
    await expect(bar(page).getByRole("link", { name: "Forum" })).toHaveAttribute("href", "http://forum.test/");
    await expect(bar(page).getByRole("link", { name: "Meetings" })).toHaveAttribute("href", "http://forum.test/events");
    await expect(bar(page).getByRole("link", { name: "Timing" })).toHaveAttribute("href", "http://timing.test/");
    await expect(bar(page).locator(".rm-header__user")).toHaveText("alice");
    // Track Studio's own pages, under the bar
    const nav = page.getByRole("navigation", { name: "Track Studio" });
    await expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    expect((await nav.boundingBox())!.y).toBeGreaterThanOrEqual((await bar(page).boundingBox())!.height);
    await shot(page, "1200-home-signed-in");

    // Sign out is a button, not a link; it POSTs, and the bar then offers Sign in
    const signOut = bar(page).getByRole("button", { name: "Sign out" });
    await expect(bar(page).getByRole("link", { name: "Sign out" })).toHaveCount(0);
    await signOut.click();
    await expect.poll(() => logouts).toEqual(["POST"]);
    await expect(bar(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("signed out: Sign in goes to the forum sign-in and back to the page", async ({ page }) => {
    await library(page, false);
    await page.goto("/v");
    await expect(bar(page).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login?return=%2Fv");
    await expect(bar(page).locator(".rm-header__user")).toHaveCount(0);
    await shot(page, "1200-venues-signed-out");
  });

  test("the designer: only the shared bar above it (its own row gives way), and it fills the rest; no page scroll", async ({ page }) => {
    await serve(page);
    await open(page);
    await expect(bar(page)).toBeVisible();
    await expect(page.locator(".ts-appnav")).toBeHidden();
    const designer = (await page.locator(".designer").boundingBox())!;
    const top = (await bar(page).boundingBox())!;
    expect(top.height).toBe(56);
    expect(designer.y).toBe(56);
    expect(Math.round(designer.y + designer.height)).toBe(page.viewportSize()!.height);
    await shot(page, "1200-edit");
  });
});

test.describe("phone", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("the links and the account fold into the bar's menu", async ({ page }) => {
    await library(page, true);
    await page.goto("/");
    await expect(menuButton(page)).toBeVisible();
    await expect(panel(page)).toBeHidden();
    await shot(page, "375-home-signed-in");
    await menuButton(page).tap();
    await expect(panel(page)).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "Sign out" })).toBeVisible();
    await shot(page, "375-home-menu");
    // Track Studio's own pages stay one row under the bar
    const nav = (await page.locator(".ts-appnav").boundingBox())!;
    expect(nav.height).toBeLessThanOrEqual(46);
  });

  test("the designer keeps Save and ⋯ under the bar; the bar's menu and the sheets take turns", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await expect(page.locator(".phone-header").getByRole("button", { name: "More" })).toBeVisible();
    await shot(page, "375-edit-signed-in");

    // a sheet open (Checks, from the pill): the bar's menu puts it away
    await page.locator(".checks-pill").tap();
    await expect(page.locator("section.bottom-sheet")).toHaveCount(1);
    await menuButton(page).tap();
    await expect(panel(page)).toBeVisible();
    await expect(page.locator("section.bottom-sheet")).toHaveCount(0);
    await expect(page.locator(".checks-pill")).toHaveAttribute("aria-expanded", "false");
    await shot(page, "375-edit-bar-menu");

    // the bar's menu open: a sheet from the toolbar folds it away
    await toolBtn(page, "Jump").tap();
    await expect(page.locator("section.bottom-sheet")).toHaveCount(1);
    await expect(panel(page)).toBeHidden();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");

    // the ⋯ menu is a modal sheet: while it is open its scrim covers the bar, so a finger on the bar's button only puts
    // the ⋯ menu away (and the bar's menu stays shut)
    const more = page.locator(".phone-header").getByRole("button", { name: "More" });
    await page.locator("section.bottom-sheet").getByRole("button", { name: "Close" }).tap();
    await expect(page.locator("section.bottom-sheet")).toHaveCount(0);
    await more.tap();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const m = (await menuButton(page).boundingBox())!;
    await page.touchscreen.tap(m.x + m.width / 2, m.y + m.height / 2);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();

    // the bar's menu open covers the designer's header; a tap outside it (on the plan) folds it away
    await menuButton(page).tap();
    await expect(panel(page)).toBeVisible();
    const p = (await panel(page).boundingBox())!;
    const bar2 = (await toolbar(page).boundingBox())!;
    await page.touchscreen.tap(20, (p.y + p.height + bar2.y) / 2);
    await expect(panel(page)).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("with ?phone3d=1: the 3D button, the 3D view's controls and the figures line work beside the bar's menu", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "?phone3d=1");
    await expect(toolbar(page).getByRole("button")).toHaveCount(7);
    await toolBtn(page, "3D").tap();
    await expect(page.locator(".plan3d")).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
    await expect(toolBtn(page, "2D")).toBeVisible();
    await expect(page.locator(".phone-3d-figures")).toContainText(/First frame \d+ ms/);
    const pill = (await page.locator(".checks-pill").boundingBox())!;
    const controls = (await page.locator(".plan3d .plan-controls").boundingBox())!;
    expect(controls.y).toBeGreaterThanOrEqual(pill.y + pill.height);
    await expect(page.locator(".plan3d-rostrum")).toBeVisible();
    await shot(page, "375-edit-3d");

    // the bar's menu opens over the 3D view and folds away again; the 3D view and its controls are as they were
    await menuButton(page).tap();
    await expect(panel(page)).toBeVisible();
    await shot(page, "375-edit-3d-bar-menu");
    await menuButton(page).tap();
    await expect(panel(page)).toBeHidden();
    await page.locator(".plan3d .plan-controls").getByRole("button").first().tap();
    await expect(page.locator(".phone-3d-figures")).toBeVisible();
    await toolBtn(page, "2D").tap();
    await expect(page.locator("svg.plan-svg")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
