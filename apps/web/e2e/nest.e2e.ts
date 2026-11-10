// Nested corners (#106): Yeti's L loop at Niagara (22 × 12 m). Sweeper on the elbow's outer corner shapes the inner
// lane's corner with it, the panel says so, the plan has no problems; the inner corner's panel has the Outside corner
// control in Quick mode, an override offers Match. With the mouse at 1200 px and by touch on a tablet. SHOTS=<dir>
// saves screenshots there.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cell, onAdvanced, screen, Touch, type XY } from "./touch-helper.js";

const BLANK = "/new/design?length=22&width=12&name=L%20loop";
/** two lanes along the south wall and two up the east wall, clockwise from the north-east: corner 2 is the elbow's
 * outer corner (90° right), corner 5 the inner lane's corner round the same pipe */
const L_LOOP: XY[] = [[10, 5], [10, 0], [0, 0], [0, 1], [9, 1], [9, 5], [10, 5]];
const SHOTS = process.env.SHOTS;

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
};

async function open(page: Page) {
  await page.goto(BLANK);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("rect.lay-hit");
  await page.waitForTimeout(200);
}

/** the dot of corner n (1-based, as the plan numbers them) */
const dot = (page: Page, n: number) => page.locator("g.ed-corner").filter({ has: page.locator("text", { hasText: new RegExp(`^${n}$`) }) });

const checks = (page: Page) => page.locator(".checks-panel");
/** wait on the checks, which are on the Advanced tab (#113), from Quick */
const quickChecks = (page: Page, text: string | RegExp) => onAdvanced(page, (c) => expect(c).toContainText(text, { timeout: 15_000 }));

/** the outside-corner radio that's checked, in `panel` */
const checkedOuter = (panel: Locator) => panel.getByRole("radiogroup", { name: "Outside corner" }).locator('[role="radio"][aria-checked="true"]');

test.describe("mouse, 1200 px", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "mouse only"));

  test("Sweeper on corner 2 shapes corner 5 with it; Quick mode sets the outside corner; an override offers Match", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    const path: XY[] = [];
    for (const [c, r] of L_LOOP) path.push(await cell(page, c, r));
    await page.mouse.move(...path[0]);
    await page.mouse.down();
    for (const p of path.slice(1)) await page.mouse.move(...p, { steps: 7 });
    await page.mouse.up();
    await expect(page.locator("g.ed-corner")).toHaveCount(6);
    await quickChecks(page, "No problems found.");

    // corner 2: the panel says what else it shapes, and corner 5 highlights
    await dot(page, 2).click();
    const panel = page.locator("section.sel-panel");
    await expect(panel.getByRole("heading", { name: "Corner 2" })).toBeVisible();
    await expect(panel).toContainText("90° right");
    await expect(panel).toContainText("Also shapes corner 5 (inside)");
    await expect(dot(page, 5)).toHaveClass(/linked/);
    await expect(dot(page, 3)).not.toHaveClass(/linked/);
    await panel.getByRole("button", { name: /^Sweeper/ }).click();
    await expect(panel.getByRole("button", { name: /^Sweeper/ })).toHaveAttribute("aria-pressed", "true");
    await quickChecks(page, "No problems found.");
    await shot(page, "1-sweeper-corner-2");

    // corner 5 followed: a 2.0 m apex, round, and its panel has the outside-corner control
    await dot(page, 5).click();
    await expect(panel.getByRole("heading", { name: "Corner 5" })).toBeVisible();
    await expect(panel).toContainText("Follows corner 2 (outside)");
    await expect(panel.getByLabel("Apex radius")).toHaveValue("2");
    await expect(checkedOuter(panel)).toHaveText("Round");
    await expect(dot(page, 2)).toHaveClass(/linked/);
    await shot(page, "2-corner-5-follows");

    // shaped on its own: Square is kept, the panel offers Match, and Match re-links it
    await panel.getByRole("radio", { name: "Square" }).click();
    await expect(checkedOuter(panel)).toHaveText("Square");
    await expect(panel).toContainText("Shaped on its own.");
    const match = panel.getByRole("button", { name: "Match corner 2" });
    await expect(match).toBeVisible();
    await onAdvanced(page, (c) => expect(c).not.toContainText("Checking", { timeout: 15_000 }));
    await shot(page, "3-corner-5-override");
    await match.click();
    await expect(panel).toContainText("Follows corner 2 (outside)");
    await expect(checkedOuter(panel)).toHaveText("Round");
    await expect(panel.getByLabel("Apex radius")).toHaveValue("2");
    await quickChecks(page, "No problems found.");

    // Medium on corner 5 by hand (Yeti's step 3) is kept and reported honestly; one undo takes it back
    await panel.getByRole("button", { name: /^Medium/ }).click();
    await expect(panel).toContainText("Shaped on its own.");
    await quickChecks(page, /Lanes overlap by|Lane narrows by/);
    await page.keyboard.press("Control+z");
    await expect(panel.getByLabel("Apex radius")).toHaveValue("2");
    await expect(panel).toContainText("Follows corner 2 (outside)");

    // the follow is part of the same undo step as the Sweeper: undoing it puts both corners back
    await dot(page, 2).click();
    await panel.getByRole("button", { name: /^Hairpin/ }).click();
    await dot(page, 5).click();
    await expect(panel.getByLabel("Apex radius")).toHaveValue("0");
    await expect(checkedOuter(panel)).toHaveText(/^Auto/);
    await page.keyboard.press("Control+z");
    await expect(panel.getByLabel("Apex radius")).toHaveValue("2");
    await expect(checkedOuter(panel)).toHaveText("Round");

    // Advanced mode: the Radius field follows the same rule (r_in = r_out − 2 m)
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Advanced" }).click();
    await page.locator('circle.ed-point[data-index="1"]').click();
    await expect(panel.getByRole("heading", { name: "Corner point 2" })).toBeVisible();
    await expect(panel).toContainText("Also shapes corner 5 (inside)");
    await panel.getByLabel("Radius").fill("4.5");
    await page.locator('circle.ed-point[data-index="4"]').click();
    await expect(panel.getByRole("heading", { name: "Corner point 5" })).toBeVisible();
    await expect(panel.getByLabel("Radius")).toHaveValue("2.5");
    await expect(checkedOuter(panel)).toHaveText("Round");
    await expect(panel).toContainText("Follows corner 2 (outside)");
    await expect(checks(page)).toContainText("No problems found.", { timeout: 15_000 });
  });
});

