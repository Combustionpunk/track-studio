// #157: ramps get drag-and-drop, as cones did in #151: press a jump in the palette (laptop), the dock (tablet) or the
// phone's Jump sheet, drag it onto the track and let go; it lands on the racing line there (a drop off the track, as a
// click there with the jump armed, places nothing). Arm-and-tap still works. With a jump or the cone armed, a
// two-finger pinch or a one-finger pan on touch places nothing: only a tap does. Desktop (1200 × 860, a mouse), tablet (1024 × 768, touch) and phone (375 × 812, touch).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { doc, emptyFloor, open, serve, shot, toolBtn, viewBox } from "./phone-helper.js";
import { screen, Touch, type XY } from "./touch-helper.js";

test.beforeEach(async ({ page }) => {
  if (process.env.SHOTS_SCHEME === "dark") await page.emulateMedia({ colorScheme: "dark" });
});

const rest = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const jumps = (page: Page) => page.locator("svg.plan-svg polygon.ed-feature");
const cones = (page: Page) => page.locator("svg.plan-svg g.ed-marshal");
/** where to put a finger or the mouse on it, once it has stopped moving (a sheet slides in) */
const centre = async (l: Locator): Promise<XY> => {
  await l.click({ trial: true });
  const b = (await l.boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};
/** a spot on the lane, on screen, with nothing but the lane within a finger's reach: from the layout's racing line */
async function laneSpot(page: Page, skip = 0): Promise<XY> {
  const line = (doc.built.racingLine as [number, number, number][]).filter((_, k) => k % 6 === 0);
  let found = 0;
  for (const [x, z] of line) {
    const at = await screen(page, x, z);
    const ok = await page.evaluate(([x, y]) => {
      for (const [dx, dy] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) {
        const el = document.elementFromPoint(x + dx, y + dy);
        // the lane, or (with the cone armed) the cone tool's placing area over it
        if (!["lane", "marshal-place"].includes(el?.closest("[data-handle]")?.getAttribute("data-handle") ?? "")) return false;
      }
      return true;
    }, at);
    if (ok && found++ === skip) return at;
  }
  throw new Error("no clear spot on the lane");
}
/** press, move a little (past the palette's drag threshold), then on to `to`, by mouse */
async function mouseDrag(page: Page, from: XY, to: XY) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0] + 30, from[1], { steps: 3 });
  await page.mouse.move(...to, { steps: 10 });
}

test.describe("dragging a ramp on a laptop", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "a laptop with a mouse"));

  test("drag a kicker from the palette onto the plan: a ghost follows, it lands on the line, one undo step; a drop off the plan does nothing", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const n = await jumps(page).count();
    const button = page.locator(".designer-palette").getByRole("button", { name: "Kicker", exact: true });
    await expect(button).toBeVisible();
    const to = await laneSpot(page);
    await mouseDrag(page, await centre(button), [to[0] + 6, to[1] + 6]);
    await expect(page.locator(".jump-drag-ghost")).toBeVisible();
    await expect(page.locator("svg.plan-svg polygon.ed-ghost")).toHaveCount(1); // where it would go, on the line
    await shot(page, "1200-drag-ramp");
    await page.mouse.up();
    await expect(page.locator(".jump-drag-ghost")).toHaveCount(0);
    await expect(page.locator("svg.plan-svg polygon.ed-ghost")).toHaveCount(0);
    await expect(jumps(page)).toHaveCount(n + 1);
    // the new jump is selected, and the drop isn't a click: Kicker isn't left armed
    await expect(page.locator("svg.plan-svg polygon.ed-feature.on")).toHaveCount(1);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Control+z");
    await expect(jumps(page)).toHaveCount(n);
    // let go over the palette itself: called off
    const from = await centre(button);
    await mouseDrag(page, from, [from[0] + 40, from[1] + 10]);
    await page.mouse.up();
    await expect(jumps(page)).toHaveCount(n);
    // let go on the floor, off the track: called off too, as a click there with a jump armed places nothing
    await mouseDrag(page, await centre(button), await emptyFloor(page));
    await expect(page.locator("svg.plan-svg polygon.ed-ghost")).toHaveCount(0);
    await page.mouse.up();
    await expect(jumps(page)).toHaveCount(n);
    // arm-and-click still works
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(...(await laneSpot(page)));
    await expect(jumps(page)).toHaveCount(n + 1);
    expect(errors).toEqual([]);
  });
});

