// The drag loupe (#125): at 375 × 812 with touch, a finger dragging a corner, an apex handle, a jump or the start line
// shows a magnified circle of the plan above it with a readout; it goes when the finger lifts or a second finger lands;
// it stays on screen, clear of the header and the toolbar, at the plan's edges; a mouse drag shows none, and neither
// does a tablet. SHOTS=<dir> saves screenshots for the PR.
import { expect, test, type Page } from "@playwright/test";
import { corners, emptyFloor, middleCorner, open, pinchIn, planBox, serve, sheetClearOf, shot, toolbar, upperCorner } from "./phone-helper.js";
import { screen, Touch, type XY } from "./touch-helper.js";

const loupe = (page: Page) => page.locator(".plan-loupe");
const readout = (page: Page) => page.locator(".plan-loupe-read");
const rest = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** "x 3.40 · z −1.25 m" for a corner at (3.4, -1.25), as the loupe writes it */
const pos = ([x, z]: XY) => {
  const n = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).replace("-", "−");
  return `x ${n(x)} · z ${n(z)} m`;
};

/** a handle of this kind whose centre is on the plan and takes a finger there (nothing else on top of it) */
async function grab(page: Page, selector: string, handle: string): Promise<XY> {
  const plan = await planBox(page);
  // above any sheet, once it has slid back in
  await rest(400);
  const sheet = (await page.locator("section.bottom-sheet").count()) ? await page.locator("section.bottom-sheet").boundingBox() : null;
  const bottom = Math.min(plan.y + plan.height, sheet?.y ?? Infinity) - 60;
  const centres = await page.locator(selector).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number]; }));
  for (const at of centres) {
    if (at[0] < plan.x + 30 || at[0] > plan.x + plan.width - 30 || at[1] < plan.y + 40 || at[1] > bottom) continue;
    const ok = await page.evaluate(([x, y, h]) => document.elementFromPoint(x, y)?.closest("[data-handle]")?.getAttribute("data-handle") === h, [at[0], at[1], handle] as [number, number, string]);
    if (ok) return at;
  }
  throw new Error(`no ${handle} handle to grab: ${JSON.stringify({ centres, plan, bottom })}`);
}

/** the loupe (circle and readout) is inside the plan: on screen, below the header, above the toolbar */
async function onScreen(page: Page) {
  const c = (await loupe(page).boundingBox())!, r = (await readout(page).boundingBox())!;
  const plan = await planBox(page);
  const header = (await page.locator(".phone-header").boundingBox())!;
  const tb = (await toolbar(page).boundingBox())!;
  for (const b of [c, r]) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
    expect(b.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(b.y).toBeGreaterThanOrEqual(plan.y);
    expect(b.y + b.height).toBeLessThanOrEqual(tb.y);
  }
  await expect(loupe(page)).toBeInViewport({ ratio: 1 });
  await expect(readout(page)).toBeInViewport({ ratio: 1 });
}

/** the finger isn't under the loupe */
async function clearOf(page: Page, at: XY) {
  const c = (await loupe(page).boundingBox())!;
  const inside = at[0] > c.x && at[0] < c.x + c.width && at[1] > c.y && at[1] < c.y + c.height;
  expect(inside).toBe(false);
}

