// The long-press context sheet (#126): at 375 × 812 with touch, a finger held still on a corner (Quick), a corner point
// (Advanced), a jump or the start line opens a small sheet of actions for it. The press itself changes nothing; each
// action is one undo step; a press that turns into a drag opens nothing; the browser's own menu never opens over the
// plan. SHOTS=<dir> saves screenshots for the PR.
import { expect, test, type Page } from "@playwright/test";
import { doc, emptyFloor, open, pinchIn, planBox, serve, shot, toolBtn } from "./phone-helper.js";
import { Touch, type XY } from "./touch-helper.js";

const rest = (ms = 150) => new Promise((r) => setTimeout(r, ms));
/** LONG_PRESS_MS (500) and some */
const HOLD = 700;
const context = (page: Page) => page.locator("section.phone-sheet-context");
const item = (page: Page, name: string | RegExp) => context(page).getByRole("menuitem", { name });
const pointCount = (page: Page) => page.locator("svg.plan-svg [data-handle=point]").count();
const featureCount = (page: Page) => page.locator("svg.plan-svg polygon.ed-feature").count();

/** a handle of this kind whose centre is on the plan, above any sheet, and takes a finger there */
async function grab(page: Page, selector: string, handle: string): Promise<XY> {
  const plan = await planBox(page);
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

/** the start line panned into the top third of the plan (after the zoom it can be off to one side) */
async function startInView(page: Page, t: Touch) {
  const st = (await page.locator("g.ed-start .ed-hit").boundingBox())!;
  const plan = await planBox(page);
  const floor = await emptyFloor(page);
  await t.drag([floor, [floor[0] + plan.x + plan.width / 2 - (st.x + st.width / 2), floor[1] + plan.y + plan.height / 3 - (st.y + st.height / 2)]], 8);
}

/** hold a finger still for HOLD ms, then lift it */
async function longPress(page: Page, t: Touch, at: XY) {
  await t.hold(at, HOLD);
  await t.up();
}

const undo = (page: Page) => toolBtn(page, "Undo");

test.describe("phone context sheet", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  for (const mode of ["quick", "advanced"] as const) {
    const corner = mode === "quick" ? "Corner" : "Corner point";
    const dot = mode === "quick" ? "g.ed-corner" : "circle.ed-point";

    test(`${mode}: a long press on a ${corner.toLowerCase()} opens its actions and changes nothing; Delete, then Undo in one step`, async ({ page }) => {
      const errors = await serve(page);
      await open(page, "", mode);
      const t = await Touch.on(page);
      await pinchIn(page, t);
      await expect(undo(page)).toBeDisabled();
      const n = await pointCount(page);
      const at = await grab(page, dot, "point");
      // the press alone: the sheet opens only once the finger has been held LONG_PRESS_MS
      await t.hold(at, 250);
      await expect(context(page)).toHaveCount(0);
      await rest(450);
      await expect(context(page)).toHaveCount(1);
      await t.up();
      const name = (await context(page).getAttribute("aria-label"))!;
      expect(name).toMatch(new RegExp(`^${corner} \\d+$`));
      const actions = await context(page).getByRole("menuitem").allTextContents();
      expect(actions[0]).toBe("Delete");
      expect(actions[1]).toMatch(/^(Square|Round) outside corner$/);
      expect(actions.length).toBe(mode === "quick" ? 2 : 3);
      if (mode === "advanced") expect(actions[2]).toMatch(/^Make hairpin/);
      // nothing changed: same points, nothing to undo
      expect(await pointCount(page)).toBe(n);
      await expect(undo(page)).toBeDisabled();
      await shot(page, `375-context-${mode}-corner`);

      // Delete: gone, the sheet put away, and Undo puts it back in one step
      await item(page, "Delete").tap();
      await expect(context(page)).toHaveCount(0);
      await expect.poll(() => pointCount(page)).toBe(n - 1);
      await undo(page).tap();
      await expect.poll(() => pointCount(page)).toBe(n);
      await expect(undo(page)).toBeDisabled();
      expect(errors).toEqual([]);
    });

    test(`${mode}: Square / Round outside corner from the sheet flips the corner, one undo step`, async ({ page }) => {
      const errors = await serve(page);
      await open(page, "", mode);
      const t = await Touch.on(page);
      await pinchIn(page, t);
      const at = await grab(page, dot, "point");
      await longPress(page, t, at);
      const row = item(page, /outside corner$/);
      const label = (await row.textContent())!;
      await row.tap();
      await expect(context(page)).toHaveCount(0);
      await expect(undo(page)).toBeEnabled();
      // held again, the sheet offers the other way back
      await longPress(page, t, at);
      await expect(item(page, /outside corner$/)).toHaveText(label.startsWith("Square") ? "Round outside corner" : "Square outside corner");
      await context(page).getByRole("button", { name: "Close" }).tap();
      await expect(context(page)).toHaveCount(0);
      await undo(page).tap();
      await expect(undo(page)).toBeDisabled();
      expect(errors).toEqual([]);
    });
  }

  test("advanced: Make hairpin from the sheet adds the second point, one undo step", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "", "advanced");
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const n = await pointCount(page);
    const at = await grab(page, "circle.ed-point", "point");
    await longPress(page, t, at);
    await shot(page, "375-context-advanced-corner");
    await item(page, "Make hairpin").tap();
    await expect(context(page)).toHaveCount(0);
    await expect.poll(() => pointCount(page)).toBe(n + 1);
    await undo(page).tap();
    await expect.poll(() => pointCount(page)).toBe(n);
    await expect(undo(page)).toBeDisabled();
    expect(errors).toEqual([]);
  });

  for (const mode of ["quick", "advanced"] as const) {
    test(`${mode}: a jump's sheet has Delete; the start line's says it can't go`, async ({ page }) => {
      const errors = await serve(page);
      await open(page, "", mode);
      const t = await Touch.on(page);
      await pinchIn(page, t);
      const jumps = await featureCount(page);
      let at = await grab(page, ".ed-hit-feature", "feature");
      await longPress(page, t, at);
      await expect(context(page).getByRole("menuitem")).toHaveText(["Delete"]);
      await expect(undo(page)).toBeDisabled();
      if (mode === "quick") await shot(page, "375-context-quick-jump");
      await item(page, "Delete").tap();
      await expect.poll(() => featureCount(page)).toBe(jumps - 1);
      await undo(page).tap();
      await expect.poll(() => featureCount(page)).toBe(jumps);
      // closed without an action, the jump is let go, as closing its selection sheet does: the toolbar's Delete has nothing
      at = await grab(page, ".ed-hit-feature", "feature");
      await longPress(page, t, at);
      await expect(toolBtn(page, "Delete")).toBeEnabled();
      await context(page).getByRole("button", { name: "Close" }).tap();
      await expect(context(page)).toHaveCount(0);
      await expect(toolBtn(page, "Delete")).toBeDisabled();

      await startInView(page, t);
      at = await grab(page, "g.ed-start .ed-hit", "start");
      await longPress(page, t, at);
      await expect(context(page)).toHaveAttribute("aria-label", "Start line");
      await expect(context(page).getByRole("menuitem")).toHaveCount(1);
      await expect(item(page, /^Delete/)).toBeDisabled();
      await expect(item(page, /^Delete/)).toContainText("start line");
      expect(errors).toEqual([]);
    });
  }

  // #147: the context sheet's rows are a menu, so the keys work as in a menu
  test("advanced: the arrow keys, Home and End move round the rows, Enter does the row, Escape closes", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "", "advanced");
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const n = await pointCount(page);
    const at = await grab(page, "circle.ed-point", "point");
    await longPress(page, t, at);
    const rows = context(page).getByRole("menuitem");
    await expect(rows).toHaveCount(3);
    // opened: the first row has the focus
    await expect(rows.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowDown"); // round to the top
    await expect(rows.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowUp"); // and back to the bottom
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(rows.nth(0)).toBeFocused();
    await page.keyboard.press("End");
    await expect(rows.nth(2)).toHaveText(/^Make hairpin/);
    await expect(rows.nth(2)).toBeFocused();
    // Enter: Make hairpin, one undo step, the sheet put away
    await page.keyboard.press("Enter");
    await expect(context(page)).toHaveCount(0);
    await expect.poll(() => pointCount(page)).toBe(n + 1);
    await undo(page).tap();
    await expect.poll(() => pointCount(page)).toBe(n);
    await expect(undo(page)).toBeDisabled();
    // Escape: closed, nothing done
    await longPress(page, t, at);
    await expect(rows.nth(0)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(context(page)).toHaveCount(0);
    expect(await pointCount(page)).toBe(n);
    await expect(undo(page)).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("the start line's Delete takes the focus, so its reason is read, and Enter on it does nothing", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "", "advanced");
    const t = await Touch.on(page);
    await pinchIn(page, t);
    await startInView(page, t);
    await longPress(page, t, await grab(page, "g.ed-start .ed-hit", "start"));
    const row = item(page, /^Delete/);
    await expect(row).toBeDisabled();
    await expect(row).toBeFocused();
    await page.keyboard.press("ArrowDown"); // the only row: it stays
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(context(page)).toHaveCount(1);
    await expect(undo(page)).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("a press that turns into a drag moves the corner and never opens the sheet", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "", "advanced");
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const at = await grab(page, "circle.ed-point", "point");
    // record any context sheet that shows at any time during the press
    await page.evaluate(() => {
      (window as unknown as { sawContext: boolean }).sawContext = false;
      new MutationObserver(() => {
        if (document.querySelector("section.phone-sheet-context")) (window as unknown as { sawContext: boolean }).sawContext = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await t.down(at);
    await rest(200);
    await t.move([[at[0] + 30, at[1] + 20]], 6);
    await rest(700); // held well past LONG_PRESS_MS, but moving already
    await t.up();
    expect(await page.evaluate(() => (window as unknown as { sawContext: boolean }).sawContext)).toBe(false);
    await expect(undo(page)).toBeEnabled(); // it was a drag
    expect(errors).toEqual([]);
  });

  test("a still press in Advanced moves nothing before the long press, and the browser's menu never opens over the plan", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "", "advanced");
    const t = await Touch.on(page);
    await pinchIn(page, t);
    const at = await grab(page, "circle.ed-point", "point");
    // a finger wobbles within the slop: still a long press, and the point stays put
    await t.down(at);
    await t.move([[at[0] + 3, at[1] + 2]], 3);
    await rest(HOLD);
    // Chrome on Android fires contextmenu during a long press: no browser menu, and the point's own handler ignores it
    // from a finger (ADR 0005; undo stays disabled). The floor below is what proves the plan itself cancels it
    const prevented = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)!;
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, at);
    expect(prevented).toBe(true);
    await t.up();
    await expect(context(page)).toHaveCount(1);
    await expect(undo(page)).toBeDisabled();
    // and on the floor too
    await context(page).getByRole("button", { name: "Close" }).tap();
    const floor = await emptyFloor(page);
    const onFloor = await page.evaluate(([x, y]) => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
      document.elementFromPoint(x, y)!.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, floor);
    expect(onFloor).toBe(true);
    // the plan never raises the text-selection callout
    const css = await page.locator(".designer-phone-edit .designer-plan").evaluate((el) => {
      const s = getComputedStyle(el);
      return { callout: s.getPropertyValue("-webkit-touch-callout"), select: s.userSelect || s.getPropertyValue("-webkit-user-select") };
    });
    expect(css.select).toBe("none");
    expect(errors).toEqual([]);
  });

  // #147: Make hairpin is in the Advanced selection sheet too, not only behind a long press
  test.describe("the Advanced selection sheet's Make hairpin", () => {
    const sheet = (page: Page) => page.locator("section.phone-sheet-selection");
    const hairpin = (page: Page) => sheet(page).getByRole("button", { name: /^Make hairpin/ });

    test("on a corner point: one tap makes the hairpin, one undo step", async ({ page }) => {
      const errors = await serve(page);
      await open(page, "", "advanced");
      const t = await Touch.on(page);
      await pinchIn(page, t);
      const n = await pointCount(page);
      await t.tap(await grab(page, "circle.ed-point", "point"));
      await expect(sheet(page)).toHaveCount(1);
      await expect(hairpin(page)).toBeEnabled();
      await shot(page, "375-selection-hairpin");
      await hairpin(page).tap();
      await expect.poll(() => pointCount(page)).toBe(n + 1);
      await undo(page).tap();
      await expect.poll(() => pointCount(page)).toBe(n);
      await expect(undo(page)).toBeDisabled();
      expect(errors).toEqual([]);
    });

    test("on a straight: disabled, with the reason, as in the context sheet", async ({ page }) => {
      // a point half way along the east straight (from the last corner back to the first)
      const pts = doc.design.points;
      const a = pts[pts.length - 1], b = pts[0];
      const straight = { ...doc, design: { ...doc.design, points: [...pts, { x: a.x, z: (a.z + b.z) / 2, radius: 1, width: 2 }] } };
      const errors = await serve(page, straight);
      await open(page, "", "advanced");
      const t = await Touch.on(page);
      const n = await pointCount(page);
      await t.tap(await grab(page, `circle.ed-point[data-index="${pts.length}"]`, "point"));
      await expect(sheet(page)).toHaveCount(1);
      await expect(sheet(page).locator("h2")).toHaveText(`Corner point ${pts.length + 1}`);
      await expect(hairpin(page)).toBeDisabled();
      await expect(hairpin(page)).toHaveAccessibleDescription("On a straight: there's no turn to make a hairpin of.");
      await expect(sheet(page)).toContainText("On a straight: there's no turn to make a hairpin of.");
      // and the context sheet says the same
      await sheet(page).getByRole("button", { name: "Close" }).tap();
      await longPress(page, t, await grab(page, `circle.ed-point[data-index="${pts.length}"]`, "point"));
      await expect(item(page, /^Make hairpin/)).toBeDisabled();
      await expect(item(page, /^Make hairpin/)).toContainText("On a straight: there's no turn to make a hairpin of.");
      expect(await pointCount(page)).toBe(n);
      expect(errors).toEqual([]);
    });

    test("Quick has no Make hairpin row", async ({ page }) => {
      const errors = await serve(page);
      await open(page, "", "quick");
      const t = await Touch.on(page);
      await pinchIn(page, t);
      await t.tap(await grab(page, "g.ed-corner", "point"));
      await expect(sheet(page)).toHaveCount(1);
      await expect(hairpin(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});
