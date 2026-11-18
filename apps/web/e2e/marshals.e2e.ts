// Marshal points (#151): numbered cones on a layout. In the designer a cone is added by dragging it from the palette
// onto the plan (or by picking Cone and clicking / tapping the plan), dragged to move, renumbered from its panel or
// sheet (the phone's long-press context sheet has Change number) and deleted like a jump; every action is one undo
// step. The plan and the 3D preview draw the cones; the build sheet lists them. Desktop (1200 × 860, a mouse) and the
// phone (375 × 812, touch). SHOTS=<dir> saves screenshots for the PR.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { doc, emptyFloor, open, planBox, serve, shot, toolBtn, withCones } from "./phone-helper.js";
import { screen, Touch, type XY } from "./touch-helper.js";

// SHOTS_SCHEME=dark: screenshots in Pit Lane (headless Chromium prefers light, which gives Pit Lane light)
test.beforeEach(async ({ page }) => {
  if (process.env.SHOTS_SCHEME === "dark") await page.emulateMedia({ colorScheme: "dark" });
});

const rest = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const HOLD = 700; // LONG_PRESS_MS (500) and some
const cones = (page: Page) => page.locator("svg.plan-svg g.ed-marshal");
const numbers = (page: Page) => cones(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-number"))));
/** cone i's spot in plan coordinates, from its handle */
const coneAt = (page: Page, i: number) =>
  cones(page).nth(i).locator(".ed-hit").evaluate((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!] as [number, number]);
/** where to put a finger or the mouse on it, once it has stopped moving (a sheet slides in) */
const centre = async (l: Locator): Promise<XY> => {
  await l.click({ trial: true });
  const b = (await l.boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};
test.describe("marshal points on a laptop", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "a laptop with a mouse"));

  test("drag a cone from the palette onto the plan; pick Cone and click for the next; numbers 1, 2", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await expect(cones(page)).toHaveCount(0);
    const button = page.getByRole("button", { name: "Cone", exact: true });
    await expect(button).toBeVisible();
    // drag and drop: press on Cone, move onto the floor, let go
    const from = await centre(button);
    const to = await emptyFloor(page);
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(from[0] + 30, from[1], { steps: 3 });
    await page.mouse.move(...to, { steps: 10 });
    await expect(page.locator(".cone-drag-ghost")).toBeVisible();
    await page.mouse.up();
    await expect(page.locator(".cone-drag-ghost")).toHaveCount(0);
    await expect(cones(page)).toHaveCount(1);
    expect(await numbers(page)).toEqual([1]);
    // the new cone is selected: its panel, and the plan draws it with its number
    await expect(page.getByRole("heading", { name: "Cone 1" })).toBeVisible();
    await expect(page.locator(".plan-drawing g.p-marshal")).toHaveCount(1);
    await expect(page.locator(".plan-drawing .p-marshal-number")).toHaveText(["1"]);
    // the drop isn't a click: Cone isn't left armed
    await expect(button).toHaveAttribute("aria-pressed", "false");
    // pick Cone, then click: the next cone takes number 2
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".designer-hint")).toContainText("Click where a marshal stands");
    const spot = await screen(page, -11.8, 0); // the hall's west edge, 0.3 m outside the area
    await page.mouse.click(...spot);
    await expect(cones(page)).toHaveCount(2);
    expect(await numbers(page)).toEqual([1, 2]);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    const [x, z] = await coneAt(page, 1);
    expect(x).toBeCloseTo(-11.8, 0);
    expect(z).toBeCloseTo(0, 0);
    // one undo step each
    await page.keyboard.press("Control+z");
    await expect(cones(page)).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await expect(cones(page)).toHaveCount(0);
    await page.keyboard.press("Control+y");
    await expect(cones(page)).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("drag a cone to move it (no further than 2 m outside the area), renumber it from its panel, Delete removes it; each undoes in one step", async ({ page }) => {
    const errors = await serve(page, { ...doc, design: { ...doc.design, marshals: [{ number: 1, x: -11.8, z: 0 }] } });
    await open(page);
    await expect(cones(page)).toHaveCount(1);
    // move: onto the floor, then far off past the area's west edge (it stops 2 m out)
    const grab = await centre(cones(page).first().locator(".ed-hit"));
    const to = await emptyFloor(page);
    await page.mouse.move(...grab);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 10 });
    await page.mouse.up();
    const moved = await coneAt(page, 0);
    // zoomed out, so the plan shows past the 2 m limit
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await rest(300);
    expect(Math.hypot(moved[0] + 11.8, moved[1])).toBeGreaterThan(1);
    await expect(page.getByRole("heading", { name: "Cone 1" })).toBeVisible();
    await page.mouse.move(...(await centre(cones(page).first().locator(".ed-hit"))));
    await page.mouse.down();
    // as far west as the page goes (the plan shows the 2.5 m margin), past the 2 m limit
    const west = await screen(page, -14.9, moved[1]);
    await page.mouse.move(Math.max(1, west[0]), west[1], { steps: 10 });
    await page.mouse.up();
    const far = await coneAt(page, 0);
    expect(far[0]).toBeCloseTo(-12.5 - 2, 5); // Sports hall B: 25 m east-west, so 2 m beyond x = -12.5
    await page.keyboard.press("Control+z");
    await expect.poll(() => coneAt(page, 0)).toEqual(moved);
    // renumber: the panel's stepper; the cone stays where it is
    const panel = page.locator(".sel-panel");
    await cones(page).first().locator(".ed-hit").click();
    await panel.getByRole("button", { name: "Higher number" }).click();
    await panel.getByRole("button", { name: "Higher number" }).click();
    await expect(page.getByRole("heading", { name: "Cone 3" })).toBeVisible();
    expect(await numbers(page)).toEqual([3]);
    expect(await coneAt(page, 0)).toEqual(moved);
    await expect(page.locator(".plan-drawing .p-marshal-number")).toHaveText(["3"]);
    await page.keyboard.press("Control+z");
    expect(await numbers(page)).toEqual([2]);
    // Delete removes the selected cone; Undo brings it back
    await page.keyboard.press("Delete");
    await expect(cones(page)).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(cones(page)).toHaveCount(1);
    // and the panel's Delete cone button
    await cones(page).first().locator(".ed-hit").click();
    await panel.getByRole("button", { name: "Delete cone" }).click();
    await expect(cones(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the reference layout's cones: the plan and its checks, the 3D preview", async ({ page }) => {
    const errors = await serve(page, withCones);
    await open(page, "", "advanced");
    await expect(page.locator(".plan-drawing g.p-marshal")).toHaveCount(5);
    await expect(page.locator(".plan-drawing .p-marshal-number")).toHaveText(["1", "2", "2", "4", "6"]);
    // the untidy set's checks: on the track, a repeat, the gaps
    const checks = page.locator(".checks-panel");
    await expect(checks).toContainText("Cone 4 is on the track");
    await expect(checks).toContainText("Two cones are numbered 2");
    await expect(checks).toContainText("No cone 3: with 3 marshals, cone 4 is manned and 3 is empty");
    await shot(page, "1200-plan");
    await page.locator(".designer-viewswitch").getByRole("button", { name: "3D", exact: true }).click();
    const v = page.locator(".plan3d");
    await expect(v).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
    await expect(v).toHaveAttribute("data-parts", /\bcone\b.*\bconePlate\b.*\bconeNumber\b/);
    await shot(page, "1200-3d");
    expect(errors).toEqual([]);
  });

  test("the build sheet lists the cones in fill order, with where each stands, and still prints on one page", async ({ page }) => {
    const id = withCones.id;
    const now = "2026-11-17T12:00:00Z";
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path !== `/api/tracks/${id}`) return route.fulfill({ status: 404, json: { error: "not found" } });
      return route.fulfill({
        json: {
          track: {
            id, name: withCones.info.name, status: "draft", author: { id: "u1", username: "alice", name: "Alice" }, revision: 1, approvedRevision: null, publicRevision: 1, newerRevision: null,
            errors: 1, derivedFrom: null, latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: withCones.area, footprint: { width: 0, height: 0 }, venue: null,
            venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
          },
          doc: withCones,
          can: {},
        },
      });
    });
    await page.goto(`/t/${id}/build`);
    const table = page.locator("table.sheet-marshal-table");
    await expect(table.locator("caption")).toHaveText("Marshal points");
    await expect(table.locator("tbody td.no")).toHaveText(["1", "2", "2", "4", "6"]);
    await expect(table.locator("tbody tr").nth(3)).toContainText("on the track");
    await expect(table.locator("tbody tr").first()).toContainText(/corner \d+|straight/);
    await expect(page.locator(".sheet-plan g.p-marshal")).toHaveCount(5);
    await page.emulateMedia({ media: "print" });
    const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
    expect(pdf.match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(1);
  });
});

