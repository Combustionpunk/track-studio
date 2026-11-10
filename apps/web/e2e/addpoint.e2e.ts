// The Add point tool (#114): a plain click or drag on the track (or, in Quick, the floor) adds no corner point; with
// the tool on, a click adds exactly one; Esc, A or the tool again turns it off; the keyboard adds one with N / P and
// Enter; undo takes an added point away in one step; on a tablet it's tap the tool, then tap the track. In Quick and
// Advanced with the mouse at 1200 px, and by touch on the tablet projects. SHOTS=<dir> saves screenshots there.
import { expect, test, type Page } from "@playwright/test";
import { cell, screen, Touch, type XY } from "./touch-helper.js";

const BLANK = "/new/design?length=22&width=12&name=Add%20point";
/** round the edge of the area, back to the first square */
const LOOP: XY[] = [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]];
const SHOTS = process.env.SHOTS;

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
};
/** corner points in plan coordinates, in driving order: Quick draws numbered dots, Advanced plain handles */
const CORNER = "g.ed-corner .ed-corner-dot, circle.ed-point";
const corners = (page: Page) => page.locator(CORNER).evaluateAll((els) => els.map((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!] as XY));
const isTouch = (name: string) => name.startsWith("tablet");
/** the screen spot halfway along the straight from corner a to corner b (on the racing line, away from both points;
 * not the south straight, where the start line is) */
const midway = async (page: Page, a: number, b: number) => {
  const c = await corners(page);
  return screen(page, (c[a][0] + c[b][0]) / 2, (c[a][1] + c[b][1]) / 2);
};
const live = (page: Page) => page.locator(".designer-plan-wrap [role=status]");

async function open(page: Page) {
  await page.goto(BLANK);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("rect.lay-hit");
  await page.waitForTimeout(200);
}

/** lay the loop with the mouse in Quick (four corners), then switch to `mode` */
async function layLoop(page: Page, mode: "quick" | "advanced") {
  const path: XY[] = [];
  for (const [c, r] of LOOP) path.push(await cell(page, c, r));
  await page.mouse.move(...path[0]);
  await page.mouse.down();
  for (const p of path.slice(1)) await page.mouse.move(...p, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(CORNER)).toHaveCount(4);
  if (mode === "advanced") await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Advanced" }).click();
  await expect(page.locator(`.designer-${mode}`)).toBeVisible();
}

