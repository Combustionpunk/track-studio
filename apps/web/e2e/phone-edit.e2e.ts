// The phone designer (#122): at 375 × 812 with touch and the switch on (`?phone=edit`), a header, the plan and a
// toolbar; tap selects, a drag moves a corner, two fingers pinch and pan and change nothing, Add point adds, Delete
// deletes, Undo brings it back; on its side the phone says to turn it upright, and turning back loses nothing. Tablets
// and the laptop are unchanged by the switch; a narrow laptop window gets the phone layout and zooms with the wheel.
// SHOTS=<dir> saves screenshots for the PR. The API is answered from the reference files, so only Vite is needed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { screen, Touch, type XY } from "./touch-helper.js";

const SHOTS = process.env.SHOTS;
const REF = fileURLToPath(new URL("../../../reference/", import.meta.url));
const doc = JSON.parse(readFileSync(`${REF}examples/freeform-at-sports-hall-b.rctrack.json`, "utf8"));
const hall = JSON.parse(readFileSync(`${REF}venues/sports-hall-b.rcvenue.json`, "utf8"));
const ID = "t-phone";

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
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  return errors;
}

/** The track open in the designer (the switch on, unless `search` says otherwise), nothing kept from an earlier test. */
async function open(page: Page, search = "?phone=edit") {
  await page.goto(`/t/${ID}/edit${search}`);
  await page.evaluate(() => (localStorage.clear(), sessionStorage.clear()));
  await page.reload();
  await expect(page.locator("svg.plan-svg")).toBeVisible();
  await page.waitForTimeout(200);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await expect(page.locator(".pending")).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const viewBox = async (page: Page) => (await page.locator("svg.plan-svg").getAttribute("viewBox"))!.split(" ").map(Number);
/** corner points in plan coordinates, from their dots */
const corners = (page: Page) =>
  page.locator("g.ed-corner .ed-corner-dot").evaluateAll((els) => els.map((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!] as XY));
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Designer tools" });
const toolBtn = (page: Page, name: string) => toolbar(page).getByRole("button", { name, exact: true });
/** the plan's box on the screen */
const planBox = async (page: Page) => (await page.locator("svg.plan-svg").boundingBox())!;

/** the corner whose dot is nearest the middle of the plan, and where it is on the screen */
async function middleCorner(page: Page): Promise<{ i: number; at: XY }> {
  const b = await planBox(page);
  const mid: XY = [b.x + b.width / 2, b.y + b.height / 2];
  let best = { i: -1, at: [0, 0] as XY, d: Infinity };
  const pts = await corners(page);
  for (let i = 0; i < pts.length; i++) {
    const at = await screen(page, pts[i][0], pts[i][1]);
    const d = Math.hypot(at[0] - mid[0], at[1] - mid[1]);
    if (d < best.d) best = { i, at, d };
  }
  return best;
}

/** zoom in round the middle of the plan with two fingers, so the handles are well apart */
async function pinchIn(page: Page, t: Touch) {
  const b = await planBox(page);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await t.down([cx - 30, cy], [cx + 30, cy]);
  await t.move([[cx - 120, cy], [cx + 120, cy]], 8);
  await t.up();
}

/** a spot on the floor, inside the area, away from every handle */
async function emptyFloor(page: Page): Promise<XY> {
  const b = await planBox(page);
  for (let y = b.y + 80; y < b.y + b.height - 40; y += 16) {
    for (let x = b.x + 30; x < b.x + b.width - 30; x += 16) {
      const free = await page.evaluate(([x, y]) => {
        // nothing within a finger's reach (22 px) is a handle
        for (const [dx, dy] of [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24], [17, 17], [-17, -17], [17, -17], [-17, 17]]) {
          const el = document.elementFromPoint(x + dx, y + dy);
          if (!el || el.closest("[data-handle], .designer-hint, .plan-scale") || !el.closest("svg.plan-svg")) return false;
        }
        return true;
      }, [x, y] as XY);
      if (free) return [x, y];
    }
  }
  throw new Error("no empty floor on the plan");
}

