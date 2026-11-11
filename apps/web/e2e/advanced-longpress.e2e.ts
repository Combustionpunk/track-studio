// A long press on a corner point in Advanced mode must not delete it on touch (#119, ADR 0005). Chrome fires
// `contextmenu` on a touch long-press; only a mouse's right-click may delete. Touch on the tablet projects (Advanced
// and, unchanged, Quick); the mouse on the desktop project, where right-click still deletes and undo restores it.
import { expect, test, type Page } from "@playwright/test";
import { cell, screen, Touch, type XY } from "./touch-helper.js";

const BLANK = "/new/design?length=22&width=12&name=Long%20press";
/** round the edge of the area, back to the first square */
const LOOP: XY[] = [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]];
/** Advanced draws corners as plain handles */
const POINT = "circle.ed-point";
const isTouch = (name: string) => name.startsWith("tablet");
/** corner points in plan coordinates, from their handles or dots */
const corners = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!] as XY));
const toAdvanced = (page: Page) => page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Advanced" }).click();

async function open(page: Page) {
  await page.goto(BLANK);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("rect.lay-hit");
  await page.waitForTimeout(200);
}

/**
 * A long press: hold still well past LONG_PRESS_MS, then lift. On a device, Chrome fires `contextmenu` on whatever is
 * under the finger while it's held; headless Chromium's touch emulation doesn't (checked: a 900 ms hold fires only
 * pointerdown/touchstart), so the press dispatches that event itself, as Chrome would, before the finger lifts.
 */
async function longPress(page: Page, t: Touch, at: XY) {
  await t.hold(at, 700);
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y)!;
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  }, at);
  await page.waitForTimeout(200);
  await t.up();
}

test.describe("tablet touch", () => {
  test.beforeEach(({}, info) => test.skip(!isTouch(info.project.name), "touch only"));

  /** lay the loop round the edge by touch: step 2 with four corners */
  async function layLoop(page: Page, t: Touch) {
    const path: XY[] = [];
    for (const [c, r] of LOOP) path.push(await cell(page, c, r));
    await t.drag(path, 10);
    await expect(page.locator("g.ed-corner")).toHaveCount(4);
  }

  test("Advanced: a long press on a corner point deletes nothing", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await layLoop(page, t);
    await toAdvanced(page);
    await expect(page.locator(POINT)).toHaveCount(4);
    const before = await corners(page, POINT);
    await longPress(page, t, await screen(page, ...before[2]));
    // give a wrongly fired delete time to land, then check nothing changed
    await page.waitForTimeout(400);
    await expect(page.locator(POINT)).toHaveCount(4);
    expect(await corners(page, POINT)).toEqual(before);
    // and the same again on another point, in case the first press had only selected it
    await longPress(page, t, await screen(page, ...before[0]));
    await page.waitForTimeout(400);
    await expect(page.locator(POINT)).toHaveCount(4);
    expect(await corners(page, POINT)).toEqual(before);
  });

  test("Quick: a long press on a corner still opens its panel and deletes nothing", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await layLoop(page, t);
    const dots = await corners(page, "g.ed-corner .ed-corner-dot");
    await longPress(page, t, await screen(page, ...dots[2]));
    await expect(page.locator(".designer-sheet").getByRole("heading", { name: "Corner 3" })).toBeVisible();
    await expect(page.locator("g.ed-corner")).toHaveCount(4);
  });
});

test.describe("mouse, 1200 px", () => {
  test.beforeEach(({}, info) => test.skip(isTouch(info.project.name), "mouse only"));

  test("Advanced: right-click deletes the corner point; undo restores it in one step", async ({ page }) => {
    await open(page);
    const path: XY[] = [];
    for (const [c, r] of LOOP) path.push(await cell(page, c, r));
    await page.mouse.move(...path[0]);
    await page.mouse.down();
    for (const p of path.slice(1)) await page.mouse.move(...p, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator("g.ed-corner")).toHaveCount(4);
    await toAdvanced(page);
    await expect(page.locator(POINT)).toHaveCount(4);
    const before = await corners(page, POINT);
    await page.mouse.click(...(await screen(page, ...before[2])), { button: "right" });
    await expect(page.locator(POINT)).toHaveCount(3);
    expect(await corners(page, POINT)).toEqual([before[0], before[1], before[3]]);
    await page.keyboard.press("Control+z");
    await expect(page.locator(POINT)).toHaveCount(4);
    expect(await corners(page, POINT)).toEqual(before);
  });
});
