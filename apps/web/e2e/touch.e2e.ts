// Tablet touch in Quick mode (#16), with Chromium's touch emulation at 1024 × 768 and 768 × 1024. Touches go through
// CDP's Input.dispatchTouchEvent, which makes real touch pointer events (one finger or several). The desktop-mouse
// project checks that the mouse still works as before.
import { expect, test, type CDPSession, type Page } from "@playwright/test";

type XY = [number, number];

/** a blank 22 × 12 m area: 11 × 6 squares of 2 m */
const BLANK = "/new/design?length=22&width=12&name=Touch";
/** round the edge of the area, back to the first square */
const LOOP: XY[] = [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]];
/** an octagon with 45° corners, closing corner to corner onto the first square */
const OCTAGON: XY[] = [[2, 0], [8, 0], [10, 2], [10, 3], [8, 5], [2, 5], [0, 3], [0, 2], [2, 0]];

const isTouch = (name: string) => name.startsWith("tablet");

async function open(page: Page) {
  await page.goto(BLANK);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("rect.lay-hit");
  await page.waitForTimeout(200);
}

/** Fingers on the screen. `down` adds fingers, `move` moves all of them, `up` lifts them all. */
class Touch {
  private pts: { x: number; y: number; id: number }[] = [];
  private next = 0;
  private moved = false;
  constructor(private cdp: CDPSession) {}
  static async on(page: Page) {
    return new Touch(await page.context().newCDPSession(page));
  }
  async down(...at: XY[]) {
    for (const [x, y] of at) {
      this.pts.push({ x, y, id: this.next++ });
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: this.pts.map((p) => ({ ...p })) });
    }
  }
  /** move every finger to these spots, in `steps` steps */
  async move(to: XY[], steps = 6) {
    this.moved = true;
    const from = this.pts.map((p) => [p.x, p.y]);
    for (let k = 1; k <= steps; k++) {
      this.pts.forEach((p, i) => {
        p.x = from[i][0] + ((to[i][0] - from[i][0]) * k) / steps;
        p.y = from[i][1] + ((to[i][1] - from[i][1]) * k) / steps;
      });
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: this.pts.map((p) => ({ ...p })) });
    }
  }
  /**
   * Lift every finger. After a drag the fingers rest a moment first, as a hand does: lifted mid-movement, Chromium's
   * emulation takes it as a fling and swallows the next tap (to stop the fling), whatever it lands on.
   */
  async up() {
    if (this.moved) {
      await new Promise((r) => setTimeout(r, 120));
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: this.pts.map((p) => ({ ...p })) });
    }
    this.moved = false;
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    this.pts = [];
  }
  async tap(at: XY) {
    await this.down(at);
    await this.up();
  }
  /** one finger along a path of spots */
  async drag(path: XY[], steps = 4) {
    await this.down(path[0]);
    for (const p of path.slice(1)) await this.move([p], steps);
    await this.up();
  }
  async hold(at: XY, ms: number) {
    await this.down(at);
    await new Promise((r) => setTimeout(r, ms));
  }
}

/** screen position of a plan point (x, z) */
const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => {
    const svg = document.querySelector("svg.plan-svg") as SVGSVGElement;
    const p = new DOMPoint(x, -z).matrixTransform(svg.getScreenCTM()!);
    return [p.x, p.y] as XY;
  }, [x, z] as XY);

/** screen centre of square [col, row] while laying */
async function cell(page: Page, c: number, r: number): Promise<XY> {
  const g = await page.evaluate(() => {
    const h = document.querySelector("rect.lay-hit")!;
    return { x: +h.getAttribute("x")!, y: +h.getAttribute("y")!, h: +h.getAttribute("height")! };
  });
  const x = g.x + (c + 0.5) * 2, svgY = g.y + g.h - (r + 0.5) * 2;
  return screen(page, x, -svgY);
}

const viewBox = (page: Page) => page.locator("svg.plan-svg").getAttribute("viewBox");
/** corner points in plan coordinates, from their dots */
const corners = (page: Page) =>
  page.locator("g.ed-corner .ed-corner-dot").evaluateAll((els) => els.map((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!] as XY));
