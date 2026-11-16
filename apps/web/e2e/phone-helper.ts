// Shared by the phone specs (#122, #123): the edit page's API answered from the reference files (so only Vite is
// needed), the track opened in the phone layout, and where the corners, the toolbar and the empty floor are.
// SHOTS=<dir> saves screenshots for the PR.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { screen, Touch, type XY } from "./touch-helper.js";

export const SHOTS = process.env.SHOTS;
export const REF = fileURLToPath(new URL("../../../reference/", import.meta.url));
export const doc = JSON.parse(readFileSync(`${REF}examples/freeform-at-sports-hall-b.rctrack.json`, "utf8"));
const hall = JSON.parse(readFileSync(`${REF}venues/sports-hall-b.rcvenue.json`, "utf8"));
export const ID = "t-phone";

/** what the stubbed API was asked to change: each save (PUT) and submit */
export interface Calls {
  saves: { note?: string; baseRevision: number; name: string }[];
  submits: number;
}

/** Answer the edit page's API calls, signed in as the author: the track (editable), its revisions, its venue, a save (a
 * new revision) and a submit; collect page errors. `calls` records the saves and submits. */
export async function serve(page: Page, served = doc, calls: Calls = { saves: [], submits: 0 }) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const now = "2026-11-12T12:00:00Z";
  const track = {
    id: ID, name: served.info.name, status: "draft", author: { id: "u1", username: "alice", name: "Alice" }, revision: 1, approvedRevision: null, publicRevision: 1,
    newerRevision: null, errors: 0, derivedFrom: null, latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: hall.area, footprint: { width: 0, height: 0 },
    venue: null, venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
  };
  let current = { ...served, id: ID, revision: 1 };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/me") return route.fulfill({ json: { id: 1, username: "alice", name: "Alice", avatarUrl: null, organiser: false, admin: false, moderator: false } });
    if (path === "/api/config") return route.fulfill({ json: { devLogin: false, forumUrl: "", baseUrl: "", organiserGroup: "organisers" } });
    if (path === `/api/tracks/${ID}` && method === "PUT") {
      const body = route.request().postDataJSON() as { track: typeof served; note?: string; baseRevision: number };
      calls.saves.push({ note: body.note, baseRevision: body.baseRevision, name: body.track.info.name });
      track.revision += 1;
      track.publicRevision = track.revision;
      track.name = body.track.info.name;
      current = { ...body.track, built: current.built, id: ID, revision: track.revision };
      return route.fulfill({ json: { track, doc: current, can: { edit: true, submit: track.status === "draft" } } });
    }
    if (path === `/api/tracks/${ID}/submit` && method === "POST") {
      calls.submits += 1;
      track.status = "submitted";
      return route.fulfill({ json: { ok: true } });
    }
    if (path === `/api/tracks/${ID}`) return route.fulfill({ json: { track, doc: current, can: { edit: true, submit: track.status === "draft" } } });
    if (path === `/api/tracks/${ID}/r/${track.revision}`) return route.fulfill({ json: current });
    if (path === "/api/venues/venue-2") return route.fulfill({ json: { venue: { id: "venue-2", name: "Sports hall B" }, doc: hall } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  return errors;
}

/** The track open in the designer, nothing kept from an earlier test; in Advanced mode if asked. */
export async function open(page: Page, search = "", mode: "quick" | "advanced" = "quick") {
  await page.goto(`/t/${ID}/edit${search}`);
  await page.evaluate((mode) => (localStorage.clear(), sessionStorage.clear(), mode === "advanced" && localStorage.setItem("designer-mode", JSON.stringify({ mode }))), mode);
  await page.reload();
  await expect(page.locator("svg.plan-svg")).toBeVisible();
  await page.waitForTimeout(200);
}

export async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await expect(page.locator(".pending")).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

export const viewBox = async (page: Page) => (await page.locator("svg.plan-svg").getAttribute("viewBox"))!.split(" ").map(Number);
/** corner points in plan coordinates, from their dots */
export const corners = (page: Page) =>
  page.locator("g.ed-corner .ed-corner-dot").evaluateAll((els) => els.map((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!] as XY));
export const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Designer tools" });
export const toolBtn = (page: Page, name: string) => toolbar(page).getByRole("button", { name, exact: true });
/** the plan's box on the screen */
export const planBox = async (page: Page) => (await page.locator("svg.plan-svg").boundingBox())!;

/** the corner whose dot is nearest the middle of the plan, and where it is on the screen */
export async function middleCorner(page: Page): Promise<{ i: number; at: XY }> {
  const b = await planBox(page);
  const mid: XY = [b.x + b.width / 2, b.y + b.height / 2];
  let best = { i: -1, at: [0, 0] as XY, d: Infinity };
  const pts = await corners(page);
  for (let i = 0; i < pts.length; i++) {
    const at = await screen(page, pts[i][0], pts[i][1]);
    const d = Math.hypot(at[0] - mid[0], at[1] - mid[1]);
    if (d < best.d) best = { i, at, d };
  }
  return best;
}

/** zoom in round the middle of the plan with two fingers, so the handles are well apart */
export async function pinchIn(page: Page, t: Touch) {
  const b = await planBox(page);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await t.down([cx - 30, cy], [cx + 30, cy]);
  await t.move([[cx - 120, cy], [cx + 120, cy]], 8);
  await t.up();
}

/** a spot on the floor, inside the area, away from every handle */
export async function emptyFloor(page: Page): Promise<XY> {
  const b = await planBox(page);
  for (let y = b.y + 80; y < b.y + b.height - 40; y += 16) {
    for (let x = b.x + 30; x < b.x + b.width - 30; x += 16) {
      const free = await page.evaluate(([x, y]) => {
        // nothing within a finger's reach (22 px) is a handle
        for (const [dx, dy] of [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24], [17, 17], [-17, -17], [17, -17], [-17, 17]]) {
          const el = document.elementFromPoint(x + dx, y + dy);
          if (!el || el.closest("[data-handle], .designer-hint, .plan-scale") || !el.closest("svg.plan-svg")) return false;
        }
        return true;
      }, [x, y] as XY);
      if (free) return [x, y];
    }
  }
  throw new Error("no empty floor on the plan");
}

