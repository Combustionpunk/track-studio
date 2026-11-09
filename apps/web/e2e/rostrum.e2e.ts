// The rostrum view in the 3D viewer (#84): ?view=rostrum&side=w opens there; the N / E / S / W picker works with
// mouse, touch and keyboard (focus visible, side announced); at the rostrum, looking around turns the head and zoom
// narrows the field of view, the camera doesn't move; Back to orbit returns to the free camera; the default side is the
// drawn-for venue's rostrum, else south. API calls are answered from fixtures, so only Vite is needed.
// SHOTS=<dir> saves screenshots there.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

type XY = [number, number];
const SHOTS = process.env.SHOTS;
const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const example = (name: string) => load(dir(`../../../reference/examples/${name}.rctrack.json`));
const venueFile = (name: string) => load(dir(`../../../reference/venues/${name}.rcvenue.json`));

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

/** Answer the track page's API calls from `doc` (and `venues` by id); collect page errors and console errors. */
async function serve(page: Page, doc: { id: string; info: { name: string } }, venues: { id: string }[] = []) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const v = venues.find((x) => path === `/api/venues/${x.id}`);
    if (v) return route.fulfill({ json: { venue: { id: v.id }, doc: v, can: {} } });
    return path === `/api/tracks/${doc.id}` ? route.fulfill({ json: response(doc) }) : route.fulfill({ status: 404, json: { error: "not found" } });
  });
  return errors;
}

const view3d = (page: Page) => page.locator(".plan3d");
const camera = (page: Page) => view3d(page).getAttribute("data-camera");
const look = (page: Page) => view3d(page).getAttribute("data-look");
const fov = async (page: Page) => Number(await view3d(page).getAttribute("data-fov"));
const ready = (page: Page) => expect(view3d(page)).toHaveAttribute("data-ready", "1", { timeout: 20_000 });
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
};

/** Where the eyes are on each side of club-a's 22 × 12 m area, as data-camera writes it (three.js: x, y up, z south). */
const EYES = { north: "0.00 2.80 -7.50", east: "12.50 2.80 0.00", south: "0.00 2.80 7.50", west: "-12.50 2.80 0.00" } as const;
type SideName = keyof typeof EYES;

