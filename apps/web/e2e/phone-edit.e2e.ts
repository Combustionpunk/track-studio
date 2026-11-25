// The phone designer (#122): at 375 × 812 with touch (the default under 640 px since #124), a header, the plan and a
// toolbar; tap selects, a drag moves a corner, two fingers pinch and pan and change nothing, Add point adds, Delete
// deletes, Undo brings it back; on its side the phone says to turn it upright, and turning back loses nothing. Tablets
// and the laptop are unchanged; a narrow laptop window gets the phone layout and zooms with the wheel.
// SHOTS=<dir> saves screenshots for the PR. The API is answered from the reference files, so only Vite is needed.
import { expect, test } from "@playwright/test";
import { cornerRef, corners, doc, emptyFloor, middleCorner, open, pinchIn, planBox, serve, sheetClearOf, shot, toolBtn, toolbar, upperCorner, viewBox } from "./phone-helper.js";
import { Touch } from "./touch-helper.js";

test.describe("phone", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("the shared top bar, then the header, plan and toolbar fill the screen; 44 px targets; no zoom buttons", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const ed = page.locator(".designer-phone-edit");
    await expect(ed).toBeVisible();
    // the shared RC Misfits bar on top (#149); Track Studio's own pages aren't shown here (the header has Back)
    await expect(page.locator(".ts-appnav")).toBeHidden();
    const site = (await page.locator("rm-header").boundingBox())!;
    expect(site.y).toBe(0);
    // the brand's bar: 56 px, and 57 on a phone, where the site name goes under RC MISFITS
    expect(site.height).toBeLessThanOrEqual(57);
    const vp = page.viewportSize()!;
    const header = (await page.locator(".phone-header").boundingBox())!;
    expect(header.y).toBe(site.height);
    expect(header.height).toBe(52);
    const bar = (await toolbar(page).boundingBox())!;
    expect(bar.height).toBe(64);
    expect(bar.y + bar.height).toBe(vp.height);
    const plan = await planBox(page);
    expect(plan.y).toBeGreaterThanOrEqual(site.height + 52);
    expect(plan.y + plan.height).toBeLessThanOrEqual(bar.y + 1);
    expect(plan.height).toBeGreaterThan(vp.height - site.height - 52 - 64 - 2);
    expect(plan.width).toBe(vp.width);
    await expect(page.locator(".phone-header")).toContainText(doc.info.name);
    await expect(page.locator(".phone-save")).toHaveText("Saved");
    for (const name of ["Select", "Add point", "Jump", "Delete", "Undo", "Redo"]) {
      const b = (await toolBtn(page, name).boundingBox())!;
      expect(b.width, name).toBeGreaterThanOrEqual(44);
      expect(b.height, name).toBeGreaterThanOrEqual(44);
      // its label shows, whole, inside it
      const l = (await toolBtn(page, name).locator(".phone-tool-label").boundingBox())!;
      expect(l.width, name).toBeGreaterThan(10);
      expect(l.x, name).toBeGreaterThanOrEqual(b.x);
      expect(l.x + l.width, name).toBeLessThanOrEqual(b.x + b.width);
    }
    for (const el of await page.locator(".phone-header").locator("a, button").all()) {
      const b = (await el.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator(".designer-hint")).toContainText("Pinch to zoom in");
    await expect(page.locator(".plan-scale")).toBeVisible();
    await expect(page.locator(".plan-controls")).toHaveCount(0);
    await expect(page.locator(".designer-viewswitch")).toHaveCount(0);
    await expect(toolBtn(page, "Jump")).toBeEnabled(); // its sheet came with #123
    await expect(toolBtn(page, "Delete")).toBeDisabled();
    // the plan takes every gesture; the page doesn't scroll
    // (touch-action is not inherited, but a touch is handled by the intersection up the tree: none on the layout is none
    // on the header and the toolbar too)
    for (const s of [".plan", ".designer-phone-edit"]) expect(await page.locator(s).first().evaluate((e) => getComputedStyle(e).touchAction), s).toBe("none");
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([vp.width, vp.height]);
    await shot(page, "375-plan");
    expect(errors).toEqual([]);
  });

  test("tap selects a corner, a drag moves it, Delete removes it, Undo brings it back", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const before = await corners(page);
    const { i, at } = await upperCorner(page);

    // tap: selected, Delete on
    await t.tap(at);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1);
    await expect(toolBtn(page, "Delete")).toBeEnabled();
    expect(await corners(page)).toEqual(before);
    await shot(page, "375-selected");
    // its sheet has slid in, and it leaves the corner and the drag's path clear
    await sheetClearOf(page, at, 60);

    // drag past the slop: the corner moves, the others stay
    await t.drag([at, [at[0] + 10, at[1] + 30], [at[0] + 20, at[1] + 60]], 6);
    await expect.poll(async () => (await corners(page))[i]).not.toEqual(before[i]);
    const moved = await corners(page);
    expect(moved.filter((_, k) => k !== i)).toEqual(before.filter((_, k) => k !== i));
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    await expect(page.locator(".phone-save")).toHaveText("Save"); // the Save button (#124)

    // Delete: one corner fewer
    await toolBtn(page, "Delete").tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(before.length - 1);
    await expect(toolBtn(page, "Delete")).toBeDisabled();
    // Undo: back, where it was dragged to
    await toolBtn(page, "Undo").tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(before.length);
    expect(await corners(page)).toEqual(moved);
    // Undo again: the drag is taken back; Redo does it again
    await toolBtn(page, "Undo").tap();
    await expect.poll(() => corners(page)).toEqual(before);
    await toolBtn(page, "Redo").tap();
    await expect.poll(() => corners(page)).toEqual(moved);
    expect(errors).toEqual([]);
  });

  test("pinch zooms; two fingers pan, and paint, select and move nothing", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    const before = await corners(page);
    const vb0 = await viewBox(page);
    await pinchIn(page, t);
    const vb1 = await viewBox(page);
    expect(vb1[2]).toBeLessThan(vb0[2] * 0.6); // zoomed in
    // two fingers, one of them on a corner: the plan pans, the corner stays
    const { at } = await middleCorner(page);
    await t.down(at, [at[0] + 80, at[1] + 20]);
    await t.move([[at[0] + 60, at[1] + 90], [at[0] + 140, at[1] + 110]], 8);
    await t.up();
    const vb2 = await viewBox(page);
    expect(vb2[2]).toBeCloseTo(vb1[2], 1); // the same zoom
    expect(Math.hypot(vb2[0] - vb1[0], vb2[1] - vb1[1])).toBeGreaterThan(0.5); // moved over
    expect(await corners(page)).toEqual(before);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(0);
    await expect(toolBtn(page, "Undo")).toBeDisabled();
    // one finger on empty floor pans too
    const floor = await emptyFloor(page);
    await t.drag([floor, [floor[0] - 60, floor[1] - 40]], 6);
    const vb3 = await viewBox(page);
    expect(Math.hypot(vb3[0] - vb2[0], vb3[1] - vb2[1])).toBeGreaterThan(0.5);
    expect(await corners(page)).toEqual(before);
    await expect(toolBtn(page, "Undo")).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("Add point, then a tap on the floor adds one corner after the selected one; Select turns it off", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    const n = (await corners(page)).length;
    // without the tool, a tap on the floor adds nothing
    const floor = await emptyFloor(page);
    await t.tap(floor);
    await page.waitForTimeout(150);
    await expect(page.locator("g.ed-corner")).toHaveCount(n);
    // a corner selected: the next one goes after it, wherever on the floor it's tapped
    const { i, at } = await middleCorner(page);
    await t.tap(at);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1);
    await toolBtn(page, "Add point").tap();
    await expect(toolBtn(page, "Add point")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".designer-hint")).toContainText(`after ${await cornerRef(page, i)}.`);
    await expect(toolBtn(page, "Select")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".designer-hint")).toContainText("Tap the floor");
    await t.tap(floor);
    await expect(page.locator("g.ed-corner")).toHaveCount(n + 1);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1); // the new one, selected
    await expect(page.locator(".designer-hint")).toContainText(`after ${await cornerRef(page, i + 1)}.`);
    await toolBtn(page, "Select").tap();
    await expect(toolBtn(page, "Add point")).toHaveAttribute("aria-pressed", "false");
    await expect(toolBtn(page, "Select")).toHaveAttribute("aria-pressed", "true");
    await toolBtn(page, "Undo").tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(n);
    expect(errors).toEqual([]);
  });

  test("on its side it says to turn upright; turned back, nothing is lost", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const { at } = await middleCorner(page);
    await t.tap(at);
    await toolBtn(page, "Delete").tap();
    const after = await corners(page);
    await page.setViewportSize({ width: 812, height: 375 });
    const msg = page.getByRole("alert").filter({ hasText: "Turn your phone upright to edit" });
    await expect(msg).toBeVisible();
    const box = (await msg.boundingBox())!;
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 812, 375]);
    await shot(page, "812-landscape");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(msg).toHaveCount(0);
    await expect(toolbar(page)).toBeVisible();
    expect(await corners(page)).toEqual(after);
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    await expect(page.locator(".phone-save")).toHaveText("Save"); // the Save button (#124)
    expect(errors).toEqual([]);
  });

  test("320 px: nothing overflows, every tool stays 44 px and on the screen", async ({ page }) => {
    await serve(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    await expect(page.locator(".designer-phone-edit")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    for (const b of await toolbar(page).getByRole("button").all()) {
      const box = (await b.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    // the labels go (as the plan says for 320 px phones), and stay the buttons' names
    for (const l of await toolbar(page).locator(".phone-tool-label").all()) expect((await l.boundingBox())!.width).toBeLessThanOrEqual(1);
    for (const name of ["Select", "Add point", "Jump", "Delete", "Undo", "Redo"]) await expect(toolBtn(page, name)).toHaveCount(1);
    const more = (await page.getByRole("button", { name: "More" }).boundingBox())!;
    expect(more.x + more.width).toBeLessThanOrEqual(320);
  });

  test("the phone layout is the default: no switch, no view-only screen (#124)", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "");
    await expect(page.locator(".designer-phone-edit")).toBeVisible();
    await expect(page.getByText("Design on a laptop or tablet")).toHaveCount(0);
    await expect(page.locator(".ts-appnav")).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe("tablets: unchanged by the phone layout", () => {
  test.beforeEach(({}, info) => test.skip(!info.project.name.startsWith("tablet"), "tablets"));
  test("the tablet layout", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await expect(page.locator(".designer")).toHaveClass(/designer-touch/);
    await expect(page.locator(".designer-dock")).toBeVisible();
    await expect(page.locator(".ts-site-header rm-header")).toBeVisible();
    await expect(page.locator(".ts-appnav")).toBeHidden(); // the editors give Track Studio's own row to the plan (#149)
    await expect(page.locator(".designer-phone-edit, .phone-upright")).toHaveCount(0);
    await shot(page, `${page.viewportSize()!.width}-tablet`);
    expect(errors).toEqual([]);
  });
});

test.describe("a laptop", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "the mouse"));
  test("at 1200 px the laptop layout", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await expect(page.locator(".designer-palette")).toBeVisible();
    await expect(page.locator(".designer-phone-edit, .phone-upright")).toHaveCount(0);
    await shot(page, "1200-laptop");
    expect(errors).toEqual([]);
  });

  test("a window under 640 px gets the phone layout: the wheel zooms, a drag pans, a click selects", async ({ page }) => {
    const errors = await serve(page);
    await page.setViewportSize({ width: 560, height: 800 });
    await open(page);
    await expect(page.locator(".designer-phone-edit")).toBeVisible();
    await expect(page.locator(".designer-hint")).toContainText("Scroll to zoom in");
    const b = await planBox(page);
    const vb0 = await viewBox(page);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(vb0[2] * 0.8);
    const n = (await corners(page)).length;
    const { at } = await middleCorner(page);
    await page.mouse.click(at[0], at[1]);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1);
    await toolBtn(page, "Delete").click();
    await expect(page.locator("g.ed-corner")).toHaveCount(n - 1);
    await expect(toolBtn(page, "Undo")).toBeEnabled();
    expect(errors).toEqual([]);
  });
});
