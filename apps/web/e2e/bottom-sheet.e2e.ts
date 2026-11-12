// The phone's bottom sheet (#121) on its demo page (/dev/sheet, development only), at 375 × 812 with touch: pull the
// grab bar from peek to full, pull it down to close, Close, tuck away and come back, the modal's scrim, the keyboard.
// SHOTS=<dir> saves the PR's pictures (peek, full, modal). Only Vite is needed.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Touch, type XY } from "./touch-helper";

const SHOTS = process.env.SHOTS;
test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone component"));

const panel = (page: Page) => page.getByRole("dialog", { name: "Corner 7" });
const height = (l: Locator) => l.evaluate((e) => Math.round(e.getBoundingClientRect().height));
/** the centre of the grab bar */
const grab = async (sheet: Locator): Promise<XY> => {
  const b = (await sheet.locator(".bottom-sheet-grab").boundingBox())!;
  return [b.x + b.width / 2, b.y + 12];
};
/** the heights have settled (the 200 ms height transition is over) */
const still = async (l: Locator) => {
  let last = -1;
  await expect.poll(async () => { const h = await height(l); const same = h === last; last = h; return same; }, { intervals: [250] }).toBe(true);
  return last;
};
const shot = async (page: Page, name: string) => SHOTS && (await page.waitForTimeout(300), await page.screenshot({ path: `${SHOTS}/${name}.png` }));

async function open(page: Page, button: "Peek" | "Full" | "Menu") {
  await page.goto("/dev/sheet");
  await page.getByRole("button", { name: button }).click();
}

test("pull the grab bar up: peek to full, scrolling inside, above the toolbar", async ({ page }) => {
  await open(page, "Peek");
  const sheet = panel(page);
  await expect(sheet).toHaveClass(/bottom-sheet--peek/);
  const peek = await still(sheet);
  expect(peek).toBeGreaterThan(200);
  expect(peek).toBeLessThanOrEqual(Math.ceil(812 / 3));
  // above the 64 px toolbar
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(812 - 64);
  await shot(page, "peek");

  const touch = await Touch.on(page);
  const [x, y] = await grab(sheet);
  await touch.drag([[x, y], [x, y - 200], [x, 120]]);
  await expect(sheet).toHaveClass(/bottom-sheet--full/);
  expect(await still(sheet)).toBe(812 - 64 - 72);
  // the content scrolls inside the sheet
  expect(await sheet.locator(".bottom-sheet-body").evaluate((b) => b.scrollHeight > b.clientHeight)).toBe(true);
  await shot(page, "full");
});

test("pull the grab bar down past peek: the sheet closes", async ({ page }) => {
  await open(page, "Peek");
  const sheet = panel(page);
  await still(sheet);
  const touch = await Touch.on(page);
  const [x, y] = await grab(sheet);
  await touch.drag([[x, y], [x, y + 120], [x, 780]]);
  await expect(sheet).toHaveCount(0);
});

test("a short pull down from full comes back to peek", async ({ page }) => {
  await open(page, "Full");
  const sheet = panel(page);
  await still(sheet);
  const touch = await Touch.on(page);
  const [x, y] = await grab(sheet);
  await touch.drag([[x, y], [x, y + 150], [x, y + 380]]);
  await expect(sheet).toHaveClass(/bottom-sheet--peek/);
});

test("the Close button closes it", async ({ page }) => {
  await open(page, "Peek");
  await still(panel(page));
  const close = panel(page).getByRole("button", { name: "Close" });
  const b = (await close.boundingBox())!;
  expect([Math.round(b.width), Math.round(b.height)]).toEqual([44, 44]);
  const touch = await Touch.on(page);
  await touch.tap([b.x + b.width / 2, b.y + b.height / 2]);
  await expect(panel(page)).toHaveCount(0);
});

test("tuck and restore: a finger on the plan tucks the sheet to its grab bar; lifted, it comes back at its height", async ({ page }) => {
  for (const which of ["Peek", "Full"] as const) {
    await open(page, which);
    const sheet = panel(page);
    const before = await still(sheet);
    const touch = await Touch.on(page);
    await touch.down([187, 40]);
    await touch.move([[187, 300]]);
    await expect(sheet).toHaveClass(/bottom-sheet--tucked/);
    expect(await still(sheet)).toBe(24);
    await touch.up();
    await expect(sheet).not.toHaveClass(/bottom-sheet--tucked/);
    await expect(sheet).toHaveClass(new RegExp(`bottom-sheet--${which.toLowerCase()}`));
    expect(await still(sheet)).toBe(before);
  }
});

test("the modal sheet: over a scrim that covers the toolbar; a tap on the scrim closes it", async ({ page }) => {
  await open(page, "Menu");
  const menu = page.getByRole("dialog", { name: "More" });
  await expect(menu).toHaveAttribute("aria-modal", "true");
  await still(menu);
  await shot(page, "modal");
  // the toolbar is under the scrim: a tap there lands on the scrim, not a tool
  const top = await page.evaluate(() => document.elementFromPoint(30, 800)?.className);
  expect(top).toBe("bottom-sheet-scrim");
  const touch = await Touch.on(page);
  await touch.tap([187, 60]);
  await expect(menu).toHaveCount(0);
});

test("keyboard: focus stays inside while full or modal, Escape closes", async ({ page }) => {
  await open(page, "Menu");
  const menu = page.getByRole("dialog", { name: "More" });
  await expect(menu).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await menu.evaluate((m) => m.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await menu.evaluate((m) => m.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // focus goes back to the button that opened it
  await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();

  await page.getByRole("button", { name: "Full" }).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeFocused();
  // the grab bar works from the keyboard too: Enter drops it to peek, where focus is free to leave
  await page.keyboard.press("Tab");
  await expect(panel(page).getByRole("button", { name: "Peek height" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toHaveClass(/bottom-sheet--peek/);
});

test("reduced motion: no slide, no height animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "Peek");
  expect(await panel(page).evaluate((e) => [getComputedStyle(e).animationName, getComputedStyle(e).transitionDuration])).toEqual(["none", "0s"]);
});