test.describe("phone loupe", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("a corner: the loupe shows above the finger mid-drag, with the corner's position, and goes when the finger lifts", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    // a corner the sheet doesn't cover: the finger has to land on the corner again once the sheet is up (#185)
    const { i, at } = await upperCorner(page);
    // with its sheet open: the sheet tucks away for the drag, and the loupe shows over the plan
    await t.tap(at);
    const s = page.getByRole("dialog", { name: `Corner ${i + 1}` });
    await expect(s).toHaveClass(/bottom-sheet--peek/);
    await sheetClearOf(page, at, 50);
    await t.down(at);
    await rest();
    await expect(loupe(page)).toHaveCount(0); // not on a press: only once the finger is dragging
    const to: XY = [at[0] + 14, at[1] + 30];
    await t.move([to], 6);
    await expect(loupe(page)).toHaveCount(1);
    await expect(s).toHaveClass(/bottom-sheet--tucked/);
    // above the finger, centred on it, and showing the corner where it now is
    await expect.poll(async () => { const b = (await loupe(page).boundingBox())!; return Math.abs(b.x + b.width / 2 - to[0]); }).toBeLessThan(2);
    const c = (await loupe(page).boundingBox())!;
    expect(c.y + c.height).toBeLessThan(to[1]);
    await expect(loupe(page)).toHaveAttribute("data-side", "above");
    await expect.poll(async () => (await readout(page).textContent()) === pos((await corners(page))[i])).toBe(true);
    // centred on the corner: the magnified plan's middle is the corner point
    const vb = (await page.locator(".plan-loupe svg").getAttribute("viewBox"))!.split(" ").map(Number);
    const [x, z] = (await corners(page))[i];
    expect(vb[0] + vb[2] / 2).toBeCloseTo(x, 6);
    expect(-(vb[1] + vb[3] / 2)).toBeCloseTo(z, 6);
    // it draws the plan through a <use> of the plan's drawing, without the editor's handles (they'd be magnified over
    // what they mark), and the other corners as dots at their usual size, but not the one being moved
    const href = await page.locator(".plan-loupe use").getAttribute("href");
    await expect(page.locator(`svg.plan-svg g${href} .plan-drawing`)).toHaveCount(1);
    await expect(page.locator(`svg.plan-svg g${href} [data-handle]`)).toHaveCount(0);
    await expect(page.locator(".plan-loupe [data-handle]")).toHaveCount(0);
    await expect(page.locator(".plan-loupe .loupe-dot")).toHaveCount((await corners(page)).length - 1);
    await onScreen(page);
    await clearOf(page, to);
    await shot(page, "375-loupe-middle");
    // it follows the finger (to the right: the upper corner is near the left edge, where the loupe would stop short)
    const to2: XY = [to[0] + 30, to[1] + 20];
    await t.move([to2], 6);
    await expect.poll(async () => { const b = (await loupe(page).boundingBox())!; return Math.abs(b.x + b.width / 2 - to2[0]); }).toBeLessThan(2);
    await expect.poll(async () => (await readout(page).textContent()) === pos((await corners(page))[i])).toBe(true);
    await t.up();
    await expect(loupe(page)).toHaveCount(0);
    await expect(s).toHaveClass(/bottom-sheet--peek/);
    expect(errors).toEqual([]);
  });

  test("an apex handle: the loupe reads its radius, as the R label beside it does", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const at = await grab(page, "circle.ed-hit-apex", "apex");
    await t.down(at);
    await t.move([[at[0] + 12, at[1] + 12]], 6);
    await expect(loupe(page)).toHaveCount(1);
    await expect(readout(page)).toHaveText(/^Radius \d+\.\d m$/);
    await onScreen(page);
    // the label of the handle being dragged: the R label nearest the finger
    const labels = await page.locator("text.ed-label").evaluateAll((els, [x, y]) =>
      els.map((e) => { const r = e.getBoundingClientRect(); return { d: Math.hypot(r.x + r.width / 2 - x, r.y + r.height / 2 - y), text: e.textContent ?? "" }; }).sort((a, b) => a.d - b.d), [at[0] + 12, at[1] + 12]);
    const label = labels.find((l) => /^R /.test(l.text))!.text;
    const r = Number((await readout(page).textContent())!.match(/[\d.]+/)![0]);
    expect(Number(label.match(/[\d.]+/)![0])).toBe(r);
    await t.up();
    await expect(loupe(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a jump and the start line: the loupe reads the distance along the lap, as their sheet does (Advanced)", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "", "advanced");
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const along = page.locator("section.bottom-sheet").getByLabel("Along the line");
    // a jump
    let at = await grab(page, ".ed-hit-feature", "feature");
    await t.down(at);
    await t.move([[at[0] + 16, at[1] + 16]], 6);
    await expect(loupe(page)).toHaveCount(1);
    await expect(readout(page)).toHaveText(/^\d+\.\d m along the lap$/);
    await onScreen(page);
    let read = (await readout(page).textContent())!;
    await shot(page, "375-loupe-jump");
    await t.up();
    await expect(loupe(page)).toHaveCount(0);
    await expect(along).toHaveCount(1);
    expect(read).toBe(`${Number(await along.inputValue()).toFixed(1)} m along the lap`);

    // the start line: pan it into the middle of the plan first (after the zoom it can be off to one side)
    const st = (await page.locator("g.ed-start .ed-hit").boundingBox())!;
    const plan = await planBox(page);
    const floor = await emptyFloor(page);
    await t.drag([floor, [floor[0] + plan.x + plan.width / 2 - (st.x + st.width / 2), floor[1] + plan.y + plan.height / 3 - (st.y + st.height / 2)]], 8);
    at = await grab(page, "g.ed-start .ed-hit", "start");
    await t.down(at);
    await t.move([[at[0] + 16, at[1] + 16]], 6);
    await expect(loupe(page)).toHaveCount(1);
    await expect(readout(page)).toHaveText(/^\d+\.\d m along the lap$/);
    await onScreen(page);
    read = (await readout(page).textContent())!;
    await t.up();
    await expect(loupe(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Start line" })).toHaveCount(1);
    await expect(along).toHaveCount(1);
    expect(read).toBe(`${Number(await along.inputValue()).toFixed(1)} m along the lap`);
    expect(errors).toEqual([]);
  });

  test("it stays on screen, clear of the header and the toolbar, at the top, side and bottom edges and corners", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const plan = await planBox(page);
    const edges: [string, XY, string][] = [
      ["top", [plan.x + plan.width / 2, plan.y + 6], "below"],
      ["top-left", [plan.x + 4, plan.y + 6], "below"],
      ["top-right", [plan.x + plan.width - 4, plan.y + 6], "below"],
      ["left", [plan.x + 4, plan.y + plan.height / 2], "above"],
      ["right", [plan.x + plan.width - 4, plan.y + plan.height / 2], "above"],
      ["bottom-left", [plan.x + 4, plan.y + plan.height - 6], "above"],
      ["bottom-right", [plan.x + plan.width - 4, plan.y + plan.height - 6], "above"],
    ];
    for (const [name, to, side] of edges) {
      const { at } = await middleCorner(page);
      await t.down(at);
      await t.move([to], 10);
      await expect(loupe(page), name).toHaveCount(1);
      await expect(loupe(page), name).toHaveAttribute("data-side", side);
      await onScreen(page);
      await clearOf(page, to);
      if (name === "top" || name === "left") await shot(page, `375-loupe-${name}`);
      await t.up();
      await expect(loupe(page)).toHaveCount(0);
      // put it back, so the next drag starts from the middle again
      await page.getByRole("button", { name: "Undo", exact: true }).tap();
      await rest(250);
      // and put the corner's sheet away: under the shared top bar (#149) the plan is shorter, and the sheet would cover
      // the middle corner
      if (await page.locator("section.bottom-sheet").count()) {
        await page.locator("section.bottom-sheet").getByRole("button", { name: "Close" }).tap();
        await expect(page.locator("section.bottom-sheet")).toHaveCount(0);
      }
    }
    expect(errors).toEqual([]);
  });

  test("a second finger during a drag cancels it and takes the loupe away", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const { i, at } = await middleCorner(page);
    const before = (await corners(page))[i];
    await t.down(at);
    await t.move([[at[0] + 20, at[1] + 30]], 6);
    await expect(loupe(page)).toHaveCount(1);
    expect((await corners(page))[i]).not.toEqual(before);
    await t.down([at[0] - 80, at[1] + 60]);
    await expect(loupe(page)).toHaveCount(0);
    await expect.poll(async () => (await corners(page))[i]).toEqual(before);
    await t.move([[at[0] + 40, at[1] + 50], [at[0] - 120, at[1] + 80]], 6);
    await expect(loupe(page)).toHaveCount(0);
    await t.up();
    await expect(loupe(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a mouse drag shows no loupe", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const { i, at } = await middleCorner(page);
    const before = (await corners(page))[i];
    await page.evaluate(() => {
      const w = window as unknown as { loupe: boolean };
      w.loupe = false;
      new MutationObserver(() => document.querySelector(".plan-loupe") && (w.loupe = true)).observe(document.body, { subtree: true, childList: true });
    });
    await page.mouse.move(...at);
    await page.mouse.down();
    await page.mouse.move(at[0] + 15, at[1] + 30, { steps: 8 });
    await page.mouse.move(at[0] + 30, at[1] + 50, { steps: 8 });
    await page.mouse.up();
    expect((await corners(page))[i]).not.toEqual(before); // it did drag
    expect(await page.evaluate(() => (window as unknown as { loupe: boolean }).loupe)).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe("no loupe off the phone", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === "phone", "tablets and the desktop"));

  test("dragging a corner drags it, with no loupe", async ({ page }, info) => {
    const errors = await serve(page);
    await open(page);
    if (info.project.name !== "desktop-mouse") await pinchIn(page, await Touch.on(page));
    const before = await corners(page);
    // a corner whose dot takes the press (at this zoom some apex handles sit on their dots)
    const i = await (async () => {
      for (let k = 0; k < before.length; k++) {
        const p = await screen(page, ...before[k]);
        if (await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-handle]")?.getAttribute("data-handle") === "point", p)) return k;
      }
      throw new Error("no corner to grab");
    })();
    const at = await screen(page, ...before[i]);
    await page.evaluate(() => {
      const w = window as unknown as { loupe: boolean };
      w.loupe = false;
      new MutationObserver(() => document.querySelector(".plan-loupe") && (w.loupe = true)).observe(document.body, { subtree: true, childList: true });
    });
    if (info.project.name === "desktop-mouse") {
      await page.mouse.move(...at);
      await page.mouse.down();
      await page.mouse.move(at[0] + 20, at[1] + 30, { steps: 10 });
      await page.mouse.up();
    } else {
      const t = await Touch.on(page);
      await t.down(at);
      await t.move([[at[0] + 10, at[1] + 15]], 4);
      await t.move([[at[0] + 20, at[1] + 30]], 4);
      await t.up();
    }
    await expect.poll(async () => (await corners(page))[i]).not.toEqual(before[i]);
    expect(await page.evaluate(() => (window as unknown as { loupe: boolean }).loupe)).toBe(false);
    expect(errors).toEqual([]);
  });
});
