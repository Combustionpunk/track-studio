// The 3D preview on a phone (#127), at 375 × 812 with touch: behind `?phone3d=1` (kept on the device) the toolbar has
// a seventh button, 3D, which reads 2D while the preview shows; the editing tools wait and open sheets close; one
// finger orbits and two pinch; back to 2D the edits made before are all there. three.js loads only when 3D is first
// opened. No WebGL, or a lost context: the 2D plan with a plain message. At 320 px the seven buttons fit.
// SHOTS=<dir> saves screenshots for the PR. The API is answered from the reference files, so only Vite is needed.
import { expect, test, type Page } from "@playwright/test";
import { corners, middleCorner, open, pinchIn, serve, shot, toolBtn, toolbar } from "./phone-helper.js";
import { Touch } from "./touch-helper.js";

const view3d = (page: Page) => page.locator(".plan3d");
const plan = (page: Page) => page.locator("svg.plan-svg");
const EDITING = ["Select", "Add point", "Jump", "Delete"];

/** move the corner nearest the middle of the plan: an edit to keep (its selection sheet opens) */
async function edit(page: Page, t: Touch) {
  await pinchIn(page, t);
  const { i, at } = await middleCorner(page);
  const before = await corners(page);
  await t.drag([at, [at[0] + 10, at[1] + 30], [at[0] + 20, at[1] + 60]], 6);
  await expect.poll(async () => (await corners(page))[i]).not.toEqual(before[i]);
  return { i, moved: (await corners(page))[i] };
}

async function show3d(page: Page) {
  await toolBtn(page, "3D").tap();
  await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
}

/** where the 3D camera is */
const camera = (page: Page) => view3d(page).getAttribute("data-camera");

