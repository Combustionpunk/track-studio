// A low jump, cone or the start line stays reachable while its sheet is open (#198), as a corner does (#188): the plan
// pans it up above the selection sheet so a finger can drag it at once. One already clear doesn't move the plan, and the
// plan stays where the member moved it.
import { expect, test, type Page } from "@playwright/test";
import { emptyFloor, open, pinchIn, planBox, serve, sheetClearOf, viewBox, withCones } from "./phone-helper.js";
import { Touch, type XY } from "./touch-helper.js";

test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "the phone"));

const KINDS = [
  { name: "jump", sel: "svg.plan-svg .ed-hit-feature" },
  { name: "cone", sel: "svg.plan-svg g.ed-marshal .ed-hit" },
  { name: "start line", sel: "svg.plan-svg g.ed-start .ed-hit" },
];

const centres = (page: Page, sel: string) =>
  page.locator(sel).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; }));
/** what a finger at `at` gets is this kind of item (not a corner or handle over it) */
const gets = (page: Page, sel: string, at: XY) =>
  page.evaluate(([s, x, y]) => { const el = document.elementFromPoint(x as number, y as number); return !!el && !!el.closest(s as string); }, [sel, at[0], at[1]] as [string, number, number]);

/**
 * Put the first item of this kind where `frac` of the plan's height is above it (and midway across), by dragging the
 * floor with one finger, so the test doesn't depend on where the fixture has it. Returns where it is, and that a
 * finger there gets it.
 */
async function place(page: Page, t: Touch, sel: string, frac: number): Promise<{ i: number; at: XY }> {
  await pinchIn(page, t);
  const b = await planBox(page);
  for (let tries = 0; tries < 3; tries++) {
    const [c] = await centres(page, sel);
    const from = await emptyFloor(page);
    const dx = b.x + b.width / 2 - c[0], dy = b.y + b.height * frac - c[1];
    if (Math.abs(dx) + Math.abs(dy) < 6) break;
    const to: XY = [Math.max(b.x + 10, Math.min(b.x + b.width - 10, from[0] + dx)), Math.max(b.y + 10, Math.min(b.y + b.height - 10, from[1] + dy))];
    await t.drag([from, to], 8);
  }
  const at = (await centres(page, sel))[0];
  expect(await gets(page, sel, at), "a finger there gets the item").toBe(true);
  return { i: 0, at };
}

async function settled(page: Page, sel: string, i: number): Promise<XY> {
  await page.waitForTimeout(250);
  let last: XY = [NaN, NaN];
  let still = 0;
  await expect
    .poll(async () => {
      const now = (await centres(page, sel))[i];
      still = Math.hypot(now[0] - last[0], now[1] - last[1]) < 0.5 ? still + 1 : 0;
      last = now;
      return still;
    }, { intervals: [100] })
    .toBeGreaterThanOrEqual(2);
  return last;
}

for (const k of KINDS) {
  test.describe(k.name, () => {
    test(`a low ${k.name} is panned above its sheet, can be dragged at once, and the plan pans back after`, async ({ page }) => {
      const errors = await serve(page, withCones);
      await open(page);
      const t = await Touch.on(page);
      const low = await place(page, t, k.sel, 0.85);
      const before = await viewBox(page);
      await t.tap(low.at);
      const sheet = page.locator("section.bottom-sheet");
      await expect(sheet).toHaveClass(/bottom-sheet--peek/);
      const at = await settled(page, k.sel, low.i);
      await sheetClearOf(page, at);
      expect(at[1], "moved up the screen").toBeLessThan(low.at[1]);
      expect(await gets(page, k.sel, at), "the finger gets the item").toBe(true);

      await t.down(at);
      await t.move([[at[0] + 30, at[1] - 40]], 7);
      await expect(sheet).toHaveClass(/bottom-sheet--tucked/);
      await t.up();
      await expect(sheet).not.toHaveClass(/bottom-sheet--tucked/);

      await sheet.getByRole("button", { name: "Close" }).tap();
      await expect(sheet).toHaveCount(0);
      await expect.poll(() => viewBox(page)).toEqual(before);
      expect(errors).toEqual([]);
    });

    test(`a ${k.name} already clear of its sheet doesn't move the plan`, async ({ page }) => {
      const errors = await serve(page, withCones);
      await open(page);
      const t = await Touch.on(page);
      const up = await place(page, t, k.sel, 0.25);
      const before = await viewBox(page);
      await t.tap(up.at);
      await sheetClearOf(page, up.at);
      await page.waitForTimeout(300);
      expect(await viewBox(page)).toEqual(before);
      expect(errors).toEqual([]);
    });

    test(`the plan stays where the member moved it while the ${k.name}'s sheet was open`, async ({ page }) => {
      const errors = await serve(page, withCones);
      await open(page);
      const t = await Touch.on(page);
      const low = await place(page, t, k.sel, 0.85);
      await t.tap(low.at);
      const at = await settled(page, k.sel, low.i);
      await sheetClearOf(page, at);
      const panned = await viewBox(page);
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
  });
}
