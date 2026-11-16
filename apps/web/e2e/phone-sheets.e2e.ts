// The phone designer's sheets (#123): at 375 × 812 with touch, a tapped corner opens its sheet at peek
// above the toolbar (no Delete in it; the toolbar's Undo and Delete stay one tap away), the apex stepper changes the
// radius with no keyboard, a drag tucks the sheet away and it comes back, the checks pill opens Checks in both modes,
// Show pans the plan and drops the sheet to peek, a jump picked from the Jump sheet arms the tool and a tap places it,
// and How to draw opens from the ⋯ menu. SHOTS=<dir> saves screenshots for the PR.
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { corners, emptyFloor, middleCorner, open, pinchIn, REF, serve, shot, toolBtn, toolbar, viewBox } from "./phone-helper.js";
import { screen, Touch, type XY } from "./touch-helper.js";

/** a track with one error that has a place on the plan (two straights overlap) */
const overlap = JSON.parse(readFileSync(`${REF}../packages/engine/test/fixtures/extra/overlap-straights.rctrack.json`, "utf8"));

const sheet = (page: Page) => page.locator("section.bottom-sheet");
const pill = (page: Page) => page.locator(".checks-pill");

/** the sheet sits on the toolbar, and the toolbar's buttons are still the topmost thing where a finger lands on them */
async function aboveToolbar(page: Page, s: Locator) {
  const tb = (await toolbar(page).boundingBox())!;
  // once it has slid in
  await expect.poll(async () => { const sb = (await s.boundingBox())!; return Math.round(sb.y + sb.height); }).toBe(Math.round(tb.y));
  for (const name of ["Undo", "Delete", "Jump"]) {
    const b = (await toolBtn(page, name).boundingBox())!;
    const hit = await page.evaluate(([x, y, name]) => document.elementFromPoint(x, y)?.closest("button")?.textContent === name, [b.x + b.width / 2, b.y + b.height / 2, name] as [number, number, string]);
    expect(hit, name).toBe(true);
  }
}