test.describe("phone: the 3D preview", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("no switch: six buttons and no 3D", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await expect(toolbar(page).getByRole("button")).toHaveCount(6);
    await expect(toolBtn(page, "3D")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("3D opens, reads 2D, the tools wait, sheets close; orbit and pinch move the camera; back to 2D the edit is there", async ({ page }) => {
    const errors = await serve(page);
    // three.js and the viewer: not asked for until 3D is opened
    const asked: string[] = [];
    page.on("request", (r) => /viewer3d\/Viewer3D|\/deps\/three/.test(r.url()) && asked.push(r.url()));
    await open(page, "?phone3d=1");
    const t = await Touch.on(page);
    await expect(toolbar(page).getByRole("button")).toHaveCount(7);
    await expect(toolbar(page).getByRole("button").last()).toHaveText("3D");
    await shot(page, "1-toolbar-3d");

    const { i, moved } = await edit(page, t);
    // the edit opened the corner's sheet
    await expect(page.locator("section.bottom-sheet")).toHaveCount(1);
    expect(asked).toEqual([]);

    await show3d(page);
    expect(asked.length).toBeGreaterThan(0);
    await expect(plan(page)).toHaveCount(0);
    await expect(toolBtn(page, "2D")).toBeVisible();
    for (const l of EDITING) await expect(toolBtn(page, l), l).toBeDisabled();
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    await expect(page.locator("section.bottom-sheet")).toHaveCount(0);
    await expect(page.locator(".designer-hint")).toContainText("3D is view only");
    // the figure for the Board: tap to first frame
    await expect(page.locator(".phone-3d-figures")).toContainText(/First frame \d+ ms/);

    // one finger orbits
    const box = (await view3d(page).boundingBox())!;
    const c: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
    let was = await camera(page);
    await t.drag([c, [c[0] + 60, c[1] + 20], [c[0] + 120, c[1] + 30]], 8);
    await expect.poll(() => camera(page)).not.toBe(was);
    await expect(page.locator(".phone-3d-figures")).toContainText(/Orbit \d+ fps, slowest frame \d+ ms/);
    // two fingers pinch in
    was = await camera(page);
    await t.down([c[0] - 30, c[1]], [c[0] + 30, c[1]]);
    await t.move([[c[0] - 110, c[1]], [c[0] + 110, c[1]]], 8);
    await t.up();
    await expect.poll(() => camera(page)).not.toBe(was);
    await shot(page, "2-preview-3d");

    await toolBtn(page, "2D").tap();
    await expect(plan(page)).toBeVisible();
    await expect(view3d(page)).toHaveCount(0);
    await expect(toolBtn(page, "3D")).toBeVisible();
    for (const l of ["Select", "Add point", "Jump"]) await expect(toolBtn(page, l), l).toBeEnabled();
    // the draft is as it was: the corner where it was moved to, and undo takes it back
    expect((await corners(page))[i]).toEqual(moved);
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    await toolBtn(page, "Undo").tap();
    await expect.poll(async () => (await corners(page))[i]).not.toEqual(moved);
    expect(errors).toEqual([]);
  });

  test("the switch stays on for this device, and ?phone3d=0 turns it off", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "?phone3d=1");
    await expect(toolBtn(page, "3D")).toBeVisible();
    await page.goto(page.url().replace("?phone3d=1", ""));
    await expect(toolBtn(page, "3D")).toBeVisible();
    await page.goto(page.url() + "?phone3d=0");
    await expect(plan(page)).toBeVisible();
    await expect(toolBtn(page, "3D")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("no WebGL: the 2D plan stays, with a plain message, and still edits", async ({ page }) => {
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return /webgl/.test(type) ? null : (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof get;
    });
    const errors = await serve(page);
    await open(page, "?phone3d=1");
    const t = await Touch.on(page);
    await toolBtn(page, "3D").tap();
    await expect(page.getByRole("alert")).toHaveText("The 3D view needs WebGL, which this browser doesn't have or has turned off. Here's the 2D plan.");
    await expect(plan(page)).toBeVisible();
    await expect(view3d(page)).toHaveCount(0);
    for (const l of ["Select", "Add point", "Jump"]) await expect(toolBtn(page, l), l).toBeEnabled();
    await shot(page, "3-no-webgl");
    // it edits
    await edit(page, t);
    // the button puts the message away
    await toolBtn(page, "2D").tap();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(toolBtn(page, "3D")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a lost context (the tab sent to the background): back to a working 2D plan, edits kept; 3D tries again", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "?phone3d=1");
    const t = await Touch.on(page);
    const { i, moved } = await edit(page, t);
    await show3d(page);
    await view3d(page).locator("canvas").evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext("webgl2") ?? c.getContext("webgl");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await expect(page.getByRole("alert")).toContainText("lost its graphics");
    await expect(plan(page)).toBeVisible();
    expect((await corners(page))[i]).toEqual(moved);
    for (const l of ["Select", "Add point", "Jump"]) await expect(toolBtn(page, l), l).toBeEnabled();
    await expect(toolBtn(page, "3D")).toBeVisible();
    await show3d(page);
    await expect(plan(page)).toHaveCount(0);
    await toolBtn(page, "2D").tap();
    await expect(plan(page)).toBeVisible();
    expect((await corners(page))[i]).toEqual(moved);
    expect(errors).toEqual([]);
  });

  test("in and out of 3D a few times: each view gives its context back", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await serve(page);
    await open(page, "?phone3d=1");
    for (let n = 0; n < 5; n++) {
      await show3d(page);
      const canvas = (await view3d(page).locator("canvas").elementHandle())!;
      await toolBtn(page, "2D").tap();
      await expect(plan(page)).toBeVisible();
      expect(await canvas.evaluate((c: HTMLCanvasElement) => (c.getContext("webgl2") ?? c.getContext("webgl"))?.isContextLost())).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test("320 px: the seven buttons fit, 44 px each, nothing overflows", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const errors = await serve(page);
    await open(page, "?phone3d=1");
    const bar = toolbar(page);
    await expect(bar.getByRole("button")).toHaveCount(7);
    const { scroll, client } = await bar.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(scroll).toBeLessThanOrEqual(client);
    const rects = await bar.getByRole("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, width: r.width, height: r.height })));
    for (const r of rects) {
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await shot(page, "4-toolbar-320");
    expect(errors).toEqual([]);
  });
});