test.describe("dragging a ramp on a tablet", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "tablet-landscape", "a tablet, 1024 × 768"));

  for (const what of ["Kicker", "Cone"] as const) {
    test(`drag ${what === "Cone" ? "the cone" : "a kicker"} from the dock onto the plan with a finger`, async ({ page }) => {
      const errors = await serve(page);
      await open(page);
      const t = await Touch.on(page);
      const count = what === "Cone" ? cones : jumps;
      const n = await count(page).count();
      const button = page.locator(".designer-dock").getByRole("button", { name: what, exact: true });
      await expect(button).toBeVisible();
      // the dock's buttons take a touch-action of their own: a drag from one must not be taken as a pan
      expect(await button.evaluate((b) => getComputedStyle(b).touchAction)).toBe("none");
      const from = await centre(button);
      const to = await laneSpot(page);
      await t.down(from);
      await t.move([[from[0], from[1] - 20]], 3);
      await t.move([to], 10);
      await expect(page.locator(".palette-drag-ghost")).toBeVisible();
      await t.up();
      await expect(count(page)).toHaveCount(n + 1);
      await expect(button).toHaveAttribute("aria-pressed", "false");
      expect(errors).toEqual([]);
    });
  }

  test("with a jump armed, a pinch and a pan place nothing; a tap does", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    const n = await jumps(page).count();
    const button = page.locator(".designer-dock").getByRole("button", { name: "Kicker", exact: true });
    await t.tap(await centre(button));
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await rest(300);
    const lane = await laneSpot(page);
    // a pinch, the first finger on the lane
    await t.down(lane, [lane[0] + 60, lane[1]]);
    await t.move([[lane[0] - 40, lane[1]], [lane[0] + 140, lane[1]]], 8);
    await t.up();
    await rest(300);
    await expect(jumps(page)).toHaveCount(n);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const panFrom = await laneSpot(page);
    const before = await viewBox(page);
    await t.drag([panFrom, [panFrom[0] + 90, panFrom[1] + 40]], 8);
    await rest(300);
    await expect(jumps(page)).toHaveCount(n);
    expect(await viewBox(page)).not.toEqual(before); // the finger panned the plan
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await t.tap(await laneSpot(page));
    await expect(jumps(page)).toHaveCount(n + 1);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });
});

test.describe("dragging a ramp on a phone", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("drag a kicker from the Jump sheet onto the plan; it lands on the line, one undo step", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    const n = await jumps(page).count();
    await toolBtn(page, "Jump").tap();
    const chip = page.getByRole("dialog", { name: "Jumps" }).getByRole("button", { name: "Kicker", exact: true });
    await expect(chip).toBeVisible();
    const from = await centre(chip);
    const to = await laneSpot(page); // on the track, above the sheet
    await t.down(from);
    await t.move([[from[0], from[1] - 20]], 3);
    await t.move([to], 10);
    await expect(page.locator(".jump-drag-ghost")).toBeVisible();
    await shot(page, "375-drag-ramp");
    await t.up();
    await expect(jumps(page)).toHaveCount(n + 1);
    await expect(page.locator(".jump-drag-ghost")).toHaveCount(0);
    await expect(toolBtn(page, "Jump")).toHaveAttribute("aria-pressed", "false");
    await toolBtn(page, "Undo").tap();
    await expect(jumps(page)).toHaveCount(n);
    expect(errors).toEqual([]);
  });

  for (const what of ["Kicker", "Cone"] as const) {
    test(`with ${what === "Cone" ? "the cone" : "a jump"} armed, a pinch and a pan place nothing; a tap does`, async ({ page }) => {
      const errors = await serve(page);
      await open(page);
      const t = await Touch.on(page);
      const count = what === "Cone" ? cones : jumps;
      const n = await count(page).count();
      await toolBtn(page, "Jump").tap();
      await page.getByRole("dialog", { name: "Jumps" }).getByRole("button", { name: what, exact: true }).tap();
      await expect(toolBtn(page, "Jump")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("section.bottom-sheet")).toHaveCount(0);
      await rest(300);
      // a pinch, the first finger on the lane (where a jump would go; a cone may go anywhere)
      const lane = await laneSpot(page);
      await t.down(lane, [lane[0] + 50, lane[1] + 30]);
      await t.move([[lane[0] - 30, lane[1] - 20], [lane[0] + 110, lane[1] + 70]], 8);
      await t.up();
      await rest(300);
      await expect(count(page)).toHaveCount(n);
      await expect(toolBtn(page, "Jump")).toHaveAttribute("aria-pressed", "true");
      // a one-finger pan from the lane
      const panFrom = await laneSpot(page);
      const before = await viewBox(page);
      await t.drag([panFrom, [panFrom[0] + 60, panFrom[1] + 50]], 8);
      await rest(300);
      await expect(count(page)).toHaveCount(n);
      expect(await viewBox(page)).not.toEqual(before);
      await expect(toolBtn(page, "Jump")).toHaveAttribute("aria-pressed", "true");
      // and a tap places one
      await t.tap(await laneSpot(page));
      await expect(count(page)).toHaveCount(n + 1);
      await expect(toolBtn(page, "Jump")).toHaveAttribute("aria-pressed", "false");
      expect(errors).toEqual([]);
    });
  }
});
