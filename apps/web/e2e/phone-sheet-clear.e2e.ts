// A corner low on the plan stays reachable while its sheet is open (#188): when the selection sheet slides up over it,
// the plan pans the corner up above the sheet, so a finger can drag it straight away; it pans back when the sheet
// closes, unless the member moved the plan meanwhile. A corner already clear of the sheet doesn't move the plan.
import { expect, test, type Page } from "@playwright/test";
import { corners, emptyFloor, open, pinchIn, planBox, serve, sheetClearOf, shot, upperCorner, viewBox } from "./phone-helper.js";
import { screen, Touch, type XY } from "./touch-helper.js";

test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "the phone"));

/** the corner's dot is what a finger gets at `at` (not an apex handle over it) */
const ownDot = (page: Page, at: XY) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-handle]")?.getAttribute("data-handle") === "point", at);

/**
 * A corner in the bottom third of the plan, its own dot under the finger. Zoomed in first, as the guide says (at fit
 * zoom the corners and their inside handles are too close together); if no corner is that low, the floor is dragged
 * down with one finger until the lowest one is.
 */
async function lowCorner(page: Page, t: Touch): Promise<{ i: number; at: XY }> {
  await pinchIn(page, t);
  const b = await planBox(page);
  const third = b.y + (b.height * 2) / 3;
  const find = async () => {
    const pts = await corners(page);
    let best = { i: -1, at: [0, 0] as XY };
    for (let i = 0; i < pts.length; i++) {
      const at = await screen(page, pts[i][0], pts[i][1]);
      if (at[1] > best.at[1] && at[1] < b.y + b.height - 30 && at[0] > b.x + 30 && at[0] < b.x + b.width - 30 && (await ownDot(page, at))) best = { i, at };
    }
    return best;
  };
  let low = await find();
  if (low.at[1] < third + 30) {
    // drag the floor down so the lowest corner lands about 85 % of the way down the plan
    const from = await emptyFloor(page);
    const by = b.y + b.height * 0.85 - low.at[1];
    await t.drag([from, [from[0], from[1] + by]], 8);
    low = await find();
  }
  expect(low.i, "a corner in the bottom third of the plan").toBeGreaterThanOrEqual(0);
  expect(low.at[1]).toBeGreaterThan(third);
  return low;
}

/** where corner `i` is on the screen once the plan has stopped moving */
async function settled(page: Page, i: number): Promise<XY> {
  let last: XY = [NaN, NaN];
  await expect
    .poll(async () => {
      const pts = await corners(page);
      const now = await screen(page, pts[i][0], pts[i][1]);
      const still = Math.hypot(now[0] - last[0], now[1] - last[1]) < 0.5;
      last = now;
      return still;
    }, { intervals: [100] })
    .toBe(true);
  return last;
}

test("a corner low on the plan is panned above its sheet, can be dragged at once, and the plan pans back after", async ({ page }) => {
  const errors = await serve(page);
  await open(page);
  const t = await Touch.on(page);
  const low = await lowCorner(page, t);
  const before = await viewBox(page);
  const where = (await corners(page))[low.i];

  await t.tap(low.at);
  const sheet = page.locator("section.bottom-sheet");
  await expect(sheet).toHaveClass(/bottom-sheet--peek/);
  const at = await settled(page, low.i);
  // the sheet has arrived, and the corner (and a short drag up from it) is clear of it
  await sheetClearOf(page, at);
  expect(at[1], "the corner moved up the screen").toBeLessThan(low.at[1]);
  expect(await ownDot(page, at), "the finger gets the corner, not the sheet").toBe(true);
  await shot(page, "1-low-corner-clear");

  // drag it straight away: the corner moves and the sheet tucks while the finger is down
  await t.down(at);
  await t.move([[at[0] + 30, at[1] - 40]], 7);
  await expect(sheet).toHaveClass(/bottom-sheet--tucked/);
  await t.up();
  await expect(sheet).not.toHaveClass(/bottom-sheet--tucked/);
  await expect.poll(async () => (await corners(page))[low.i], "the corner moved").not.toEqual(where);

  // the sheet closes: the plan pans back to where it was
  await sheet.getByRole("button", { name: "Close" }).tap();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => viewBox(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("a corner already clear of its sheet doesn't move the plan", async ({ page }) => {
  const errors = await serve(page);
  await open(page);
  const t = await Touch.on(page);
  await pinchIn(page, t);
  const up = await upperCorner(page);
  const before = await viewBox(page);
  await t.tap(up.at);
  await sheetClearOf(page, up.at);
  await page.waitForTimeout(300);
  expect(await viewBox(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("the plan stays where the member moved it while the sheet was open", async ({ page }) => {
  const errors = await serve(page);
  await open(page);
  const t = await Touch.on(page);
  const low = await lowCorner(page, t);
  await t.tap(low.at);
  const at = await settled(page, low.i);
  await sheetClearOf(page, at);
  const panned = await viewBox(page);

  // pan the plan a little with a finger on the floor, then close the sheet: the plan stays put
  const from = await emptyFloor(page);
  await t.drag([from, [from[0] + 40, from[1]]], 6);
  const mine = await viewBox(page);
  expect(mine).not.toEqual(panned);
  await page.locator("section.bottom-sheet").getByRole("button", { name: "Close" }).tap();
  await expect(page.locator("section.bottom-sheet")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await viewBox(page)).toEqual(mine);
  expect(errors).toEqual([]);
});

test("with reduced motion the plan jumps there at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await serve(page);
  await open(page);
  const t = await Touch.on(page);
  const low = await lowCorner(page, t);
  // count the plan's moves after the tap: one jump, no glide
  await page.evaluate(() => {
    const w = window as unknown as { viewBoxes: string[] };
    w.viewBoxes = [];
    const svg = document.querySelector("svg.plan-svg")!;
    new MutationObserver(() => w.viewBoxes.push(svg.getAttribute("viewBox")!)).observe(svg, { attributes: true, attributeFilter: ["viewBox"] });
  });
  await t.tap(low.at);
  const at = await settled(page, low.i);
  await sheetClearOf(page, at);
  expect(await page.evaluate(() => (window as unknown as { viewBoxes: string[] }).viewBoxes.length)).toBe(1);
  expect(errors).toEqual([]);
});