test.describe("phone sheets", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("a tap on a corner opens its sheet at peek, above the toolbar, with no Delete; the toolbar's Delete still works", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const n = (await corners(page)).length;
    const { i, at } = await middleCorner(page);
    await expect(sheet(page)).toHaveCount(0);
    await t.tap(at);
    const s = page.getByRole("dialog", { name: `Corner ${i + 1}` });
    await expect(s).toBeVisible();
    await expect(s).toHaveClass(/bottom-sheet--peek/);
    await aboveToolbar(page, s);
    await expect(s.getByRole("button", { name: /delete/i })).toHaveCount(0);
    await expect(s.getByRole("group", { name: "Quick sizes" }).getByRole("button")).toHaveCount(4);
    await shot(page, "375-selection");
    // Delete on the toolbar: the corner goes, and its sheet with it
    await toolBtn(page, "Delete").tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(n - 1);
    await expect(sheet(page)).toHaveCount(0);
    await toolBtn(page, "Undo").tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(n);
    // a tap on the floor puts the sheet away
    await t.tap(at);
    await expect(sheet(page)).toHaveCount(1);
    await t.tap(await emptyFloor(page));
    await expect(sheet(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the stepper changes the apex radius, with no keyboard", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const { at } = await middleCorner(page);
    await t.tap(at);
    const stepper = sheet(page).getByRole("group", { name: "Apex radius" });
    await expect(stepper).toBeVisible();
    const value = stepper.locator("output");
    const before = parseFloat((await value.textContent())!);
    await stepper.getByRole("button", { name: "Bigger" }).tap();
    await expect(value).toHaveText(`${(before + 0.1).toFixed(1)} m`);
    await stepper.getByRole("button", { name: "Bigger" }).tap();
    await expect(value).toHaveText(`${(before + 0.2).toFixed(1)} m`);
    await stepper.getByRole("button", { name: "Smaller" }).tap();
    await expect(value).toHaveText(`${(before + 0.1).toFixed(1)} m`);
    for (const b of await stepper.getByRole("button").all()) {
      const box = (await b.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // no field to type in, and nothing that brings the keyboard up has the focus
    await expect(sheet(page).locator("input, textarea, select")).toHaveCount(0);
    expect(await page.evaluate(() => !!document.activeElement?.matches("input, textarea, select, [contenteditable]"))).toBe(false);
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    await expect(page.locator(".phone-save")).toHaveText("Save"); // the Save button (#124)
    expect(errors).toEqual([]);
  });

  test("dragging a corner tucks the sheet away; it comes back at its height when the finger lifts", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const before = await corners(page);
    const { i, at } = await middleCorner(page);
    await t.tap(at);
    const s = page.getByRole("dialog", { name: `Corner ${i + 1}` });
    await expect(s).toHaveClass(/bottom-sheet--peek/);
    const peek = (await s.boundingBox())!.height;
    await t.down(at);
    await t.move([[at[0] + 10, at[1] + 20]], 4);
    await t.move([[at[0] + 20, at[1] + 50]], 4);
    await expect(s).toHaveClass(/bottom-sheet--tucked/);
    await expect.poll(async () => (await s.boundingBox())!.height).toBeLessThanOrEqual(30);
    await shot(page, "375-tucked");
    await t.up();
    await expect(s).not.toHaveClass(/bottom-sheet--tucked/);
    await expect(s).toHaveClass(/bottom-sheet--peek/);
    await expect.poll(async () => Math.round((await s.boundingBox())!.height)).toBe(Math.round(peek));
    expect((await corners(page))[i]).not.toEqual(before[i]);
    // closed, the corner stays selected; a tap on it brings its sheet back (rather than letting it go), and a tap is not a
    // drag: the sheet never tucks
    await s.getByRole("button", { name: "Close" }).tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1);
    await page.evaluate(() => {
      const w = window as unknown as { tucked: boolean };
      w.tucked = false;
      new MutationObserver(() => document.querySelector(".bottom-sheet--tucked") && (w.tucked = true)).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    });
    await t.tap((await screen(page, ...(await corners(page))[i])) as XY);
    await expect(page.getByRole("dialog", { name: `Corner ${i + 1}` })).toHaveClass(/bottom-sheet--peek/);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { tucked: boolean }).tucked)).toBe(false);
    expect(errors).toEqual([]);
  });

  for (const mode of ["quick", "advanced"] as const) {
    test(`${mode}: the checks pill opens Checks at full height; Show pans the plan to the problem and drops it to peek`, async ({ page }) => {
      const errors = await serve(page, overlap);
      await open(page, "", mode);
      await expect(page.locator(".designer")).toHaveClass(new RegExp(`designer-${mode}`));
      await expect(pill(page)).toHaveText("1 error");
      await pill(page).tap();
      const s = page.getByRole("dialog", { name: "Checks" });
      await expect(s).toHaveClass(/bottom-sheet--full/);
      await expect(pill(page)).toHaveAttribute("aria-expanded", "true");
      await expect(s.locator(".check-counts")).toHaveText("1 error");
      await expect(s.locator("li.check-error")).toHaveCount(1);
      await expect(s.locator(".designer-stats")).toContainText("Lap");
      await aboveToolbar(page, s);
      await shot(page, `375-checks-${mode}`);
      const show = s.getByRole("button", { name: "Show" });
      const box = (await show.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      const vb0 = await viewBox(page);
      await show.tap();
      await expect(s).toHaveClass(/bottom-sheet--peek/);
      await expect(page.getByRole("dialog")).toHaveCount(1); // still Checks, not the selection's
      await expect(s).toBeVisible();
      await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(vb0[2] * 0.75); // zoomed in on it
      // the problem's ring is on the plan above the sheet
      const ring = (await page.locator(".plan-highlight").boundingBox())!;
      expect(ring.y + ring.height / 2).toBeLessThan((await s.boundingBox())!.y);
      // the pill closes it again
      await pill(page).tap();
      await expect(sheet(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("Jump: the chips, Start line and Snap; picking one arms it and closes the sheet, and a tap places it", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    const jumps = await page.locator("polygon.ed-feature").count();
    await toolBtn(page, "Jump").tap();
    const s = page.getByRole("dialog", { name: "Jumps" });
    await expect(s).toBeVisible();
    const chips = s.getByRole("group", { name: "Jumps" }).getByRole("button");
    await expect(chips).toHaveText(["Tabletop", "Double", "Kicker", "Whoops", "Crossover"]);
    for (const c of await chips.all()) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(s.getByRole("button", { name: "Start line" })).toBeVisible();
    await expect(s.getByRole("switch", { name: "Snap to lanes" })).toHaveAttribute("aria-checked", "true");
    // all of it at peek height, nothing to scroll for
    await expect(s).toHaveClass(/bottom-sheet--peek/);
    await expect(s.getByRole("switch", { name: "Snap to lanes" })).toBeInViewport({ ratio: 1 });
    await aboveToolbar(page, s);
    await shot(page, "375-jump");
    await s.getByRole("button", { name: "Kicker" }).tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(toolBtn(page, "Jump")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".designer-hint")).toHaveText("Tap on the racing line to place it.");
    // on the east straight (corners 1 → 12 run along x = 9.44 between z = 4.64 and −5.36)
    const at = await screen(page, 9.44, 0);
    await t.tap(at);
    await expect(page.locator("polygon.ed-feature")).toHaveCount(jumps + 1);
    // the new kicker is selected: its sheet, with no Delete
    const ks = page.getByRole("dialog", { name: "Kicker" });
    await expect(ks).toBeVisible();
    await expect(ks.getByRole("button", { name: /delete/i })).toHaveCount(0);
    await expect(toolBtn(page, "Delete")).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test("Advanced's Jump sheet: eight jumps and the Snap radio; Start line selects the start line", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "", "advanced");
    await toolBtn(page, "Jump").tap();
    const s = page.getByRole("dialog", { name: "Jumps" });
    await expect(s.getByRole("group", { name: "Jumps" }).getByRole("button")).toHaveCount(8);
    await expect(s.getByRole("radiogroup", { name: "Snap" })).toBeVisible();
    await s.getByRole("radio", { name: "Fine" }).tap();
    await expect(s.getByRole("radio", { name: "Fine" })).toHaveAttribute("aria-checked", "true");
    await s.getByRole("button", { name: "Start line" }).tap();
    await expect(page.getByRole("dialog", { name: "Start line" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("How to draw opens from the ⋯ menu, for fingers", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await page.getByRole("button", { name: "More" }).tap();
    await page.getByRole("menuitem", { name: "How to draw" }).tap();
    const s = page.getByRole("dialog", { name: "How to draw" });
    await expect(s).toBeVisible();
    await expect(s).toContainText("pinch to zoom");
    await expect(s).not.toContainText(/click|Ctrl/i);
    await shot(page, "375-howto");
    await s.getByRole("button", { name: "Close" }).tap();
    await expect(sheet(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("a laptop", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "the mouse"));
  test("at 1200 px: Checks stays on the Advanced tab, no pill and no sheets", async ({ page }) => {
    const errors = await serve(page, overlap);
    await open(page, "", "advanced");
    await expect(page.locator(".designer-side .checks-panel:not(.venue-check)")).toContainText("1 error");
    await expect(page.locator(".checks-pill, section.bottom-sheet, .phone-toolbar")).toHaveCount(0);
    await shot(page, "1200-advanced");
    expect(errors).toEqual([]);
  });
});
