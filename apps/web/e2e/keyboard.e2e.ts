// Quick mode step 1 from the keyboard (#47): Tab to the lane grid, then lay a loop, a figure of eight (a crossing,
// #79) and an octagon (diagonal runs, #82) with the keys alone, with a visible cursor and focus ring and a live region
// that announces each step and each refusal. Keyboard only (desktop layout), at 1200 px. SHOTS=<dir> saves screenshots.
import { expect, test, type Page } from "@playwright/test";
import { onAdvanced } from "./touch-helper.js";

const BLANK = "/new/design?length=22&width=12&name=Keys";
const SHOTS = process.env.SHOTS;

const live = (page: Page) => page.locator(".designer-plan-wrap [role=status]");
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
};

async function open(page: Page) {
  await page.goto(BLANK);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("rect.lay-hit");
}

/** Tab until the lane grid has focus: it's reachable with the keyboard alone */
async function tabToGrid(page: Page) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Lane grid")) return;
  }
  throw new Error("the lane grid never got focus");
}

async function keys(page: Page, ...ks: string[]) {
  for (const k of ks) await page.keyboard.press(k);
}
const times = (k: string, n: number) => Array<string>(n).fill(k);

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "keyboard on the desktop layout"));

test("a loop from the keyboard alone: focus ring, cursor, announcements, Backspace and a refusal", async ({ page }) => {
  await open(page);
  await tabToGrid(page);
  // focus is visible: the plan gets the focus ring and the cursor square is drawn
  await expect(page.locator(".designer-plan .plan-svg")).toHaveCSS("outline-style", "solid");
  await expect(page.locator("rect.lay-cursor")).toHaveCount(1);
  await expect(page.locator(".designer-hint")).toContainText("Cursor on column 1, row 1");
  await shot(page, "1-focus");

  await keys(page, "ArrowUp");
  await expect(live(page)).toHaveText("column 1, row 2.");
  await keys(page, "Enter");
  await expect(live(page)).toContainText("Square 1 of 4 minimum");
  await keys(page, "ArrowRight", "ArrowRight");
  await expect(live(page)).toHaveText("Square 3 of 4 minimum, heading east.");
  await keys(page, "Backspace");
  await expect(live(page)).toContainText("Took back square 3.");
  await expect(page.locator("rect.lay-cell")).toHaveCount(2);
  await keys(page, "ArrowRight", "ArrowDown", "ArrowDown");
  await expect(live(page)).toHaveText("That's the edge of the track area."); // the refusal is announced too
  await expect(page.locator(".designer-hint")).toHaveText("That's the edge of the track area.");
  await shot(page, "2-refused");
  // Ctrl+Z still undoes from the grid
  await page.keyboard.press("Control+z");
  await expect(page.locator("rect.lay-cell")).toHaveCount(3);
  await keys(page, "ArrowDown", "ArrowLeft", "ArrowLeft");
  await expect(live(page)).toContainText("The first square is 1 north.");
  await keys(page, "ArrowUp");
  await expect(live(page)).toHaveText("Loop closed with 6 squares. On to step 2, shape it.");
  await expect(page.locator("g.ed-corner")).toHaveCount(4);
  // focus went on to the plan, not lost
  await expect(page.locator(".designer-plan .plan-svg")).toBeFocused();
});

test("a figure of eight (a crossing) and an octagon (diagonal runs) from the keyboard alone", async ({ page }) => {
  await open(page);
  await tabToGrid(page);
  await keys(page, "ArrowUp", "ArrowUp", "Enter", ...times("ArrowRight", 8), ...times("ArrowUp", 3), ...times("ArrowLeft", 3), ...times("ArrowDown", 3));
  await expect(live(page)).toContainText("heading south, crossing the lane");
  await keys(page, "ArrowLeft");
  await expect(live(page)).toHaveText("The lane can only cross itself straight across, at right angles.");
  await shot(page, "3-crossing");
  await keys(page, ...times("ArrowDown", 2), ...times("ArrowLeft", 5), ...times("ArrowUp", 2));
  await expect(live(page)).toContainText("Loop closed");
  await expect(page.locator("g.ed-corner")).toHaveCount(6);

  await open(page);
  await tabToGrid(page);
  const NE = ["Shift+ArrowUp", "Shift+ArrowRight"], NW = ["Shift+ArrowUp", "Shift+ArrowLeft"];
  const SW = ["Shift+ArrowDown", "Shift+ArrowLeft"], SE = ["Shift+ArrowDown", "Shift+ArrowRight"];
  await keys(page, "ArrowRight", "ArrowRight", "Enter", ...times("ArrowRight", 6), "Shift+ArrowUp");
  await expect(live(page)).toHaveText("Diagonal: north, then east or west.");
  await keys(page, "Shift+ArrowRight");
  await expect(live(page)).toContainText("heading north-east");
  await shot(page, "4-diagonal");
  await keys(page, ...NE, "ArrowUp", ...NW, ...NW, ...times("ArrowLeft", 6), ...SW, ...SW, "ArrowDown", ...SE, ...SE);
  await expect(live(page)).toContainText("Loop closed");
  await expect(page.locator("g.ed-corner")).toHaveCount(8);
  await onAdvanced(page, (checks) => expect(checks).toContainText("No problems found.", { timeout: 15_000 }));
  await shot(page, "5-octagon");
});

test("undo, redo and Start again from the grid are announced, and drop a half-made diagonal", async ({ page }) => {
  await open(page);
  await tabToGrid(page);
  await keys(page, "Enter", "ArrowRight", "ArrowRight", "Shift+ArrowUp");
  await expect(live(page)).toHaveText("Diagonal: north, then east or west.");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Undone. Square 2 of 4 minimum, heading east.");
  await expect(page.locator(".designer-hint")).toHaveText("Undone. Square 2 of 4 minimum, heading east.");
  // the diagonal went with the undo: Shift+Right is the first arrow of a new one, not north-east
  await keys(page, "Shift+ArrowRight");
  await expect(live(page)).toHaveText("Diagonal: east, then north or south.");
  await expect(page.locator("rect.lay-cell")).toHaveCount(2);
  await page.keyboard.press("Control+Shift+z");
  await expect(live(page)).toHaveText("Redone. Square 3 of 4 minimum, heading east.");
  await page.getByRole("button", { name: "Start again" }).click();
  await expect(live(page)).toHaveText("The lane is taken up. No lane yet. Enter or Space starts it on the cursor square.");
  await expect(page.locator("rect.lay-cell")).toHaveCount(0);
});