test.describe("rostrum view with mouse and keyboard", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "mouse and keyboard"));

  for (const width of [1200, 375]) {
    test(`${width} px: ?view=rostrum&side=w opens in the rostrum view on the west side`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      const doc = example("club-a");
      const errors = await serve(page, doc);
      await page.goto(`/t/${doc.id}?view=rostrum&side=w`);
      await ready(page);
      await expect(view3d(page)).toHaveAttribute("data-view", "rostrum");
      await expect.poll(() => camera(page)).toBe(EYES.west);
      await expect(page.getByRole("button", { name: "3D", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Rostrum west" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("status").filter({ hasText: "Rostrum view from the west side" })).toBeAttached();
      await expect(page.getByRole("img", { name: /from the rostrum on the west side$/ })).toBeVisible();
      await shot(page, "rostrum-west");
      expect(errors).toEqual([]);
    });
  }

  test("the picker with the mouse: each side; drag looks around and the wheel zooms, from the same spot; Back to orbit", async ({ page }) => {
    const doc = example("club-a");
    const errors = await serve(page, doc);
    await page.goto(`/t/${doc.id}`);
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await ready(page);
    const home = await camera(page);
    await expect(view3d(page)).toHaveAttribute("data-view", "orbit");
    await shot(page, "rostrum-0-orbit");

    for (const side of ["north", "east", "south", "west"] as SideName[]) {
      await page.getByRole("button", { name: `Rostrum ${side}` }).click();
      await expect.poll(() => camera(page)).toBe(EYES[side]);
      await expect(page.getByRole("button", { name: `Rostrum ${side}` })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("status").filter({ hasText: `Rostrum view from the ${side} side` })).toBeAttached();
      expect(new URL(page.url()).searchParams.get("view")).toBe("rostrum");
      expect(new URL(page.url()).searchParams.get("side")).toBe(side[0]);
      await shot(page, `rostrum-${side}`);
    }

    // at the rostrum (west), drag turns the head, the camera stays put
    const before = await look(page);
    const box = (await view3d(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => look(page)).not.toBe(before);
    expect(await camera(page)).toBe(EYES.west);

    // the wheel narrows the field of view; the camera stays put
    const wide = await fov(page);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => fov(page)).toBeLessThan(wide);
    expect(await camera(page)).toBe(EYES.west);

    // the zoom buttons too
    const narrower = await fov(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => fov(page)).toBeLessThan(narrower);
    expect(await camera(page)).toBe(EYES.west);

    await page.getByRole("button", { name: "Back to orbit" }).click();
    await expect(view3d(page)).toHaveAttribute("data-view", "orbit");
    await expect.poll(() => camera(page)).toBe(home);
    expect(await fov(page)).toBe(45);
    expect(new URL(page.url()).searchParams.get("view")).toBeNull();
    // the orbit camera works again, and the rostrum stays on the side picked
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => camera(page)).not.toBe(home);
    expect(new URL(page.url()).searchParams.get("side")).toBe("w");
    expect(errors).toEqual([]);
  });

  test("keyboard: Tab to the picker, Enter stands there; arrows look around, + zooms, Escape goes back; focus is visible", async ({ page }) => {
    const doc = example("club-a");
    await serve(page, doc);
    await page.goto(`/t/${doc.id}`);
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await ready(page);
    const home = await camera(page);

    const east = page.getByRole("button", { name: "Rostrum east" });
    await page.getByRole("button", { name: "Racing line" }).focus();
    await page.keyboard.press("Tab"); // the picker follows the toolbar
    await expect(page.getByRole("button", { name: "Rostrum north" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(east).toBeFocused();
    expect(await east.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect.poll(() => camera(page)).toBe(EYES.east);
    await expect(page.getByRole("status").filter({ hasText: "Rostrum view from the east side" })).toBeAttached();

    const stage = page.getByRole("img", { name: /from the rostrum on the east side$/ });
    await stage.focus();
    const before = await look(page);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => look(page)).not.toBe(before);
    expect(await camera(page)).toBe(EYES.east);
    const wide = await fov(page);
    await page.keyboard.press("+");
    await expect.poll(() => fov(page)).toBeLessThan(wide);
    expect(await camera(page)).toBe(EYES.east);
    await page.keyboard.press("Escape");
    await expect(view3d(page)).toHaveAttribute("data-view", "orbit");
    await expect.poll(() => camera(page)).toBe(home);
  });

  test("the default side: the drawn-for venue's rostrum while the template exists, else south", async ({ page }) => {
    const club = venueFile("club-hall"); // rostrum north
    const doc = { ...example("club-a"), id: "drawn-for-club-hall" };
    doc.info = { ...doc.info, drawnFor: { venueTemplate: club.id, name: club.info.name } };
    await serve(page, doc, [club]);
    await page.goto(`/t/${doc.id}?view=rostrum`);
    await ready(page);
    await expect.poll(() => camera(page)).toBe(EYES.north);
    await expect(page.getByRole("button", { name: "Rostrum north" })).toHaveAttribute("aria-pressed", "true");

    const gone = { ...doc, id: "drawn-for-gone", info: { ...doc.info, drawnFor: { venueTemplate: "venue-deleted", name: "Gone" } } };
    await page.unrouteAll();
    await serve(page, gone);
    await page.goto(`/t/${gone.id}?view=rostrum`);
    await ready(page);
    await expect.poll(() => camera(page)).toBe(EYES.south);

    const none = { ...example("club-a"), id: "drawn-for-none" };
    await page.unrouteAll();
    await serve(page, none);
    await page.goto(`/t/${none.id}?view=rostrum`);
    await ready(page);
    await expect.poll(() => camera(page)).toBe(EYES.south);
  });
});

test.describe("rostrum view by touch", () => {
  test.beforeEach(({}, info) => test.skip(!info.project.name.startsWith("tablet"), "touch only"));

  test("tap a side; one finger looks around, a pinch zooms, from the same spot; tap Back to orbit", async ({ page }) => {
    const doc = example("club-a");
    await serve(page, doc);
    await page.goto(`/t/${doc.id}`);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", pts: XY[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
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
    await ready(page);
    const home = (await camera(page))!;
    await tap(await centre(page.getByRole("button", { name: "Rostrum south" })));
    await expect.poll(() => camera(page)).toBe(EYES.south);
    await expect(page.getByRole("button", { name: "Rostrum south" })).toHaveAttribute("aria-pressed", "true");

    const [cx, cy] = await centre(view3d(page));
    const before = await look(page);
    await drag([[cx, cy]], [[cx + 150, cy + 30]]);
    await expect.poll(() => look(page)).not.toBe(before);
    expect(await camera(page)).toBe(EYES.south);

    const wide = await fov(page);
    await drag([[cx - 40, cy], [cx + 40, cy]], [[cx - 140, cy], [cx + 140, cy]]); // pinch out: zoom in
    await expect.poll(() => fov(page)).toBeLessThan(wide);
    expect(await camera(page)).toBe(EYES.south);

    await tap(await centre(page.getByRole("button", { name: "Back to orbit" })));
    await expect(view3d(page)).toHaveAttribute("data-view", "orbit");
    await expect.poll(() => camera(page)).toBe(home);
  });
});
