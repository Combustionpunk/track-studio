// The 3D view on the track page (#83): every reference and fixture layout renders with no errors; the 2D / 3D switch,
// Reset view and Top view work with mouse, touch and keyboard; the loading skeleton takes the plan's place; without
// WebGL the 2D plan stays. The page's API calls are answered from the fixture, so only Vite is needed.
// SHOTS=<dir> saves screenshots there.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

type XY = [number, number];
const SHOTS = process.env.SHOTS;
const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const EXAMPLES = dir("../../../reference/examples/");
const EXTRA = dir("../../../packages/engine/test/fixtures/extra/");
const files = [
  ...readdirSync(EXAMPLES).filter((f) => f.endsWith(".rctrack.json")).map((f) => EXAMPLES + f),
  ...readdirSync(EXTRA).filter((f) => f.endsWith(".rctrack.json")).map((f) => EXTRA + f),
];
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const fixture = (name: string) => load(`${EXTRA}${name}.rctrack.json`);
const example = (name: string) => load(`${EXAMPLES}${name}.rctrack.json`);

function response(doc: { id: string; info: { name: string } }) {
  const now = "2026-11-05T12:00:00Z";
  return {
    track: {
      id: doc.id, name: doc.info.name, status: "approved", author: { id: "u1", username: "alice", name: "Alice" },
      revision: 1, approvedRevision: 1, publicRevision: 1, newerRevision: null, errors: 0, derivedFrom: null,
      latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: { length: 0, width: 0 }, footprint: { width: 0, height: 0 },
      venue: null, venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
    },
    doc,
    can: {},
  };
}

/** Answer the track page's API calls from `doc`; collect page errors and console errors. */
async function serve(page: Page, doc: { id: string; info: { name: string } }) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === `/api/tracks/${doc.id}` ? route.fulfill({ json: response(doc) }) : route.fulfill({ status: 404, json: { error: "not found" } });
  });
  return errors;
}

const view3d = (page: Page) => page.locator(".plan3d");
const camera = (page: Page) => view3d(page).getAttribute("data-camera");
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
};

async function open3d(page: Page, id: string) {
  await page.goto(`/t/${id}`);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
}

test.describe("every layout renders in 3D", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "once is enough"));
  for (const f of files) {
    const name = f.split("/").pop()!.replace(".rctrack.json", "");
    test(name, async ({ page }) => {
      const doc = load(f);
      const errors = await serve(page, doc);
      await open3d(page, doc.id);
      expect(Number(await view3d(page).getAttribute("data-triangles"))).toBeGreaterThan(10);
      if (name === "crossover-figure8") await shot(page, "6-crossover-figure8");
      expect(errors).toEqual([]);
    });
  }
});

