// Quick mode step 1 diagonal lanes (#82): lay 45° runs corner to corner, a step beside a diagonal (#104: painted) and
// across it (refused: not at right angles), an octagon that closes through a diagonal and bakes clean, and (#104) a
// loop closing diagonally past its own start square with a 135° turn. Mouse only (desktop layout),
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
  test(`${width} px: diagonal runs, a step beside a diagonal, and an octagon that closes and bakes clean`, async ({ page }) => {
    await open(page, width);
    await expect(page.locator(".designer-palette")).toContainText("corner to corner for a diagonal");
    await expect(hint(page)).toContainText("diagonally");
    await expect(hint(page)).toContainText("Turns are 45°, 90° or 135°. Step 2 rounds them and shows where lanes squeeze or overlap.");

    // north-east [1, 0] → [4, 3], round, then west along row 1: [3, 1] is one the diagonal passed between (#104:
    // painted), and [2, 1] is on the diagonal, a crossing not at right angles
    await drag(page, [[1, 0], [4, 3], [6, 3], [6, 1], [2, 1]]);
    await expect(hint(page)).toHaveText("The lane can only cross itself straight across, at right angles.");
    await expect(page.locator("rect.lay-cell")).toHaveCount(11); // stops on [3, 1]
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

test("a loop closing diagonally past its own start square, a 135° turn, closes and bakes clean (#104)", async ({ page }) => {
  await open(page, 1200);
  // Yeti's case: east along the top row, down the right side, west, then north-west into the start square, past [1, 5]
  await drag(page, [[0, 5], [6, 5], [6, 0], [5, 0], [0, 5]]);
  await page.mouse.up();
  await expect(page.locator("g.ed-corner")).toHaveCount(4);
  await expect(page.locator(".designer-side .checks-panel")).toContainText("No problems found.", { timeout: 15_000 });
  await shot(page, "104-closing-past-start");
});

test("a lane right beside the point of a V paints and bakes clean; a hook past the lane's square shows a squeeze (#104)", async ({ page }) => {
  await open(page, 1200);
  // east along row 0 under a V at [4, 1] pointing down onto it, coming south-west from [8, 5]
  await drag(page, [[0, 0], [10, 0], [10, 5], [8, 5], [4, 1], [1, 4], [0, 4], [0, 0]]);
  await page.mouse.up();
  await expect(page.locator("g.ed-corner")).toHaveCount(7);
  await expect(page.locator(".designer-side .checks-panel:not(.venue-check)")).toContainText("No problems found.", { timeout: 15_000 });
  await shot(page, "104-lane-beside-v");

  await open(page, 1200);
  // a diagonal [2, 0] → [3, 1] past [2, 1], the lane's own square: the lanes share a pipe, one squeezed
  await drag(page, [[0, 1], [2, 1], [2, 0], [3, 1], [3, 3], [0, 3], [0, 1]]);
  await page.mouse.up();
  await expect(page.locator("g.ed-corner")).toHaveCount(6);
  await expect(page.locator(".designer-side .checks-panel:not(.venue-check)")).toContainText("Lane narrows by 0.08 m at this corner", { timeout: 15_000 });
  await shot(page, "104-hook-squeeze");
});