test.describe("phone, the switch on", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("header, plan and toolbar fill the screen; 44 px targets; no site header, no zoom buttons", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const ed = page.locator(".designer-phone-edit");
    await expect(ed).toBeVisible();
    await expect(page.locator(".ts-header")).toBeHidden();
    const vp = page.viewportSize()!;
    const header = (await page.locator(".phone-header").boundingBox())!;
    expect(header.y).toBe(0);
    expect(header.height).toBe(52);
    const bar = (await toolbar(page).boundingBox())!;
    expect(bar.height).toBe(64);
    expect(bar.y + bar.height).toBe(vp.height);
    const plan = await planBox(page);
    expect(plan.y).toBeGreaterThanOrEqual(52);
    expect(plan.y + plan.height).toBeLessThanOrEqual(bar.y + 1);
    expect(plan.height).toBeGreaterThan(vp.height - 52 - 64 - 2);
    expect(plan.width).toBe(vp.width);
    await expect(page.locator(".phone-header")).toContainText(doc.info.name);
    await expect(page.locator(".phone-save")).toHaveText("Saved");
    for (const name of ["Select", "Add point", "Jump", "Delete", "Undo", "Redo"]) {
      const b = (await toolBtn(page, name).boundingBox())!;
      expect(b.width, name).toBeGreaterThanOrEqual(44);
      expect(b.height, name).toBeGreaterThanOrEqual(44);
    }
    for (const el of await page.locator(".phone-header").locator("a, button").all()) {
      const b = (await el.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator(".designer-hint")).toContainText("Pinch to zoom in");
    await expect(page.locator(".plan-scale")).toBeVisible();
    await expect(page.locator(".plan-controls")).toHaveCount(0);
    await expect(page.locator(".designer-viewswitch")).toHaveCount(0);
    await expect(toolBtn(page, "Jump")).toBeDisabled();
    await expect(toolBtn(page, "Delete")).toBeDisabled();
    // the plan takes every gesture; the page doesn't scroll
    expect(await page.locator(".plan").first().evaluate((e) => getComputedStyle(e).touchAction)).toBe("none");
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([vp.width, vp.height]);
    await shot(page, "375-plan");
    expect(errors).toEqual([]);
  });

  test("tap selects a corner, a drag moves it, Delete removes it, Undo brings it back", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const before = await corners(page);
    const { i, at } = await middleCorner(page);

    // tap: selected, Delete on
    await t.tap(at);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1);
    await expect(toolBtn(page, "Delete")).toBeEnabled();
    expect(await corners(page)).toEqual(before);
    await shot(page, "375-selected");

    // drag past the slop: the corner moves, the others stay
    await t.drag([at, [at[0] + 10, at[1] + 30], [at[0] + 20, at[1] + 60]], 6);
    await expect.poll(async () => (await corners(page))[i]).not.toEqual(before[i]);
    const moved = await corners(page);
    expect(moved.filter((_, k) => k !== i)).toEqual(before.filter((_, k) => k !== i));
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    await expect(page.locator(".phone-save")).toHaveText("Unsaved");

    // Delete: one corner fewer
    await toolBtn(page, "Delete").tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(before.length - 1);
    await expect(toolBtn(page, "Delete")).toBeDisabled();
    // Undo: back, where it was dragged to
    await toolBtn(page, "Undo").tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(before.length);
    expect(await corners(page)).toEqual(moved);
    // Undo again: the drag is taken back; Redo does it again
    await toolBtn(page, "Undo").tap();
    await expect.poll(() => corners(page)).toEqual(before);
    await toolBtn(page, "Redo").tap();
    await expect.poll(() => corners(page)).toEqual(moved);
    expect(errors).toEqual([]);
  });

  test("pinch zooms; two fingers pan, and paint, select and move nothing", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    const before = await corners(page);
    const vb0 = await viewBox(page);
    await pinchIn(page, t);
    const vb1 = await viewBox(page);
    expect(vb1[2]).toBeLessThan(vb0[2] * 0.6); // zoomed in
    // two fingers, one of them on a corner: the plan pans, the corner stays
    const { at } = await middleCorner(page);
    await t.down(at, [at[0] + 80, at[1] + 20]);
    await t.move([[at[0] + 60, at[1] + 90], [at[0] + 140, at[1] + 110]], 8);
    await t.up();
    const vb2 = await viewBox(page);
    expect(vb2[2]).toBeCloseTo(vb1[2], 1); // the same zoom
    expect(Math.hypot(vb2[0] - vb1[0], vb2[1] - vb1[1])).toBeGreaterThan(0.5); // moved over
    expect(await corners(page)).toEqual(before);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(0);
    await expect(toolBtn(page, "Undo")).toBeDisabled();
    // one finger on empty floor pans too
    const floor = await emptyFloor(page);
    await t.drag([floor, [floor[0] - 60, floor[1] - 40]], 6);
    const vb3 = await viewBox(page);
    expect(Math.hypot(vb3[0] - vb2[0], vb3[1] - vb2[1])).toBeGreaterThan(0.5);
    expect(await corners(page)).toEqual(before);
    await expect(toolBtn(page, "Undo")).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("Add point, then a tap on the floor adds one corner; Select turns it off", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    const n = (await corners(page)).length;
    // without the tool, a tap on the floor adds nothing
    const floor = await emptyFloor(page);
    await t.tap(floor);
    await page.waitForTimeout(150);
    await expect(page.locator("g.ed-corner")).toHaveCount(n);
    await toolBtn(page, "Add point").tap();
    await expect(toolBtn(page, "Add point")).toHaveAttribute("aria-pressed", "true");
    await expect(toolBtn(page, "Select")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".designer-hint")).toContainText("Tap");
    await t.tap(floor);
    await expect(page.locator("g.ed-corner")).toHaveCount(n + 1);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1); // the new one, selected
    await toolBtn(page, "Select").tap();
    await expect(toolBtn(page, "Add point")).toHaveAttribute("aria-pressed", "false");
    await expect(toolBtn(page, "Select")).toHaveAttribute("aria-pressed", "true");
    await toolBtn(page, "Undo").tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(n);
    expect(errors).toEqual([]);
  });

  test("on its side it says to turn upright; turned back, nothing is lost", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const { at } = await middleCorner(page);
    await t.tap(at);
    await toolBtn(page, "Delete").tap();
    const after = await corners(page);
    await page.setViewportSize({ width: 812, height: 375 });
    const msg = page.getByRole("alert").filter({ hasText: "Turn your phone upright to edit" });
    await expect(msg).toBeVisible();
    const box = (await msg.boundingBox())!;
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 812, 375]);
    await shot(page, "812-landscape");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(msg).toHaveCount(0);
    await expect(toolbar(page)).toBeVisible();
    expect(await corners(page)).toEqual(after);
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    await expect(page.locator(".phone-save")).toHaveText("Unsaved");
    expect(errors).toEqual([]);
  });

  test("320 px: nothing overflows, every tool stays 44 px and on the screen", async ({ page }) => {
    await serve(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    await expect(page.locator(".designer-phone-edit")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    for (const b of await toolbar(page).getByRole("button").all()) {
      const box = (await b.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    // the labels fit their buttons
    for (const l of await toolbar(page).locator(".phone-tool-label").all()) expect(await l.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    const more = (await page.getByRole("button", { name: "More" }).boundingBox())!;
    expect(more.x + more.width).toBeLessThanOrEqual(320);
  });

  test("the switch off: the view-only screen, as today", async ({ page }) => {
    await serve(page);
    await open(page, "");
    await expect(page.getByRole("heading", { name: "Design on a laptop or tablet" })).toBeVisible();
    await expect(page.locator(".designer-phone-edit")).toHaveCount(0);
    await expect(page.locator(".ts-header")).toBeVisible();
  });
});

test.describe("tablets: the switch changes nothing", () => {
  test.beforeEach(({}, info) => test.skip(!info.project.name.startsWith("tablet"), "tablets"));
  test("the tablet layout with ?phone=edit", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await expect(page.locator(".designer")).toHaveClass(/designer-touch/);
    await expect(page.locator(".designer-dock")).toBeVisible();
    await expect(page.locator(".ts-header")).toBeVisible();
    await expect(page.locator(".designer-phone-edit, .phone-upright")).toHaveCount(0);
    await shot(page, `${page.viewportSize()!.width}-tablet`);
    expect(errors).toEqual([]);
  });
});

test.describe("a laptop", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "the mouse"));
  test("at 1200 px the switch changes nothing", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await expect(page.locator(".designer-palette")).toBeVisible();
    await expect(page.locator(".designer-phone-edit, .phone-upright")).toHaveCount(0);
    await shot(page, "1200-laptop");
    expect(errors).toEqual([]);
  });

  test("a window under 640 px gets the phone layout: the wheel zooms, a drag pans, a click selects", async ({ page }) => {
    const errors = await serve(page);
    await page.setViewportSize({ width: 560, height: 800 });
    await open(page);
    await expect(page.locator(".designer-phone-edit")).toBeVisible();
    await expect(page.locator(".designer-hint")).toContainText("Scroll to zoom in");
    const b = await planBox(page);
    const vb0 = await viewBox(page);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(vb0[2] * 0.8);
    const n = (await corners(page)).length;
    const { at } = await middleCorner(page);
    await page.mouse.click(at[0], at[1]);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1);
    await toolBtn(page, "Delete").click();
    await expect(page.locator("g.ed-corner")).toHaveCount(n - 1);
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    expect(errors).toEqual([]);
  });
});
