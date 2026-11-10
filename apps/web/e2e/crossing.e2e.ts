// Quick mode step 1 crossing itself (#79): paint a figure of eight straight across the lane, the refusal for a turn on
// the crossing, the closed loop's unbridged crossing, and the checks' "Make it a crossover" fix (undo takes it away),
// on the Advanced tab since #113. Mouse only (desktop layout), at 1200 and 1024 px. SHOTS=<dir> saves screenshots there.
import { expect, test, type Page } from "@playwright/test";

type XY = [number, number];

const BLANK = "/new/design?length=22&width=12&name=Figure%20of%20eight";
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

async function drag(page: Page, cells: XY[], start = true) {
  const path: XY[] = [];
  for (const [c, r] of cells) path.push(await cell(page, c, r));
  if (start) {
    await page.mouse.move(...path[0]);
    await page.mouse.down();
  }
  for (const p of path.slice(start ? 1 : 0)) await page.mouse.move(...p, { steps: 12 });
}

const hint = (page: Page) => page.locator(".designer-hint");
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
};

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "mouse only"));

for (const width of [1200, 1024]) {
  test(`${width} px: a figure of eight crosses straight over, closes, and Make it a crossover bridges it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto(BLANK);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector("rect.lay-hit");
    await expect(page.locator(".designer-palette")).toContainText("straight across it at right angles");

    // east along row 2, round the north-east lobe, down column 5 onto the crossing at [5, 2]
    await drag(page, [[0, 2], [8, 2], [8, 5], [5, 5], [5, 2]]);
    await expect(page.locator("path.lay-crossing")).toHaveCount(1);
    // turning on the crossing is refused
    await drag(page, [[4, 2]], false);
    await expect(hint(page)).toHaveText("The lane can only cross itself straight across, at right angles.");
    await shot(page, "1-refused");
    // straight on, round the south-west lobe
    await drag(page, [[5, 2], [5, 1]], false);
    await shot(page, "2-across");
    await drag(page, [[5, 0], [0, 0], [0, 2]], false);
    await page.mouse.up();

    // closed: six corners (none on the crossing), one unbridged crossing, in the checks on the Advanced tab (#113)
    await expect(page.locator("g.ed-corner")).toHaveCount(6);
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Advanced" }).click();
    const checks = page.locator(".designer-side .checks-panel:not(.venue-check)");
    await expect(checks).toContainText("crosses itself");
    await shot(page, "3-closed");

    // #91: while a bake is pending the old check is still listed; its button is disabled, "Checking…", never a dead tap
    await page.evaluate(() => {
      const w = window as unknown as { seen: string[] };
      w.seen = [];
      new MutationObserver(() => {
        for (const b of document.querySelectorAll<HTMLButtonElement>(".designer-side button.check-fix")) w.seen.push(`${b.disabled}|${b.title}`);
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await checks.getByRole("button", { name: "Make it a crossover" }).click();
    await expect(checks).not.toContainText("crosses itself");
    await expect(checks).not.toContainText("error");
    expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toContain("true|Checking…");
    await shot(page, "4-bridged");

    await page.locator(".designer-bar").getByRole("button", { name: "Undo" }).click();
    await expect(checks).toContainText("crosses itself");
    await expect(checks.getByRole("button", { name: "Make it a crossover" })).toBeEnabled();
  });
}

test("a crossing with nowhere to go straight on says so (#91)", async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("rect.lay-hit");
  // [1, 0] is straight through on the first pass; crossing it southwards would run off the grid
  await drag(page, [[0, 0], [2, 0], [2, 1], [1, 1], [1, 0]]);
  await page.mouse.up();
  await expect(hint(page)).toHaveText("A crossing needs the lane to carry straight on.");
  await shot(page, "5-dead-end");
});