const centreOf = async (page: Page, selector: string, i = 0): Promise<XY> => {
  const b = (await page.locator(selector).nth(i).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};

/** lay the loop round the edge by touch: step 2 with four corners */
async function layLoop(page: Page, t: Touch) {
  const path: XY[] = [];
  for (const [c, r] of LOOP) path.push(await cell(page, c, r));
  await t.drag(path, 10);
  await expect(page.locator('.steps li[aria-current="step"]')).toContainText("Shape it");
  await expect(page.locator("g.ed-corner")).toHaveCount(4);
}

test.describe("tablet touch", () => {
  test.beforeEach(({}, info) => test.skip(!isTouch(info.project.name), "touch only"));

  test("tablet layout: plan with an on-screen dock, controls at least 44 px, nothing off the screen", async ({ page }) => {
    await open(page);
    await expect(page.locator(".designer-touch")).toBeVisible();
    const dock = page.getByRole("toolbar", { name: "Designer tools" });
    await expect(dock).toBeVisible();
    for (const name of ["Undo", "Redo", "Reverse direction", "Zoom to fit"]) {
      const b = (await dock.getByRole("button", { name }).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    // the header's controls too
    for (const el of await page.locator(".designer-bar").locator("button, a, input").all()) {
      const box = (await el.boundingBox())!;
      expect(box.height, await el.evaluate((e) => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }
    const t = await Touch.on(page);
    await layLoop(page, t);
    for (const b of await dock.getByRole("button").all()) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(dock.getByRole("button", { name: "Snap" })).toHaveAttribute("aria-pressed", "true");
    await expect(dock.getByRole("button", { name: /Tabletop/ })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Start line" })).toBeVisible();
    // Reverse lives in the dock on a tablet, so the bar stays one row
    await expect(dock.getByRole("button", { name: "Reverse direction" })).toBeEnabled();
    await expect(page.locator(".designer-bar").getByRole("button", { name: /Reverse/ })).toHaveCount(0);
    if (page.viewportSize()!.width >= 1024) {
      // and at 1024 px the bar is one row: every control in it shares a middle
      const mids = await page.locator(".designer-bar").locator("button, a").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
      expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(4);
    }
    const vw = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);
    const d = (await dock.boundingBox())!;
    expect(d.y + d.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  });

  test("step 1: a finger paints through the squares, dragging back takes them up, the first square closes the loop", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await t.drag([await cell(page, 0, 0), await cell(page, 4, 0)]);
    await expect(page.locator("rect.lay-cell")).toHaveCount(5);
    await t.drag([await cell(page, 4, 0), await cell(page, 4, 2), await cell(page, 4, 1)]);
    await expect(page.locator("rect.lay-cell")).toHaveCount(6); // two up, one back
    await t.drag([await cell(page, 4, 1), await cell(page, 4, 0), await cell(page, 2, 0)]);
    await expect(page.locator("rect.lay-cell")).toHaveCount(3);
    await page.getByRole("toolbar", { name: "Designer tools" }).getByRole("button", { name: "Undo" }).tap();
    await expect(page.locator("rect.lay-cell")).toHaveCount(4);
    await page.getByRole("toolbar", { name: "Designer tools" }).getByRole("button", { name: "Start again" }).tap();
    await expect(page.locator("rect.lay-cell")).toHaveCount(0);
    await layLoop(page, t);
  });

  test("step 1: a finger lays diagonal runs corner to corner and closes an octagon (#82)", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    // 7 steps per move, so no sample lands exactly on a grid corner
    const path: XY[] = [];
    for (const [c, r] of OCTAGON) path.push(await cell(page, c, r));
    // a slow finger a little off the diagonal, clipping [8, 1] beside the corner: still corner to corner
    await t.drag([path[0], path[1], await cell(page, 8.6, 1), path[2]], 20);
    await expect(page.locator("rect.lay-cell")).toHaveCount(9); // [2, 0]…[8, 0], [9, 1], [10, 2]
    await t.drag(path.slice(2), 7);
    await expect(page.locator('.steps li[aria-current="step"]')).toContainText("Shape it");
    await expect(page.locator("g.ed-corner")).toHaveCount(8);
  });

  test("step 1: a finger lifted near the edge of the next square still paints it, closing the loop too (#96)", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    // [0, 0] → [3, 0], then just into [4, 0] (0.4 of a square off its centre): the drag never moves on to it
    await t.drag([await cell(page, 0, 0), await cell(page, 3, 0), await cell(page, 3.6, 0)], 7);
    await expect(page.locator("rect.lay-cell")).toHaveCount(5);
    // round and back down column 0, lifted just inside the top of the first square: the loop closes
    await t.drag([await cell(page, 3.6, 0), await cell(page, 4, 0), await cell(page, 4, 2), await cell(page, 0, 2), await cell(page, 0, 0.4)], 7);
    await expect(page.locator('.steps li[aria-current="step"]')).toContainText("Shape it");
    await expect(page.locator("g.ed-corner")).toHaveCount(4);
  });

  test("step 1: two fingers pinch and pan the plan and never paint", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    const before = await viewBox(page);
    await t.down(await cell(page, 3, 2), await cell(page, 6, 3));
    await t.move([await cell(page, 2, 1), await cell(page, 8, 4)]);
    await t.up();
    await expect(page.locator("rect.lay-cell")).toHaveCount(0);
    await expect.poll(() => viewBox(page)).not.toBe(before);
    // a pan: both fingers the same way
    const zoomed = await viewBox(page);
    const [a, b] = [await cell(page, 4, 2), await cell(page, 6, 2)];
    await t.down(a, b);
    await t.move([[a[0] + 60, a[1] + 30], [b[0] + 60, b[1] + 30]]);
    await t.up();
    await expect(page.locator("rect.lay-cell")).toHaveCount(0);
    await expect.poll(() => viewBox(page)).not.toBe(zoomed);
    // zoom to fit puts it back
    await page.getByRole("toolbar", { name: "Designer tools" }).getByRole("button", { name: "Zoom to fit" }).tap();
    await expect.poll(() => viewBox(page)).toBe(before);
  });

  test("step 1: a second finger landing mid-paint takes the painting back", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    const vb = await viewBox(page);
    await t.down(await cell(page, 0, 0));
    await t.move([await cell(page, 3, 0)]);
    await expect(page.locator("rect.lay-cell")).toHaveCount(4);
    await t.down(await cell(page, 5, 4));
    await t.move([await cell(page, 4, 0), await cell(page, 7, 5)]);
    await t.up();
    await expect(page.locator("rect.lay-cell")).toHaveCount(0);
    await expect.poll(() => viewBox(page)).not.toBe(vb); // it pinched instead
  });

  test("step 2: drag a corner, drag an apex handle, Undo and Redo", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await layLoop(page, t);
    const [c1] = await corners(page);
    const from = await screen(page, ...c1), to = await screen(page, c1[0] + 2, c1[1] + 2);
    await t.drag([from, to], 8);
    const moved = (await corners(page))[0];
    expect(moved[0]).toBeCloseTo(c1[0] + 2, 1);
    expect(moved[1]).toBeCloseTo(c1[1] + 2, 1);
    const dock = page.getByRole("toolbar", { name: "Designer tools" });
    await dock.getByRole("button", { name: "Undo" }).tap();
    expect((await corners(page))[0]).toEqual(c1);
    await dock.getByRole("button", { name: "Redo" }).tap();
    expect((await corners(page))[0]).toEqual(moved);
    await dock.getByRole("button", { name: "Undo" }).tap();

    // the apex handle of corner 3 (top right): drag it inwards to cut the corner back
    const ap = await centreOf(page, "circle.ed-hit-apex", 2);
    await t.down(ap);
    await t.move([[ap[0] - 50, ap[1] + 50]], 8);
    await expect(page.locator("text.ed-label")).toContainText(/R [1-9]/);
    await t.up();
    await expect(page.locator("text.ed-label")).toContainText(/R [1-9]/);
  });

  test("Reverse in the dock: off while laying the lanes, then a tap drives the loop the other way, and Undo puts it back", async ({ page }) => {
    await open(page);
    const dock = page.getByRole("toolbar", { name: "Designer tools" });
    await expect(dock.getByRole("button", { name: "Reverse direction" })).toBeDisabled();
    const t = await Touch.on(page);
    await layLoop(page, t);
    const before = await corners(page);
    await dock.getByRole("button", { name: "Reverse direction" }).tap();
    await expect.poll(() => corners(page)).toEqual([before[0], ...before.slice(1).reverse()]);
    await dock.getByRole("button", { name: "Undo" }).tap();
    await expect.poll(() => corners(page)).toEqual(before);
  });

  test("step 2: a tap on the floor adds a corner after the selected one; a drag on the floor doesn't", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await layLoop(page, t);
    await t.tap(await screen(page, ...(await corners(page))[0]));
    await expect(page.locator("g.ed-corner.on")).toHaveCount(1);
    const floor = await screen(page, -4, 0);
    await t.drag([floor, [floor[0] + 80, floor[1] + 40]], 6);
    await expect(page.locator("g.ed-corner")).toHaveCount(4);
    const floor2 = await screen(page, -4, 0); // the drag panned the plan
    await t.tap(floor2);
    await expect(page.locator("g.ed-corner")).toHaveCount(5);
    await expect(page.locator("g.ed-corner.on text")).toHaveText("2");
  });

  test("step 2: long-press a corner selects it with a ring and opens its panel", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await layLoop(page, t);
    const c3 = await screen(page, ...(await corners(page))[2]);
    await t.hold(c3, 250);
    await expect(page.locator("circle.ed-press")).toHaveCount(1); // the ring fills while the finger is down
    await expect(page.locator(".designer-sheet")).toHaveCount(0);
    await new Promise((r) => setTimeout(r, 450));
    await expect(page.locator("circle.ed-press.done")).toHaveCount(1);
    await t.up();
    await expect(page.locator("circle.ed-press.done")).toHaveCount(1); // the ring stays while it's selected
    const sheet = page.locator(".designer-sheet");
    await expect(sheet.getByRole("heading", { name: "Corner 3" })).toBeVisible();
    // a tap on another corner selects it (for adding after it) and closes the panel; holding it opens its own
    const c1 = await screen(page, ...(await corners(page))[0]);
    await t.tap(c1);
    await expect(page.locator("g.ed-corner.on text")).toHaveText("1");
    await expect(page.locator(".designer-sheet")).toHaveCount(0);
    await expect(page.locator("circle.ed-press")).toHaveCount(0);
    await t.hold(c3, 700);
    await t.up();
    await expect(sheet.getByRole("heading", { name: "Corner 3" })).toBeVisible();
    await expect(sheet.getByLabel("Apex radius")).toBeVisible();
    await expect(sheet.getByRole("group", { name: "Quick sizes" })).toBeVisible();
    await expect(page.locator("g.ed-corner.on text")).toHaveText("3"); // still selected after the finger lifts
    await sheet.getByRole("button", { name: /^Medium/ }).tap();
    await expect(page.locator("text.ed-label")).toContainText("R 1.8");
    await sheet.getByRole("button", { name: "Delete corner" }).tap();
    await expect(page.locator("g.ed-corner")).toHaveCount(3);
    await expect(page.locator(".designer-sheet")).toHaveCount(0);
  });

  test("step 2: the Snap toggle places corners freely when it's off", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await layLoop(page, t);
    const [c1] = await corners(page);
    // 0.1 m off a lane line (lines every 1 m from the area's edge): snapping puts it on the line
    const target: XY = [c1[0] + 2.1, c1[1] + 2.1];
    await t.drag([await screen(page, ...c1), await screen(page, ...target)], 8);
    let p = (await corners(page))[0];
    expect(Math.abs(p[0] - Math.round(p[0]))).toBeLessThan(0.01);
    const dock = page.getByRole("toolbar", { name: "Designer tools" });
    await dock.getByRole("button", { name: "Undo" }).tap();
    await dock.getByRole("button", { name: "Snap" }).tap();
    await expect(dock.getByRole("button", { name: "Snap" })).toHaveAttribute("aria-pressed", "false");
    await t.drag([await screen(page, ...c1), await screen(page, ...target)], 8);
    p = (await corners(page))[0];
    expect(Math.abs(p[0] - Math.round(p[0]))).toBeGreaterThan(0.03);
  });

  test("step 2: two fingers starting on a corner zoom and never move it", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await layLoop(page, t);
    const before = await corners(page);
    const vb = await viewBox(page);
    const c1 = await screen(page, ...before[0]);
    await t.down(c1);
    await t.move([[c1[0] + 4, c1[1] - 4]], 2);
    await t.down(await screen(page, 0, 0));
    const b = await screen(page, 0, 0);
    await t.move([[c1[0] - 60, c1[1] + 60], [b[0] + 60, b[1] - 60]]);
    await t.up();
    expect(await corners(page)).toEqual(before);
    await expect.poll(() => viewBox(page)).not.toBe(vb);
    await expect(page.locator("g.ed-corner")).toHaveCount(4);

    // a drag already under way goes back when a second finger lands
    await page.getByRole("toolbar", { name: "Designer tools" }).getByRole("button", { name: "Zoom to fit" }).tap();
    await expect.poll(() => viewBox(page)).toBe(vb);
    const c2 = await screen(page, ...before[1]);
    await t.down(c2);
    await t.move([[c2[0] - 60, c2[1] - 60]], 6);
    expect((await corners(page))[1]).not.toEqual(before[1]);
    const far = await screen(page, -6, 0);
    await t.down(far);
    await t.move([[c2[0] - 80, c2[1] - 80], [far[0] + 40, far[1]]]);
    await t.up();
    expect(await corners(page)).toEqual(before);
    // and the same for an apex handle
    const labels = await page.locator("text.ed-label").count();
    const ap = await centreOf(page, "circle.ed-hit-apex", 2);
    await t.down(ap);
    await t.move([[ap[0] - 40, ap[1] + 40]], 6);
    await t.down(far);
    await t.move([[ap[0] - 60, ap[1] + 60], [far[0] - 40, far[1]]]);
    await t.up();
    expect(await corners(page)).toEqual(before);
    await expect(page.locator("text.ed-label")).toHaveCount(labels);
    await expect(page.getByRole("toolbar", { name: "Designer tools" }).getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  test("corners, apex handles and jumps take a press 44 px across", async ({ page }) => {
    await open(page);
    const t = await Touch.on(page);
    await layLoop(page, t);
    await page.getByRole("toolbar", { name: "Designer tools" }).getByRole("button", { name: /Tabletop/ }).tap();
    // on the north straight, under where its panel opens: the tap mustn't go on to press the panel's Delete
    await t.tap(await screen(page, 8, 5));
    await expect(page.locator("polygon.ed-feature")).toHaveCount(1);
    await expect(page.locator(".designer-sheet")).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.locator("polygon.ed-feature")).toHaveCount(1);
    await page.locator(".designer-sheet").getByRole("button", { name: "Close" }).tap();
    for (const sel of ["g.ed-corner .ed-hit", "circle.ed-hit-apex", ".ed-hit-feature"]) {
      const b = (await page.locator(sel).first().boundingBox())!;
      expect(b.width, sel).toBeGreaterThanOrEqual(43.5);
    }
    // a jump selected by touch opens its panel, with Delete; the tap that selects it never clicks what opens under it
    await page.evaluate(() => {
      (window as unknown as { clicks: number }).clicks = 0;
      window.addEventListener("click", () => (window as unknown as { clicks: number }).clicks++, true);
    });
    await t.tap(await centreOf(page, ".ed-hit-feature"));
    await expect(page.locator(".designer-sheet")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);
    await expect(page.locator(".designer-sheet").getByRole("button", { name: "Delete tabletop" })).toBeVisible();
  });
});

test.describe("mouse", () => {
  test.beforeEach(({}, info) => test.skip(isTouch(info.project.name), "mouse only"));

  test("the desktop layout and mouse drawing are unchanged", async ({ page }) => {
    await open(page);
    await expect(page.locator(".designer-touch")).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Designer tools" })).toHaveCount(0);
    await expect(page.locator(".designer-palette")).toBeVisible();
    const path: XY[] = [];
    for (const [c, r] of LOOP) path.push(await cell(page, c, r));
    await page.mouse.move(...path[0]);
    await page.mouse.down();
    for (const p of path.slice(1)) await page.mouse.move(...p, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator("g.ed-corner")).toHaveCount(4);
    // press and hold a corner with the mouse: no ring, no sheet; it's selected straight away
    const c = await screen(page, ...(await corners(page))[0]);
    await page.mouse.move(...c);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.locator("circle.ed-press")).toHaveCount(0);
    await expect(page.locator(".sel-panel h2")).toHaveText("Corner 1");
    // click the floor: a corner after it
    await page.mouse.click(...(await screen(page, -4, 0)));
    await expect(page.locator("g.ed-corner")).toHaveCount(5);
  });
});
