// The Start line button shows where the start line is (#177): it centres and zooms the plan on it, and puts the plan
// back as it was once the start line is let go. A trip to 3D or a change of mode doesn't carry the zoom along.
// The laptop (mouse, 1200 px) and the phone (375 px, touch).
import { expect, test, type Page } from "@playwright/test";
import { open, serve, toolBtn, viewBox } from "./phone-helper.js";

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse" && info.project.name !== "phone", "the laptop and the phone"));

/** the Start line button: the palette's on the laptop, the Jump sheet's chip on the phone */
async function pickStart(page: Page) {
  if (isPhone(page)) {
    await toolBtn(page, "Jump").tap();
    await page.getByRole("dialog", { name: "Jumps" }).getByRole("button", { name: "Start line" }).tap();
    await expect(page.getByRole("dialog", { name: "Start line" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Start line", exact: true }).click();
  }
  await expect(page.locator(".plan-highlight")).toHaveCount(1);
}

/** let the start line go: Escape on the laptop, its sheet's Close on the phone */
async function letGo(page: Page) {
  if (isPhone(page)) await page.getByRole("dialog", { name: "Start line" }).getByRole("button", { name: "Close" }).tap();
  else await page.keyboard.press("Escape");
  await expect(page.locator(".plan-highlight")).toHaveCount(0);
}

/** the plan is at its fitted view: fitting it again changes nothing */
async function expectFitted(page: Page) {
  await expect(page.locator(".plan-highlight")).toHaveCount(0);
  const now = await viewBox(page);
  if (isPhone(page)) {
    await page.getByRole("button", { name: "More" }).tap();
    await page.getByRole("menuitem", { name: "Zoom to fit" }).tap();
  } else {
    await page.getByRole("button", { name: "Fit to view" }).click();
  }
  await expect.poll(() => viewBox(page)).toEqual(now);
}

async function toMode(page: Page, mode: "Quick" | "Advanced") {
  if (isPhone(page)) {
    await page.getByRole("button", { name: "More" }).tap();
    await page.getByRole("menuitemradio", { name: mode }).tap();
    // the menu stays open on a mode change on some layouts: put it away
    if (await page.getByRole("menu").count()) await page.keyboard.press("Escape");
  } else {
    await page.locator(".mode-toggle").getByRole("button", { name: mode }).click();
  }
  await expect(page.locator(`.designer-${mode.toLowerCase()}`)).toBeVisible();
}

async function switchTo(page: Page, k: "2D" | "3D") {
  if (isPhone(page)) await toolBtn(page, k === "3D" ? "3D" : "2D").tap();
  else await page.locator(".designer-viewswitch").getByRole("button", { name: k, exact: true }).click();
  if (k === "3D") await expect(page.locator(".plan3d")).toBeVisible();
  else await expect(page.locator("svg.plan-svg")).toBeVisible();
}

test("Start line zooms in on it; letting it go puts the plan back at the zoom it had", async ({ page }) => {
  const errors = await serve(page);
  await open(page);
  const before = await viewBox(page);
  await pickStart(page);
  // it shows where the start line is: closer in
  await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(before[2]);
  await letGo(page);
  await expect.poll(() => viewBox(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("a zoom of the member's own is put back too, after the start line is let go", async ({ page }) => {
  test.skip(isPhone(page), "the laptop's zoom buttons");
  const errors = await serve(page);
  await open(page);
  await page.getByRole("button", { name: "Zoom out" }).click();
  const before = await viewBox(page);
  await pickStart(page);
  await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(before[2]);
  await letGo(page);
  await expect.poll(() => viewBox(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("a mode change doesn't leave the plan zoomed on the start line", async ({ page }) => {
  const errors = await serve(page);
  await open(page);
  await pickStart(page);
  await toMode(page, "Advanced");
  await expectFitted(page);
  await toMode(page, "Quick");
  await expectFitted(page);
  expect(errors).toEqual([]);
});

test("a trip to 3D doesn't leave the plan zoomed on the start line", async ({ page }) => {
  const errors = await serve(page);
  await open(page, isPhone(page) ? "?phone3d=1" : "");
  await pickStart(page);
  await switchTo(page, "3D");
  await switchTo(page, "2D");
  await expectFitted(page);
  expect(errors).toEqual([]);
});