test.describe("mouse, 1200 px", () => {
  test.beforeEach(({}, info) => test.skip(isTouch(info.project.name), "mouse only"));

  for (const mode of ["quick", "advanced"] as const) {
    test(`${mode}: a plain click or drag adds no point; with the tool on a click adds exactly one; Esc turns it off; undo takes it away`, async ({ page }) => {
      await open(page);
      await layLoop(page, mode);
      const tool = page.locator(".designer-palette").getByRole("button", { name: "Add point" });
      await expect(tool).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".designer-hint")).toContainText("Add point (A)");
      const before = await corners(page);

      // a plain click on the straight, and on the floor: nothing added
      await page.mouse.click(...(await midway(page, 1, 2)));
      await page.mouse.click(...(await screen(page, -4, 0)));
      await expect(page.locator(CORNER)).toHaveCount(4);
      // a drag along the straight pans the plan, and moves and adds nothing
      const m = await midway(page, 1, 2);
      await page.mouse.move(...m);
      await page.mouse.down();
      await page.mouse.move(m[0] + 60, m[1] - 40, { steps: 6 });
      await page.mouse.up();
      await expect(page.locator(CORNER)).toHaveCount(4);
      expect(await corners(page)).toEqual(before);
      await shot(page, `${mode}-1-off`);

      // the tool on: pressed, the cursor shows it, the line lights up under the pointer
      await tool.click();
      await expect(tool).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("g.ed.ed-adding")).toHaveCount(1);
      const at = await midway(page, 1, 2);
      await page.mouse.move(...at);
      await expect(page.locator(".ed-lane polyline").first()).toHaveCSS("cursor", "copy");
      await expect.poll(() => page.locator(".ed-lane polyline").first().evaluate((e) => getComputedStyle(e).stroke)).not.toBe("none");
      await expect.poll(() => page.locator(".ed-lane polyline").first().evaluate((e) => getComputedStyle(e).stroke)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      await shot(page, `${mode}-2-on`);
      await page.mouse.click(...at);
      await expect(page.locator(CORNER)).toHaveCount(5);
      // it stays on for the next one
      await expect(tool).toHaveAttribute("aria-pressed", "true");
      await shot(page, `${mode}-3-added`);

      // Esc: off, and a click adds nothing again
      await page.keyboard.press("Escape");
      await expect(tool).toHaveAttribute("aria-pressed", "false");
      await page.mouse.click(...(await midway(page, 2, 3)));
      await expect(page.locator(CORNER)).toHaveCount(5);

      // Ctrl+Z takes the added point away in one step
      await page.keyboard.press("Control+z");
      await expect(page.locator(CORNER)).toHaveCount(4);
      expect(await corners(page)).toEqual(before);

      // press and pull adds a point and drags it on: still one undo step
      await tool.click();
      const from = await midway(page, 2, 3);
      await page.mouse.move(...from);
      await page.mouse.down();
      await page.mouse.move(from[0], from[1] + 50, { steps: 6 });
      await page.mouse.up();
      await expect(page.locator(CORNER)).toHaveCount(5);
      await page.keyboard.press("Control+z");
      await expect(page.locator(CORNER)).toHaveCount(4);
      expect(await corners(page)).toEqual(before);
    });
  }

  test("A toggles the tool, and so does the button; deleting a point is unchanged", async ({ page }) => {
    await open(page);
    await layLoop(page, "quick");
    const tool = page.locator(".designer-palette").getByRole("button", { name: "Add point" });
    await page.keyboard.press("a");
    await expect(tool).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("a");
    await expect(tool).toHaveAttribute("aria-pressed", "false");
    await tool.click();
    await expect(tool).toHaveAttribute("aria-pressed", "true");
    await tool.click();
    await expect(tool).toHaveAttribute("aria-pressed", "false");
    // Delete on a selected corner still takes it away
    await page.keyboard.press("a");
    await page.mouse.click(...(await midway(page, 1, 2)));
    await expect(page.locator(CORNER)).toHaveCount(5);
    await page.keyboard.press("Escape");
    await page.mouse.click(...(await screen(page, ...(await corners(page))[2])));
    await page.keyboard.press("Delete");
    await expect(page.locator(CORNER)).toHaveCount(4);
  });

  for (const mode of ["quick", "advanced"] as const) {
    test(`${mode}: from the keyboard: A, N / P to pick a corner, Enter adds a point halfway to the next; undo in one step`, async ({ page }) => {
      await open(page);
      await layLoop(page, mode);
      const before = await corners(page);
      // the keys work with the plan focused (Tab gets there), not on a button, whose Enter is its own
      await page.locator(".designer-plan .plan-svg").focus();
      // Enter without the tool adds nothing
      await page.keyboard.press("Enter");
      await expect(page.locator(CORNER)).toHaveCount(4);
      await page.keyboard.press("a");
      await page.keyboard.press("n");
      await expect(live(page)).toHaveText("Corner 1 of 4.");
      await page.keyboard.press("n");
      await page.keyboard.press("p");
      await expect(live(page)).toHaveText("Corner 1 of 4.");
      await page.keyboard.press("Enter");
      await expect(live(page)).toHaveText("Added corner 2, halfway to the next one.");
      const after = await corners(page);
      expect(after).toHaveLength(5);
      expect(after[1][0]).toBeCloseTo((before[0][0] + before[1][0]) / 2, 2);
      expect(after[1][1]).toBeCloseTo((before[0][1] + before[1][1]) / 2, 2);
      await page.keyboard.press("Control+z");
      await expect(page.locator(CORNER)).toHaveCount(4);
      expect(await corners(page)).toEqual(before);
      // with the Add point button focused (just clicked, or tabbed to), Enter adds a point too, and leaves the tool on
      const tool = page.locator(".designer-palette").getByRole("button", { name: "Add point" });
      await tool.focus();
      await page.keyboard.press("n");
      await page.keyboard.press("Enter");
      await expect(page.locator(CORNER)).toHaveCount(5);
      await expect(tool).toHaveAttribute("aria-pressed", "true");
    });
  }
});

test.describe("tablet touch", () => {
  test.beforeEach(({}, info) => test.skip(!isTouch(info.project.name), "touch only"));

  test("tap the track adds nothing; tap Add point, then tap the track adds one; tap the tool again to stop", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    const path: XY[] = [];
    for (const [c, r] of LOOP) path.push(await cell(page, c, r));
    await t.drag(path, 10);
    await expect(page.locator("g.ed-corner")).toHaveCount(4);

    await t.tap(await midway(page, 1, 2));
    await expect(page.locator("g.ed-corner")).toHaveCount(4);
    await t.tap(await screen(page, -4, 0));
    await expect(page.locator("g.ed-corner")).toHaveCount(4);

    const tool = page.getByRole("toolbar", { name: "Designer tools" }).getByRole("button", { name: "Add point" });
    await tool.tap();
    await expect(tool).toHaveAttribute("aria-pressed", "true");
    // no hover on a tablet: the whole line shows while the tool is on
    await expect.poll(() => page.locator(".ed-lane polyline").first().evaluate((e) => getComputedStyle(e).stroke)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await expect(page.locator(".designer-hint")).toContainText("Tap the track or the floor to add a corner");
    await shot(page, "tablet-on");
    await t.tap(await midway(page, 1, 2));
    await expect(page.locator("g.ed-corner")).toHaveCount(5);
    await tool.tap();
    await expect(tool).toHaveAttribute("aria-pressed", "false");
    await t.tap(await midway(page, 2, 3));
    await expect(page.locator("g.ed-corner")).toHaveCount(5);
    await page.getByRole("toolbar", { name: "Designer tools" }).getByRole("button", { name: "Undo" }).tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(4);
  });
});