test.describe("tablet touch", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "tablet-landscape", "landscape tablet"));

  test("Sweeper on corner 2 by touch shapes corner 5; its sheet has the outside corner", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    const path: XY[] = [];
    for (const [c, r] of L_LOOP) path.push(await cell(page, c, r));
    await t.drag(path, 10);
    await expect(page.locator("g.ed-corner")).toHaveCount(6);
    const pill = page.locator(".checks-pill");
    await expect(pill).toHaveText(/No problems/, { timeout: 15_000 });
    const dots = await page.locator("g.ed-corner .ed-corner-dot").evaluateAll((els) => els.map((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!] as XY));

    const hold = async (n: number) => {
      await t.hold(await screen(page, ...dots[n - 1]), 700);
      await t.up();
    };
    const sheet = page.locator(".designer-sheet");
    await hold(2);
    await expect(sheet.getByRole("heading", { name: "Corner 2" })).toBeVisible();
    await expect(sheet).toContainText("Also shapes corner 5 (inside)");
    await expect(dot(page, 5)).toHaveClass(/linked/);
    await sheet.getByRole("button", { name: /^Sweeper/ }).tap();
    await expect(sheet.getByRole("button", { name: /^Sweeper/ })).toHaveAttribute("aria-pressed", "true");
    await expect(pill).toHaveText(/No problems/, { timeout: 15_000 });
    await shot(page, "4-touch-sweeper");

    // the sheet covers the south of the plan, where corner 5 is: close it first
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toHaveCount(0);
    await hold(5);
    await expect(sheet.getByRole("heading", { name: "Corner 5" })).toBeVisible();
    await expect(sheet).toContainText("Follows corner 2 (outside)");
    await expect(sheet.getByLabel("Apex radius")).toHaveValue("2");
    const outer = sheet.getByRole("radiogroup", { name: "Outside corner" });
    await expect(outer).toBeVisible();
    await expect(checkedOuter(sheet)).toHaveText("Round");
    for (const name of ["Auto", "Square", "Round"]) {
      const b = (await outer.getByRole("radio", { name: new RegExp(`^${name}`) }).boundingBox())!;
      expect(b.height, name).toBeGreaterThanOrEqual(44);
    }
    await outer.getByRole("radio", { name: "Square" }).tap();
    await expect(checkedOuter(sheet)).toHaveText("Square");
    await expect(sheet).toContainText("Shaped on its own.");
    expect((await sheet.getByRole("button", { name: "Match corner 2" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(pill).not.toHaveText(/Checking/, { timeout: 15_000 });
    await shot(page, "5-touch-override");
    await sheet.getByRole("button", { name: "Match corner 2" }).tap();
    await expect(checkedOuter(sheet)).toHaveText("Round");
    await expect(sheet).toContainText("Follows corner 2 (outside)");
  });
});
