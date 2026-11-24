// The user guide (#171): /help shows docs/guide signed out, with a contents list and section anchors that land under
// the site's bar; and the app's Help and "?" links (the menu, the palette, the fit check, the build sheet, How to draw)
// open sections that exist. Only Vite is needed: the API calls are answered here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { open, serve } from "./phone-helper.js";
import { cell, type XY } from "./touch-helper.js";

const SECTIONS = ["getting-started", "start-a-layout", "draw-the-track", "edit", "check-and-finish", "share", "on-a-tablet-or-phone", "faq"];
const sheetDoc = JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/engine/test/fixtures/extra/crossover-figure8.rctrack.json", import.meta.url)), "utf8")) as { id: string; info: { name: string } };

/** Nobody is signed in; there is one venue to check against, and one track for the build sheet. */
async function signedOut(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const now = "2026-11-24T12:00:00Z";
  const track = {
    id: sheetDoc.id, name: sheetDoc.info.name, status: "approved", author: { id: "u1", username: "alice", name: "Alice" }, revision: 1, approvedRevision: 1, publicRevision: 1,
    newerRevision: null, errors: 0, derivedFrom: null, latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: { length: 0, width: 0 }, footprint: { width: 0, height: 0 },
    venue: null, venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") return route.fulfill({ json: { devLogin: false, forumUrl: "", baseUrl: "", organiserGroup: "organisers" } });
    if (path === "/api/venues") return route.fulfill({ json: { venues: [{ id: "venue-2", name: "Sports hall B" }] } });
    if (path === `/api/tracks/${sheetDoc.id}`) return route.fulfill({ json: { track, doc: sheetDoc, can: {} } });
    if (path === "/api/me") return route.fulfill({ status: 401, json: { error: "unauthorised" } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  return errors;
}

/** how far below the site's bar the top of this section is, in px */
const belowBar = (page: Page, id: string) =>
  page.evaluate((id) => document.getElementById(id)!.getBoundingClientRect().top - document.querySelector(".ts-site-header")!.getBoundingClientRect().bottom, id);

test.describe("the user guide at /help", () => {
  test("signed out: the guide, a contents list for the eight sections, and anchors that land under the bar", async ({ page }, info) => {
    const errors = await signedOut(page);
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Track Studio user guide" })).toBeVisible();
    await expect(page).toHaveTitle("Help · Track Studio");
    // nobody is signed in: the bar offers Sign in (on a phone it is inside the bar's menu, which is closed)
    if (info.project.name !== "phone") await expect(page.locator("rm-header").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    // Help is in the menu, and marked as where you are
    await expect(page.getByRole("navigation", { name: "Track Studio" }).getByRole("link", { name: "Help" })).toHaveAttribute("aria-current", "page");

    const contents = page.getByRole("navigation", { name: "Contents" });
    // the guide's title is the page's first heading
    expect(await page.locator("main :is(h1, h2, h3)").first().textContent()).toBe("Track Studio user guide");
    const hrefs = await contents.locator(":scope > ol > li > a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(SECTIONS.map((s) => `#${s}`));

    // a contents link: the section comes to the top, clear of the bar, and the address has the anchor
    await contents.getByRole("link", { name: "Check and finish" }).click();
    await expect(page).toHaveURL(/\/help#check-and-finish$/);
    await expect.poll(() => belowBar(page, "check-and-finish")).toBeGreaterThanOrEqual(0);
    expect(await belowBar(page, "check-and-finish")).toBeLessThan(60);
    await expect(page.locator("#check-and-finish")).toBeInViewport();
    // the contents list marks where you are, and the keyboard carries on from the section
    await expect(contents.getByRole("link", { name: "Check and finish" })).toHaveAttribute("aria-current", "location");
    await expect(contents.locator("a[aria-current]")).toHaveCount(1);
    await expect(page.locator("#check-and-finish")).toBeFocused();
    // Help in the menu, from a section: back to the top of the guide
    await page.getByRole("navigation", { name: "Track Studio" }).getByRole("link", { name: "Help" }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(contents.locator("a[aria-current]")).toHaveCount(0);

    // every link inside the guide has somewhere to go
    const dead = await page.locator(".guide a[href^='#'], .help-contents a[href^='#']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!.slice(1)).filter((id) => !document.getElementById(id)));
    expect(dead).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a link straight to a section opens there, and stays there as the screenshots load", async ({ page }) => {
    await signedOut(page);
    await page.goto("/help#the-build-sheet");
    await expect(page.locator("#the-build-sheet")).toBeInViewport();
    await expect.poll(() => belowBar(page, "the-build-sheet")).toBeGreaterThanOrEqual(0);
    expect(await belowBar(page, "the-build-sheet")).toBeLessThan(60);
    // every screenshot has its size before it loads, so nothing above the section can push it down
    const unsized = await page.locator(".guide img").evaluateAll((imgs) => imgs.filter((i) => !(Number(i.getAttribute("width")) > 0 && Number(i.getAttribute("height")) > 0)).length);
    expect(unsized).toBe(0);
    await page.waitForTimeout(500);
    expect(await belowBar(page, "the-build-sheet")).toBeLessThan(60);
  });

  test("every screenshot is there", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-mouse", "the same files on every screen");
    await signedOut(page);
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Track Studio user guide" })).toBeVisible();
    const srcs = await page.locator(".guide img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
    expect(srcs.length).toBeGreaterThan(40);
    for (const src of srcs) {
      const res = await page.request.get(src);
      expect(res.status(), src).toBe(200);
      expect(res.headers()["content-type"], src).toContain("image/webp");
    }
    // and each says what it shows
    expect(await page.locator(".guide img:not([alt]), .guide img[alt='']").count()).toBe(0);
  });
});

test.describe("help links in the app", () => {
  /** every "?" link on the page: where it goes, and that it opens in a new tab */
  const helpLinks = (page: Page) => page.locator("a.help-link").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href")!, target: a.getAttribute("target"), label: a.getAttribute("aria-label") })));

  test("the palette, the fit check and the build sheet each open their section of the guide", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-mouse", "the laptop's palette and side column");
    await signedOut(page);
    const found: { href: string; target: string | null; label: string | null }[] = [];

    // step 1: the palette's ?
    await page.goto("/new/design?length=22&width=12");
    await expect(page.locator("rect.lay-hit")).toBeVisible();
    expect((await helpLinks(page)).map((l) => l.href)).toContain("/help#draw-the-track");
    // step 2: the palette's ?, the fit check's ?, and the guide from How to draw
    const loop: XY[] = [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]];
    await page.mouse.move(...(await cell(page, ...loop[0])));
    await page.mouse.down();
    for (const c of loop.slice(1)) await page.mouse.move(...(await cell(page, ...c)), { steps: 7 });
    await page.mouse.up();
    await expect(page.locator(".designer-palette").getByRole("button", { name: "Tabletop" })).toBeVisible();
    await expect(page.locator(".venue-check a.help-link")).toHaveAttribute("href", "/help#the-fit-check");
    await expect(page.locator(".designer-palette a.help-link")).toHaveAttribute("href", "/help#draw-the-track");
    found.push(...(await helpLinks(page)));

    // the build sheet's Help
    await page.goto(`/t/${sheetDoc.id}/build`);
    await expect(page.locator(".sheet-toolbar a.help-link")).toHaveAttribute("href", "/help#the-build-sheet");
    await expect(page.locator(".sheet-toolbar a.help-link")).toHaveText("Help");
    found.push(...(await helpLinks(page)));
    // it isn't printed
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".sheet-toolbar a.help-link")).toBeHidden();
    await page.emulateMedia({ media: "screen" });

    expect(found.length).toBeGreaterThanOrEqual(4);
    for (const l of found) {
      expect(l.target, l.href).toBe("_blank"); // the drawing, or the sheet, stays where it is
      expect(l.label, l.href).toMatch(/\(opens in a new tab\)$/);
    }
    // each one's section is in the guide
    for (const href of new Set(found.map((l) => l.href))) {
      await page.goto(href);
      await expect(page.locator(`#${href.split("#")[1]}`), href).toBeInViewport();
    }
  });

  test("Help in the menu opens the guide", async ({ page }) => {
    await signedOut(page);
    await page.goto("/new");
    await page.getByRole("navigation", { name: "Track Studio" }).getByRole("link", { name: "Help" }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole("heading", { level: 1, name: "Track Studio user guide" })).toBeVisible();
  });

  test("on a phone, How to draw links to the tablet and phone section", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "a phone, 375 × 812");
    await serve(page);
    await open(page);
    await page.getByRole("button", { name: "More" }).tap();
    await page.getByRole("menuitem", { name: "How to draw" }).tap();
    const link = page.locator(".phone-howto a.help-link");
    await expect(link).toHaveAttribute("href", "/help#on-a-tablet-or-phone");
    await expect(link).toHaveAttribute("target", "_blank");
    await page.goto("/help#on-a-tablet-or-phone");
    await expect(page.locator("#on-a-tablet-or-phone")).toBeInViewport();
  });
});
