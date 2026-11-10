// The 3D preview in the designer (#85): the 2D / 3D switch in Quick and Advanced; 3D follows edits after the bake and
// its camera stays put (through a bake, and through going to 2D to edit and back); the selected jump is highlighted;
// the guide's obstacles are drawn; a click (or tap) on a jump selects it and goes back to 2D. The designer's API calls
// are answered from the reference files, so only Vite is needed. SHOTS=<dir> saves screenshots there.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { Touch, type XY } from "./touch-helper.js";

const SHOTS = process.env.SHOTS;
const REF = fileURLToPath(new URL("../../../reference/", import.meta.url));
const doc = JSON.parse(readFileSync(`${REF}examples/freeform-at-sports-hall-b.rctrack.json`, "utf8"));
const hall = JSON.parse(readFileSync(`${REF}venues/sports-hall-b.rcvenue.json`, "utf8"));
const ID = "t-3d";

/** Answer the edit page's API calls: the track (editable), its revision 1, and its venue; collect page errors. */
async function serve(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const now = "2026-11-10T12:00:00Z";
  const track = {
    id: ID, name: doc.info.name, status: "draft", author: { id: "u1", username: "alice", name: "Alice" }, revision: 1, approvedRevision: null, publicRevision: 1,
    newerRevision: null, errors: 0, derivedFrom: null, latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: hall.area, footprint: { width: 0, height: 0 },
    venue: null, venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/tracks/${ID}`) return route.fulfill({ json: { track, doc: { ...doc, id: ID, revision: 1 }, can: { edit: true } } });
    if (path === `/api/tracks/${ID}/r/1`) return route.fulfill({ json: { ...doc, id: ID, revision: 1 } });
    if (path === "/api/venues/venue-2") return route.fulfill({ json: { venue: { id: "venue-2", name: "Sports hall B" }, doc: hall } });
    if (path === "/api/venues") return route.fulfill({ json: { venues: [{ id: "venue-2", name: "Sports hall B" }] } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  return errors;
}

async function open(page: Page, mode: "Quick" | "Advanced") {
  await page.goto(`/t/${ID}/edit`);
  await page.evaluate(() => (localStorage.clear(), sessionStorage.clear()));
  await page.reload();
  await page.locator(".mode-toggle").getByRole("button", { name: mode }).click();
  await expect(page.locator("svg.plan-svg")).toBeVisible();
}

const view3d = (page: Page) => page.locator(".plan3d");
const switchTo = (page: Page, k: "2D" | "3D") => page.locator(".designer-viewswitch").getByRole("button", { name: k, exact: true }).click();
async function show3d(page: Page) {
  await switchTo(page, "3D");
  await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
}
/** Where a plan point (x, z, height) is on the screen, in 3D. */
const project = (page: Page, x: number, z: number, y = 0) =>
  view3d(page).evaluate((el, [x, z, y]) => (el as HTMLElement & { project3d: (x: number, z: number, y: number) => XY }).project3d(x, z, y), [x, z, y] as const);
/** Where a plan point is on the screen, in 2D. */
const onPlan = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => {
    const svg = document.querySelector("svg.plan-svg") as SVGSVGElement;
    const p = new DOMPoint(x, -z).matrixTransform(svg.getScreenCTM()!);
    return [p.x, p.y] as XY;
  }, [x, z]);
/** Plan positions of the jumps the 3D view draws. */
const jumps3d = async (page: Page) => ((await view3d(page).getAttribute("data-jumps")) ?? "").split(" ").map((s) => s.split(",").map(Number) as XY);
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
};

test.describe("mouse", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "mouse and keyboard"));

  for (const [mode, width] of [["Quick", 1200], ["Advanced", 1024]] as const) {
    test(`${mode}, ${width} px: 3D follows a jump moved in 2D, the camera stays put, a click on a jump selects it`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      const errors = await serve(page);
      await open(page, mode);
      await show3d(page);
      await expect(page.locator(".designer-hint")).toContainText("3D is view only");
      // the guide's obstacles are drawn, apart from the layout
      expect((await view3d(page).getAttribute("data-parts"))!.split(" ")).toContain("guide");
      await shot(page, `1-3d-${mode.toLowerCase()}`);

      // orbit somewhere of our own
      const box = (await view3d(page).boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 30, { steps: 8 });
      await page.mouse.up();
      const cam = await view3d(page).getAttribute("data-camera");
      const before = await jumps3d(page);

      // to 2D, drag the kicker 2 m along the track (it heads west), back to 3D: moved, and the camera where it was
      await switchTo(page, "2D");
      const k = doc.built.features[1];
      await page.mouse.move(...(await onPlan(page, k.x, k.z)));
      await page.mouse.down();
      await page.mouse.move(...(await onPlan(page, k.x - 2, k.z)), { steps: 10 });
      await page.mouse.up();
      await show3d(page);
      await expect.poll(async () => (await jumps3d(page))[1][0], { timeout: 10_000 }).toBeLessThan(before[1][0] - 1);
      expect((await jumps3d(page))[0]).toEqual(before[0]);
      expect(await view3d(page).getAttribute("data-camera")).toBe(cam);

      // undo in 3D: the bake moves it back, the camera doesn't move
      await view3d(page).locator(".plan3d-stage").focus();
      await page.keyboard.press("Control+z");
      await expect.poll(async () => (await jumps3d(page))[1], { timeout: 10_000 }).toEqual(before[1]);
      expect(await view3d(page).getAttribute("data-camera")).toBe(cam);

      // the selected jump is highlighted: click the tabletop in 3D, it's selected in 2D; back in 3D it's lit
      const t = doc.built.features[0];
      await page.mouse.click(...(await project(page, t.x, t.z, 0.1)));
      await expect(page.locator("svg.plan-svg")).toBeVisible();
      await expect(page.locator("polygon.ed-feature.on")).toHaveCount(1);
      await expect(page.locator("section.sel-panel")).toContainText("Tabletop");
      await show3d(page);
      await expect(view3d(page)).toHaveAttribute("data-highlight", "feature:0");
      await shot(page, `2-highlight-${mode.toLowerCase()}`);
      // a click on the floor selects nothing and stays in 3D
      await page.mouse.click(...(await project(page, -11, 6)));
      await expect(view3d(page)).toBeVisible();

      // the rostrum view is here too
      await page.getByRole("button", { name: "Rostrum south" }).click();
      await expect(view3d(page)).toHaveAttribute("data-view", "rostrum");
      await shot(page, `3-rostrum-${mode.toLowerCase()}`);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("touch", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "tablet-landscape", "a tablet in landscape"));

  test("Quick, 1024 px: tap 3D, orbit with a finger, tap a jump to select it", async ({ page }) => {
    const errors = await serve(page);
    await open(page, "Quick");
    const touch = await Touch.on(page);
    const tapButton = async (name: string) => {
      const b = (await page.locator(".designer-viewswitch").getByRole("button", { name, exact: true }).boundingBox())!;
      await touch.tap([b.x + b.width / 2, b.y + b.height / 2]);
    };
    await tapButton("3D");
    await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
    await expect(page.locator(".designer-hint")).toContainText("Tap a jump");
    await shot(page, "4-touch-3d");

    const box = (await view3d(page).boundingBox())!;
    const cam = await view3d(page).getAttribute("data-camera");
    await touch.drag([[box.x + box.width / 2, box.y + box.height / 2], [box.x + box.width / 2 + 90, box.y + box.height / 2 - 20]]);
    await expect.poll(() => view3d(page).getAttribute("data-camera")).not.toBe(cam);

    const kicker = doc.built.features[1];
    await touch.tap(await project(page, kicker.x, kicker.z, 0.1));
    await expect(page.locator("svg.plan-svg")).toBeVisible();
    await expect(page.locator(".designer-sheet")).toContainText("Kicker");
    await shot(page, "5-touch-picked");

    // and back to 3D: the camera where the finger left it, the kicker lit
    const moved = await view3d(page).count();
    expect(moved).toBe(0);
    await tapButton("3D");
    await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
    await expect(view3d(page)).toHaveAttribute("data-highlight", "feature:1");
    expect(errors).toEqual([]);
  });
});
