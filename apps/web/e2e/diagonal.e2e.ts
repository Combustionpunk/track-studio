// Quick mode step 1 diagonal lanes (#82): lay 45° runs corner to corner, the refusal for a step into a square a
// diagonal passed between, and an octagon that closes through a diagonal and bakes clean. Mouse only (desktop layout),
// at 1200 and 1024 px. SHOTS=<dir> saves screenshots there.
import { expect, test, type Page } from "@playwright/test";

type XY = [number, number];

const BLANK = "/new/design?length=22&width=12&name=Octagon";
const OCTAGON: XY[] = [[2, 0], [8, 0], [10, 2], [10, 3], [8, 5], [2, 5], [0, 3], [0, 2], [2, 0]];
const SHOTS = process.env.SHOTS;

async function cell(page: Page, c: number, r: number): Promise<XY> {
  return page.evaluate(([c, r]) => {
    const svg = document.querySelector("svg.plan-svg") as SVGSVGElement;
    const h = document.querySelector("rect.lay-hit")!;
    const x = +h.getAttribute("x")! + (c + 0.5) * 2, y = +h.getAttribute("y")! + +h.getAttribute("height")! - (r + 0.5) * 2;
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!);
    return [p.x, p.y] as XY;
  }, [c, r]);
}

/** 7 steps per move by default, so no sample lands exactly on a grid corner */
async function drag(page: Page, cells: XY[], start = true, steps = 7) {
  const path: XY[] = [];
  for (const [c, r] of cells) path.push(await cell(page, c, r));
  if (start) {
    await page.mouse.move(...path[0]);
    await page.mouse.down();
  }
  for (const p of path.slice(start ? 1 : 0)) await page.mouse.move(...p, { steps });
}

const hint = (page: Page) => page.locator(".designer-hint");
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
};

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 860 });
  await page.goto(BLANK);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("rect.lay-hit");
}

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "mouse only"));

for (const width of [1200, 1024]) {
  test(`${width} px: diagonal runs, no step beside a diagonal, and an octagon that closes and bakes clean`, async ({ page }) => {
    await open(page, width);
    await expect(page.locator(".designer-palette")).toContainText("corner to corner for a diagonal");
    await expect(hint(page)).toContainText("diagonally");
    await expect(hint(page)).toContainText("Turns are 45°, 90° or 135°. Step 2 rounds them and shows where lanes squeeze or overlap.");

    // north-east [1, 0] → [4, 3], round, then west along row 1: [3, 1] is one the diagonal passed between
    await drag(page, [[1, 0], [4, 3], [6, 3], [6, 1], [2, 1]]);
    await expect(hint(page)).toHaveText("Too close to a diagonal: lanes would overlap.");
    await expect(page.locator("rect.lay-cell")).toHaveCount(10); // stops on [4, 1]
    await shot(page, "1-refused");
    await page.mouse.up();

    await open(page, width);
    // slowly, a little off the diagonal, clipping [8, 1] beside the corner: still corner to corner
    await drag(page, [...OCTAGON.slice(0, 2), [8.6, 1]], true, 20);
    await drag(page, [OCTAGON[2]], false, 20);
    await expect(page.locator("rect.lay-cell")).toHaveCount(9);
    await shot(page, "2-diagonal");
    await drag(page, OCTAGON.slice(3), false);
    await page.mouse.up();

    await expect(page.locator("g.ed-corner")).toHaveCount(8);
    const checks = page.locator(".designer-side .checks-panel");
    await expect(checks).toContainText("No problems found.", { timeout: 15_000 });
    await shot(page, "3-octagon");
  });
}

test("a mouse released near the edge of the next square still paints it, closing the loop too (#96)", async ({ page }) => {
  await open(page, 1200);
  // [0, 0] → [3, 0], then just into [4, 0] (0.4 of a square off its centre): the drag never moves on to it
  await drag(page, [[0, 0], [3, 0], [3.6, 0]]);
  await expect(page.locator("rect.lay-cell")).toHaveCount(4);
  await page.mouse.up();
  await expect(page.locator("rect.lay-cell")).toHaveCount(5);
  await shot(page, "96-released");
  // round and back down column 0, released just inside the top of the first square: the loop closes
  await drag(page, [[3.6, 0], [4, 0], [4, 2], [0, 2], [0, 0.4]]);
  await page.mouse.up();
  await expect(page.locator("g.ed-corner")).toHaveCount(4);
});