test.describe("2D / 3D on the track page", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "mouse and keyboard"));

  for (const width of [1200, 375]) {
    test(`${width} px: 2D is the default; 3D is remembered for the session; Reset view and Top view move the camera`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      const doc = example("club-a");
      const errors = await serve(page, doc);
      await page.goto(`/t/${doc.id}`);
      await expect(page.locator("svg.plan-svg")).toBeVisible();
      await expect(page.getByRole("button", { name: "2D", exact: true })).toHaveAttribute("aria-pressed", "true");
      await shot(page, "1-plan-2d");

      await open3d(page, doc.id);
      const home = await camera(page);
      await expect(page.getByRole("button", { name: "Racing line" })).toHaveAttribute("aria-pressed", "false");
      await shot(page, "2-3d-home");

      // orbit with the mouse
      const box = (await view3d(page).boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 - 40, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => camera(page)).not.toBe(home);
      await shot(page, "2b-3d-orbited");
      await page.getByRole("button", { name: "Reset view" }).click();
      await expect.poll(() => camera(page)).toBe(home);

      await page.getByRole("button", { name: "Top view" }).click();
      await expect.poll(async () => Math.abs(Number((await camera(page))!.split(" ")[0]))).toBeLessThan(0.01);
      const [x, y, z] = (await camera(page))!.split(" ").map(Number);
      expect(Math.abs(x)).toBeLessThan(0.01);
      expect(Math.abs(z)).toBeLessThan(0.05);
      expect(y).toBeGreaterThan(5);
      await page.getByRole("button", { name: "Racing line" }).click();
      await expect(page.getByRole("button", { name: "Racing line" })).toHaveAttribute("aria-pressed", "true");
      await shot(page, "3-3d-top-line");

      // the choice outlives a reload (sessionStorage)
      await page.reload();
      await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
      await expect(page.getByRole("button", { name: "3D", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "2D", exact: true }).click();
      await expect(page.locator("svg.plan-svg")).toBeVisible();
      await expect(view3d(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("keyboard: Tab to the switch, Enter opens 3D; in the view, + zooms, arrows pan, 0 resets; focus is visible", async ({ page }) => {
    const doc = example("freeform-example");
    await serve(page, doc);
    await page.goto(`/t/${doc.id}`);
    const sw = page.getByRole("button", { name: "3D", exact: true });
    await sw.focus();
    await page.keyboard.press("Enter");
    await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
    const home = await camera(page);

    await view3d(page).focus();
    await expect(view3d(page)).toBeFocused();
    const outline = await view3d(page).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");
    await page.keyboard.press("+");
    await expect.poll(() => camera(page)).not.toBe(home);
    const zoomed = (await camera(page))!.split(" ").map(Number);
    expect(Math.hypot(...zoomed)).toBeLessThan(Math.hypot(...home!.split(" ").map(Number)));
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => camera(page)).not.toBe(zoomed.map((v) => v.toFixed(2)).join(" "));
    await page.keyboard.press("0");
    await expect.poll(() => camera(page)).toBe(home);

    // Tab reaches the view's buttons; Enter on Top view works; its focus ring shows
    const top = page.getByRole("button", { name: "Top view" });
    await top.focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => Math.abs(Number((await camera(page))!.split(" ")[0]))).toBeLessThan(0.01);
    expect(await top.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
  });

  test("loading: a skeleton holds the plan's place, so nothing shifts", async ({ page }) => {
    const doc = example("club-a");
    await serve(page, doc);
    await page.goto(`/t/${doc.id}`);
    const plan = (await page.locator(".track-plan").first().boundingBox())!;
    // hold the 3D code back a moment
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(/Viewer3D/, async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("button", { name: "3D", exact: true }).click();
    const skeleton = page.locator(".ts-skeleton.track-plan");
    await expect(skeleton).toBeVisible();
    expect(await skeleton.boundingBox()).toEqual(plan);
    await shot(page, "4-loading");
    release();
    await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
    expect(await view3d(page).boundingBox()).toEqual(plan);
  });

  test("no WebGL: a short message, and the 2D plan stays", async ({ page }) => {
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return /webgl/.test(type) ? null : (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof get;
    });
    const doc = example("club-a");
    const errors = await serve(page, doc);
    await page.goto(`/t/${doc.id}`);
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "The 3D view needs WebGL" })).toBeVisible();
    await expect(page.locator("svg.plan-svg")).toBeVisible();
    await expect(view3d(page)).toHaveCount(0);
    await shot(page, "5-no-webgl");
    expect(errors).toEqual([]);
  });
});

test.describe("touch", () => {
  test.beforeEach(({}, info) => test.skip(!info.project.name.startsWith("tablet"), "touch only"));

  test("taps switch to 3D and press the buttons; one finger orbits, two fingers pinch", async ({ page }) => {
    const doc = fixture("crossover-figure8");
    await serve(page, doc);
    await page.goto(`/t/${doc.id}`);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, pts: XY[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const centre = async (sel: ReturnType<Page["locator"]>): Promise<XY> => {
      const b = (await sel.boundingBox())!;
      return [b.x + b.width / 2, b.y + b.height / 2];
    };
    const tap = async (at: XY) => {
      await touch("touchStart", [at]);
      await touch("touchEnd", []);
    };
    /** fingers from `from` to `to`, resting before lifting (a lift mid-movement is a fling) */
    const drag = async (from: XY[], to: XY[]) => {
      await touch("touchStart", from);
      for (let k = 1; k <= 8; k++) await touch("touchMove", from.map(([x, y], i) => [x + ((to[i][0] - x) * k) / 8, y + ((to[i][1] - y) * k) / 8] as XY));
      await page.waitForTimeout(120);
      await touch("touchMove", to);
      await touch("touchEnd", []);
    };

    await tap(await centre(page.getByRole("button", { name: "3D", exact: true })));
    await expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
    const home = (await camera(page))!;
    const [cx, cy] = await centre(view3d(page));
    await drag([[cx, cy]], [[cx + 150, cy + 30]]);
    await expect.poll(() => camera(page)).not.toBe(home);
    const orbited = (await camera(page))!;
    // pinch out: closer
    await drag([[cx - 40, cy], [cx + 40, cy]], [[cx - 140, cy], [cx + 140, cy]]);
    await expect.poll(() => camera(page)).not.toBe(orbited);
    const pinched = (await camera(page))!.split(" ").map(Number);
    expect(Math.hypot(...pinched)).toBeLessThan(Math.hypot(...orbited.split(" ").map(Number)));

    await tap(await centre(page.getByRole("button", { name: "Reset view" })));
    await expect.poll(() => camera(page)).toBe(home);
    await tap(await centre(page.getByRole("button", { name: "Top view" })));
    await expect.poll(async () => Math.abs(Number((await camera(page))!.split(" ")[0]))).toBeLessThan(0.01);
    await tap(await centre(page.getByRole("button", { name: "2D", exact: true })));
    await expect(page.locator("svg.plan-svg")).toBeVisible();
  });
});