test.describe("marshal points on a phone", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("drag a cone from the Jump sheet onto the plan; or tap Cone, then the plan; one undo step each", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await toolBtn(page, "Jump").tap();
    const s = page.getByRole("dialog", { name: "Jumps" });
    const chip = s.getByRole("button", { name: "Cone", exact: true });
    await expect(chip).toBeVisible();
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, "375-jump-sheet");
    // a finger on Cone, dragged up onto the plan above the sheet
    const from = await centre(chip);
    const plan = await planBox(page);
    const to: XY = [plan.x + plan.width / 2, plan.y + 140];
    await t.down(from);
    await t.move([[from[0], from[1] - 20]], 3);
    await t.move([to], 10);
    await t.up();
    await expect(cones(page)).toHaveCount(1);
    expect(await numbers(page)).toEqual([1]);
    // the new cone's sheet, with its number stepper (Delete is on the toolbar)
    const cs = page.getByRole("dialog", { name: "Cone 1" });
    await expect(cs).toBeVisible();
    await expect(cs.getByRole("group", { name: "Cone number" })).toBeVisible();
    await expect(toolBtn(page, "Delete")).toBeEnabled();
    await shot(page, "375-cone-sheet");
    // tap Cone, then the plan: by the north wall, 0.9 m beyond the lane
    await toolBtn(page, "Jump").tap();
    await page.getByRole("dialog", { name: "Jumps" }).getByRole("button", { name: "Cone", exact: true }).tap();
    await expect(page.locator(".designer-hint")).toContainText("Tap where a marshal stands");
    await expect(toolBtn(page, "Jump")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("section.bottom-sheet")).toHaveCount(0);
    await rest(300);
    await t.tap(await screen(page, 0, 6.5));
    await expect(cones(page)).toHaveCount(2);
    expect(await numbers(page)).toEqual([1, 2]);
    const [x, z] = await coneAt(page, 1);
    expect(Math.hypot(x, z - 6.5)).toBeLessThan(0.2);
    await toolBtn(page, "Undo").tap();
    await expect(cones(page)).toHaveCount(1);
    await toolBtn(page, "Undo").tap();
    await expect(cones(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("drag a cone to move it; hold it: Change number and Delete in its context sheet; the toolbar's Delete; Undo", async ({ page }) => {
    // a cone in the infield, near the middle of the plan (freeform-example's cone 1, adapted to the hall)
    const errors = await serve(page, { ...doc, design: { ...doc.design, marshals: [{ number: 1, x: 5.44, z: 1.14 }] } });
    await open(page);
    const t = await Touch.on(page);
    await rest(300);
    const handle = cones(page).first().locator(".ed-hit");
    // move it with a finger
    const before = await coneAt(page, 0);
    const at = await centre(handle);
    await t.drag([at, [at[0] + 40, at[1] + 30]], 8);
    await expect.poll(() => coneAt(page, 0)).not.toEqual(before);
    await toolBtn(page, "Undo").tap();
    await expect.poll(() => coneAt(page, 0)).toEqual(before);
    // hold it: its context sheet; Change number opens its sheet with the stepper
    await t.hold(await centre(handle), HOLD);
    await t.up();
    const ctx = page.locator("section.phone-sheet-context");
    await expect(ctx.getByRole("menuitem", { name: "Change number" })).toBeVisible();
    await expect(ctx.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
    await shot(page, "375-cone-context");
    await ctx.getByRole("menuitem", { name: "Change number" }).tap();
    const cs = page.getByRole("dialog", { name: "Cone 1" });
    await expect(cs).toBeVisible();
    await cs.getByRole("button", { name: "Higher number" }).tap();
    await expect(page.getByRole("dialog", { name: "Cone 2" })).toBeVisible();
    expect(await numbers(page)).toEqual([2]);
    expect(await coneAt(page, 0)).toEqual(before); // renumbering never moves it
    // Delete from the context sheet, then Undo
    await t.hold(await centre(handle), HOLD);
    await t.up();
    await page.locator("section.phone-sheet-context").getByRole("menuitem", { name: "Delete" }).tap();
    await expect(cones(page)).toHaveCount(0);
    await toolBtn(page, "Undo").tap();
    await expect(cones(page)).toHaveCount(1);
    expect(await numbers(page)).toEqual([2]);
    // the toolbar's Delete, for the selected cone
    await t.tap(await centre(cones(page).first().locator(".ed-hit")));
    await expect(toolBtn(page, "Delete")).toBeEnabled();
    await toolBtn(page, "Delete").tap();
    await expect(cones(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the plan and the 3D preview show the layout's cones", async ({ page }) => {
    const errors = await serve(page, withCones);
    await open(page, "?phone3d=1");
    await expect(page.locator(".plan-drawing g.p-marshal")).toHaveCount(5);
    await shot(page, "375-plan");
    await toolBtn(page, "3D").tap();
    const v = page.locator(".plan3d");
    await expect(v).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
    await expect(v).toHaveAttribute("data-parts", /\bcone\b.*\bconePlate\b.*\bconeNumber\b/);
    await shot(page, "375-3d");
    expect(errors).toEqual([]);
  });
});
