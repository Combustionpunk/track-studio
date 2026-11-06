// Undo and redo of a Reverse (#61): reversing renumbers the corners, so a selected corner number must follow its
// corner, not stay on the number. Mouse only (desktop layout), in Quick and in Advanced.
import { expect, test, type Page } from "@playwright/test";

type XY = [number, number];

const BLANK = "/new/design?length=22&width=12&name=Reverse";
/** round the edge of the area, back to the first square: four corners */
const LOOP: XY[] = [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]];

const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => {
    const svg = document.querySelector("svg.plan-svg") as SVGSVGElement;
    const p = new DOMPoint(x, -z).matrixTransform(svg.getScreenCTM()!);
    return [p.x, p.y] as XY;
  }, [x, z] as XY);

async function cell(page: Page, c: number, r: number): Promise<XY> {
  const g = await page.evaluate(() => {
    const h = document.querySelector("rect.lay-hit")!;
    return { x: +h.getAttribute("x")!, y: +h.getAttribute("y")!, h: +h.getAttribute("height")! };
  });
  return screen(page, g.x + (c + 0.5) * 2, -(g.y + g.h - (r + 0.5) * 2));
}

/** corner points in plan coordinates, in driving order: Quick draws numbered dots, Advanced plain handles */
const CORNER = "g.ed-corner .ed-corner-dot, circle.ed-point";
const corners = (page: Page) => page.locator(CORNER).evaluateAll((els) => els.map((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!] as XY));
/** the selected corner: its number (from the dot in Quick, the handle's index in Advanced), its spot, and the number in the panel's heading */
const selected = async (page: Page) => {
  const on = page.locator("g.ed-corner.on, circle.ed-point.on");
  if ((await on.count()) === 0) return null;
  const { n, at } = await on.evaluate((e) => {
    const dot = e.matches("g") ? e.querySelector(".ed-corner-dot")! : e;
    const n = e.matches("g") ? e.querySelector("text")!.textContent : String(+e.getAttribute("data-index")! + 1);
    return { n, at: [+dot.getAttribute("cx")!, -dot.getAttribute("cy")!] as [number, number] };
  });
  // the panel says "Corner 2" in Quick and "Corner point 2" in Advanced: its number
  return { n, at, panel: (await page.locator(".sel-panel h2").textContent())?.match(/\d+$/)?.[0] };
};

/** a blank area with the loop laid round its edge in Quick (four corners), then in this mode */
async function open(page: Page, mode: "quick" | "advanced") {
  await page.goto(BLANK);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("rect.lay-hit");
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

async function select(page: Page, at: XY) {
  await page.mouse.click(...(await screen(page, ...at)));
}

const bar = (page: Page) => page.locator(".designer-bar");

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "mouse only"));

for (const mode of ["quick", "advanced"] as const) {
  test.describe(`${mode} mode`, () => {
    test("select corner 2, reverse, then undo and redo: never a different corner under the same number", async ({ page }) => {
      await open(page, mode);
      const before = await corners(page);
      await select(page, before[1]);
      await expect.poll(() => selected(page)).toEqual({ n: "2", at: before[1], panel: "2" });

      await bar(page).getByRole("button", { name: "Reverse direction" }).click();
      await expect.poll(() => corners(page)).toEqual([before[0], ...before.slice(1).reverse()]);
      // corner 2 is now a different corner, so the reverse lets it go
      await expect.poll(() => selected(page)).toBeNull();

      // pick corner 2 of the reversed loop (the old corner 4), then undo: the selection stays on that corner, now 4
      await select(page, before[3]);
      await expect.poll(() => selected(page)).toEqual({ n: "2", at: before[3], panel: "2" });
      await bar(page).getByRole("button", { name: "Undo" }).click();
      await expect.poll(() => corners(page)).toEqual(before);
      await expect.poll(() => selected(page)).toEqual({ n: "4", at: before[3], panel: "4" });

      // redo: the same corner, number 2 again
      await bar(page).getByRole("button", { name: "Redo" }).click();
      await expect.poll(() => corners(page)).toEqual([before[0], ...before.slice(1).reverse()]);
      await expect.poll(() => selected(page)).toEqual({ n: "2", at: before[3], panel: "2" });

      // and from the keyboard: Ctrl+Z, then Ctrl+Shift+Z
      await page.keyboard.press("Control+z");
      await expect.poll(() => selected(page)).toEqual({ n: "4", at: before[3], panel: "4" });
      await page.keyboard.press("Control+Shift+z");
      await expect.poll(() => selected(page)).toEqual({ n: "2", at: before[3], panel: "2" });
    });

    test("corner 1 stays corner 1 through a reverse and its undo", async ({ page }) => {
      await open(page, mode);
      const before = await corners(page);
      await bar(page).getByRole("button", { name: "Reverse direction" }).click();
      await expect.poll(() => corners(page)).toEqual([before[0], ...before.slice(1).reverse()]);
      await select(page, before[0]);
      await expect.poll(() => selected(page)).toEqual({ n: "1", at: before[0], panel: "1" });
      await bar(page).getByRole("button", { name: "Undo" }).click();
      await expect.poll(() => corners(page)).toEqual(before);
      await expect.poll(() => selected(page)).toEqual({ n: "1", at: before[0], panel: "1" });
    });
  });
}
