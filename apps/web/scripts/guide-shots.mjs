// Takes the user guide's screenshots (#171) by doing each task in the running app, as a member would. See
// docs/guide/MAINTAINING.md for how to run it. It needs a freshly seeded dev instance (DEV_LOGIN=1) whose FORUM_URL
// points at the stand-in forum this script starts (FORUM_PORT), so "Used at" and the lap times have something to show.
//
//   node apps/web/scripts/guide-shots.mjs [name-filter]
//
// BASE (default http://localhost:4171) is the instance; OUT (default docs/guide/img) is where the pictures go (WebP). With a
// filter, only the groups whose name contains it run (the groups are independent of each other, apart from "share",
// which makes the layout the later ones show).
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:4171";
const FORUM_PORT = Number(process.env.FORUM_PORT ?? 4172);
const OUT = process.env.OUT ?? fileURLToPath(new URL("../../../docs/guide/img/", import.meta.url));
const only = process.argv[2] ?? "";
mkdirSync(OUT, { recursive: true });

// the seeded examples (reference/examples, reference/venues)
const CLUB_A = "7c002509-b640-5e9d-8e79-0ae336a2ae04";
const HALL = "venue-2"; // Sports hall B: two pillars and a fire exit
const MEMBER = "alice";
const ORGANISER = "olivia";

const DESKTOP = { viewport: { width: 1200, height: 800 } };
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true };
const PHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true };

// ------------------------------------------------------------------------------------------------ the stand-in forum
// What the forum's event plugin would say: one made-up meeting raced on the Club A example, with made-up drivers.
const meeting = { id: 12, title: "Winter Series, round 2", start_date: "2026-11-14", url: `http://localhost:${FORUM_PORT}/t/winter-series-round-2/12`, venue: { id: 3, name: "Example Village Hall" }, venue_track: { id: 5, name: "Main hall carpet" } };
const record = (ms, name, car) => ({ ms, driver: { name, username: null }, car, meeting: { id: meeting.id, title: meeting.title, date: meeting.start_date, url: meeting.url } });
const stats = {
  classes: [
    { class: "2WD Buggy", typical_lap: { median_ms: 19840, trimmed_mean_ms: 20110, iqr_ms: 1650, laps: 412, meetings: 1, updated_at: "2026-11-15T09:00:00Z" }, record_lap: record(17920, "Sam Example", "Buggy A"), record_3: record(54810, "Sam Example", "Buggy A") },
    { class: "4WD Buggy", typical_lap: { median_ms: 18650, trimmed_mean_ms: 18900, iqr_ms: 1480, laps: 365, meetings: 1, updated_at: "2026-11-15T09:00:00Z" }, record_lap: record(16740, "Jo Sample", "Buggy B"), record_3: record(51020, "Jo Sample", "Buggy B") },
  ],
};
const forum = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  let m;
  let body = null;
  if ((m = /^\/des\/layouts\/([\w-]+)\/events$/.exec(path))) body = { events: m[1] === CLUB_A ? [meeting] : [] };
  else if ((m = /^\/des\/layouts\/([\w-]+)\/stats\.json$/.exec(path))) body = m[1] === CLUB_A ? stats : { classes: [] };
  else if (path === "/des/venues") body = { venues: [{ id: 3, name: "Example Village Hall", town: "Exampleton", tracks: [{ id: 5, name: "Main hall carpet", surface: "carpet", environment: "indoor", width_m: 14, length_m: 25 }] }] };
  res.writeHead(body ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(body ?? { error: "not found" }));
});
await new Promise((r) => forum.listen(FORUM_PORT, r));

// ------------------------------------------------------------------------------------------------ helpers
let lastPage = null; // for a picture of where a group failed (FAIL_DIR)
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-sandbox"] });

/** A browser at one screen size, signed in as `user` (null: signed out). Pit Lane, the default dark theme. */
async function open(size, user = MEMBER, { organiser = false, theme } = {}) {
  const context = await browser.newContext({ ...size, colorScheme: "dark", deviceScaleFactor: 1, baseURL: BASE });
  // the dev-only login box isn't part of the app members see
  await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: ".dev-login{display:none!important}" }))));
  const page = await context.newPage();
  lastPage = page;
  page.on("pageerror", (e) => console.log("  page error:", e.message));
  if (user) await page.goto(`/auth/dev-login?user=${user}${organiser ? "&organiser=1" : ""}&return=/`);
  // a member's forum theme (the forum sends it; here the answer to "who am I" is given one)
  if (theme) await page.route("**/api/me", async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: { ...(await res.json()), theme } }); });
  return page;
}

const settle = async (page, ms = 350) => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(ms); };

/** PNG bytes as WebP (quality 0.9), made by the browser itself: about a fifth of the size, and still sharp. */
let converter = null;
async function toWebp(png) {
  converter ??= await (await browser.newContext()).newPage();
  const b64 = await converter.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas.toDataURL("image/webp", 0.9).split(",")[1];
  }, png.toString("base64"));
  return Buffer.from(b64, "base64");
}

/** Save a screenshot: the whole screen, or `clip` (a locator: just that part, with a margin). */
async function shot(page, name, clip) {
  await settle(page);
  let png;
  if (clip) {
    const b = await clip.boundingBox();
    const pad = 8, vp = page.viewportSize();
    const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
    png = await page.screenshot({ clip: { x, y, width: Math.min(vp.width - x, b.width + 2 * pad), height: Math.min(vp.height - y, b.height + 2 * pad) } });
  } else png = await page.screenshot();
  writeFileSync(`${OUT}${name}.webp`, await toWebp(png));
  console.log("  " + name);
}

/** screen position of a plan point (x east, z north, metres from the centre of the area) */
const at = (page, x, z) => page.evaluate(([x, z]) => { const p = new DOMPoint(x, -z).matrixTransform(document.querySelector("svg.plan-svg").getScreenCTM()); return [p.x, p.y]; }, [x, z]);
/** screen centre of the lane grid's square [column, row], counted from the south-west corner */
async function square(page, c, r) {
  const g = await page.evaluate(() => { const h = document.querySelector("rect.lay-hit"); return { x: +h.getAttribute("x"), y: +h.getAttribute("y"), h: +h.getAttribute("height") }; });
  return at(page, g.x + (c + 0.5) * 2, -(g.y + g.h - (r + 0.5) * 2));
}
/** Lay the lane with the mouse: press on the first square and drag through the others. `release: false` keeps the button down. */
async function lay(page, squares, { release = true } = {}) {
  await page.mouse.move(...(await square(page, ...squares[0])));
  await page.mouse.down();
  for (const s of squares.slice(1)) await page.mouse.move(...(await square(page, ...s)), { steps: 7 });
  if (release) await page.mouse.up();
}
const mouseDrag = async (page, from, to, { release = true } = {}) => { await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 8 }); if (release) await page.mouse.up(); };
/** a finger on a touch screen, through the browser's own touch input */
async function finger(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 0 })) });
  return {
    tap: async (p) => { await send("touchStart", [p]); await send("touchEnd", []); },
    hold: async (p, ms = 700) => { await send("touchStart", [p]); await page.waitForTimeout(ms); },
    lift: () => send("touchEnd", []),
    /** two fingers either side of `c`, moved apart (or together) from `from` px to `to` px each side */
    pinch: async (c, from, to) => {
      const two = (d) => cdp.send("Input.dispatchTouchEvent", { type: d === from ? "touchStart" : "touchMove", touchPoints: [{ x: c[0] - d, y: c[1], id: 0 }, { x: c[0] + d, y: c[1], id: 1 }] });
      await two(from);
      for (let k = 1; k <= 8; k++) await two(from + ((to - from) * k) / 8 + (k === 8 ? 0 : 0.01));
      await page.waitForTimeout(150);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c[0] - to, y: c[1], id: 0 }, { x: c[0] + to, y: c[1], id: 1 }] });
      await send("touchEnd", []);
    },
    drag: async (from, to, { lift = true } = {}) => {
      await send("touchStart", [from]);
      for (let k = 1; k <= 8; k++) await send("touchMove", [[from[0] + ((to[0] - from[0]) * k) / 8, from[1] + ((to[1] - from[1]) * k) / 8]]);
      await page.waitForTimeout(150);
      await send("touchMove", [to]);
      if (lift) await send("touchEnd", []);
    },
  };
}
const centre = async (locator) => { const b = await locator.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

/** the loop the guide draws at Sports hall B: round the hall, with a run up the middle between the pillars */
const LOOP = [[0, 0], [10, 0], [10, 6], [6, 6], [6, 2], [4, 2], [4, 6], [0, 6], [0, 0]];
async function newDesign(page, query = `venue=${HALL}`) {
  await page.goto(`/new/design?${query}`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.locator("rect.lay-hit").waitFor();
  await settle(page, 500);
}
/** a new design at Sports hall B with the loop laid: step 2, ready to shape */
async function drawn(page) {
  await newDesign(page);
  await lay(page, LOOP);
  await page.locator("svg.plan-svg [data-handle=point]").first().waitFor();
  await settle(page, 600);
}
const mode = (page, name) => page.getByRole("group", { name: "Mode" }).getByRole("button", { name }).click();
const side = (page) => page.locator(".designer-side");
const state = {}; // what one group leaves for the next (the saved layout's id)

const groups = [];
const group = (name, fn) => groups.push([name, fn]);

// ------------------------------------------------------------------------------------------------ 1 · Getting started
group("start", async () => {
  let page = await open(DESKTOP, null);
  await page.goto("/");
  await page.locator(".card, article").first().waitFor();
  await shot(page, "library-signed-out");
  await page.context().close();

  page = await open(DESKTOP);
  await page.goto("/");
  await page.locator("article").first().waitFor();
  await shot(page, "library");
  await page.getByRole("link", { name: /Club A/ }).first().click();
  await page.locator("svg.plan-svg").waitFor();
  await shot(page, "track-page");
  await page.goto("/v");
  await page.locator("article").first().waitFor();
  await shot(page, "venues");
  await page.context().close();

  // the same library for a member whose forum theme is Ice
  page = await open(DESKTOP, MEMBER, { theme: { theme: "ice", dark_theme: null, mode: "light" } });
  await page.goto("/");
  await page.locator("article").first().waitFor();
  await shot(page, "theme-ice");
  await page.context().close();

  page = await open(PHONE);
  await page.goto("/");
  await page.locator("article").first().waitFor();
  await shot(page, "phone-library");
  await page.context().close();
});

// ------------------------------------------------------------------------------------------------ 2 · Start a layout
group("new", async () => {
  const page = await open(DESKTOP);
  await page.goto("/new");
  await page.getByRole("link", { name: "Start here" }).first().waitFor();
  await page.locator("svg.venue-thumb").nth(2).waitFor();
  await shot(page, "new-track");
  const form = page.locator("form.blank-form");
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel("Name").fill("Example club layout");
  await form.getByLabel(/Length/).fill("24");
  await form.getByLabel(/Width/).fill("13");
  await shot(page, "new-blank", form);
  await newDesign(page);
  await shot(page, "designer-grid");
  await page.context().close();
});

// ------------------------------------------------------------------------------------------------ 3 · Draw the track
const corner = (page, n) => page.locator("svg.plan-svg [data-handle=point]").nth(n - 1);
const pressEsc = (page) => page.keyboard.press("Escape");

group("draw", async () => {
  const page = await open(DESKTOP);
  await newDesign(page);
  // the first few squares, the button still down
  await lay(page, LOOP.slice(0, 3), { release: false });
  await shot(page, "lay-lanes");
  await page.mouse.up();
  await lay(page, LOOP.slice(2));
  await page.locator("svg.plan-svg [data-handle=point]").first().waitFor();
  await shot(page, "lay-closed");

  // a corner: select it, then cut it back with a preset
  await corner(page, 3).click();
  await shot(page, "corner-selected");
  await side(page).getByRole("button", { name: /Sweeper/ }).click();
  await shot(page, "corner-sweeper");

  // a jump: pick it, click the racing line
  await page.getByRole("button", { name: "Tabletop", exact: true }).click();
  await page.mouse.move(...(await at(page, -7, 6)));
  await shot(page, "jump-armed");
  await page.mouse.click(...(await at(page, -7, 6)));
  await shot(page, "jump-placed");
  await pressEsc(page);
  // or drag it from the palette onto the track
  await mouseDrag(page, await centre(page.getByRole("button", { name: "Double", exact: true })), await at(page, -11.5, 1), { release: false });
  await shot(page, "jump-drag");
  await page.mouse.up();

  // marshal points
  await page.getByRole("button", { name: "Cone", exact: true }).click();
  await page.mouse.click(...(await at(page, -7.5, 4)));
  await page.getByRole("button", { name: "Cone", exact: true }).click();
  await page.mouse.click(...(await at(page, 4, -3)));
  await shot(page, "cones");
  await pressEsc(page);

  // the start line, dragged along the track
  await page.getByRole("button", { name: "Start line", exact: true }).click();
  const start = await centre(page.locator("svg.plan-svg [data-handle=start]").first());
  await mouseDrag(page, start, [start[0] + 110, start[1]]);
  await shot(page, "start-line");
  await pressEsc(page);
  // picking the start line zooms in on it: back to the whole plan
  await page.getByRole("button", { name: "Fit to view" }).click();
  await settle(page, 400);

  // Add point: a new corner on the west straight, pulled out to make a kink
  await page.getByRole("button", { name: "Add point", exact: true }).click();
  await page.mouse.click(...(await at(page, -11.5, -3)));
  await shot(page, "add-point");
  await pressEsc(page);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await shot(page, "layers", page.locator(".designer-plan-wrap"));
  await page.getByRole("button", { name: "Layers", exact: true }).click();

  // 3D, seen from the rostrum side
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.locator("canvas").first().waitFor();
  await settle(page, 2500);
  await shot(page, "designer-3d");
  await page.getByRole("button", { name: "Rostrum south" }).click();
  await settle(page, 1500);
  await shot(page, "rostrum-view");
  await page.getByRole("button", { name: "2D", exact: true }).click();

  // Advanced: a corner point's numbers, then H makes it a hairpin
  await mode(page, "Advanced");
  await page.getByRole("button", { name: "Fit to view" }).click();
  await settle(page, 400);
  await page.mouse.click(...(await at(page, -11.5, 6)));
  await shot(page, "advanced-point");
  await page.keyboard.press("h");
  await shot(page, "hairpin");
  await page.keyboard.press("Control+z");
  // a jump's sizes
  await page.mouse.click(...(await at(page, -7, 6)));
  await shot(page, "advanced-jump", page.locator("section.sel-panel"));
  await pressEsc(page);
  await shot(page, "advanced");
  await mode(page, "Quick");
  await page.context().close();
});

// a figure of eight on a blank 22 × 14 m area: the lane crosses itself, and a crossover bridges it
group("crossover", async () => {
  const page = await open(DESKTOP);
  await newDesign(page, "length=22&width=14&name=Figure%20of%20eight");
  await lay(page, [[0, 3], [9, 3], [9, 6], [5, 6], [5, 0], [0, 0], [0, 3]]);
  await page.locator("svg.plan-svg [data-handle=point]").first().waitFor();
  await settle(page, 600);
  await shot(page, "crossing");
  await page.getByRole("button", { name: "Crossover", exact: true }).click();
  await page.mouse.click(...(await at(page, 0, 0)));
  await pressEsc(page);
  await shot(page, "crossover");
  await page.context().close();
});

// ------------------------------------------------------------------------------------------------ 4 · Edit
group("edit", async () => {
  const page = await open(DESKTOP);
  await drawn(page);
  // moving a corner: the button still down, so the guides show
  const from = await centre(corner(page, 3));
  await mouseDrag(page, from, [from[0] - 49, from[1] + 24], { release: false });
  await shot(page, "move-corner");
  await page.mouse.up();
  await shot(page, "undo-redo", page.locator(".designer-bar"));
  await page.getByRole("button", { name: "Reverse direction" }).click();
  await shot(page, "reversed");
  await page.context().close();
});

// ------------------------------------------------------------------------------------------------ 5 · Check and finish
group("check", async () => {
  let page = await open(DESKTOP);
  await drawn(page);
  await page.getByRole("button", { name: "Tabletop", exact: true }).click();
  await page.mouse.click(...(await at(page, 8.5, -1)));
  await pressEsc(page);
  await shot(page, "figures", page.locator(".designer-stats"));
  // the venue check: where it's drawn, it fits
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await page.getByText("Fits Sports hall B").waitFor();
  await shot(page, "venue-check-fits", page.locator(".venue-check"));
  // move the east lane over a pillar and check again
  const pillar = await centre(page.locator("svg.plan-svg text", { hasText: "Pillar" }).nth(1));
  for (const n of [2, 3]) {
    const c = await centre(corner(page, n));
    await mouseDrag(page, c, [pillar[0], c[1]]);
  }
  await pressEsc(page);
  await page.getByRole("button", { name: /^Check/ }).click();
  await page.locator(".venue-check").getByRole("button", { name: "Show" }).first().waitFor();
  await page.locator(".venue-check").getByRole("button", { name: "Show" }).first().click();
  await shot(page, "venue-check-obstacle");
  // a hall it's too big for
  await page.locator(".venue-check select").selectOption({ label: "Small hall" });
  await page.getByRole("button", { name: /^Check/ }).click();
  await page.getByText("Doesn't fit Small hall").waitFor();
  await shot(page, "venue-check-too-big", page.locator(".venue-check"));
  await page.context().close();

  // the checks, on the Advanced tab: lanes pulled over each other
  page = await open(DESKTOP);
  await drawn(page);
  await mode(page, "Advanced");
  const p = await centre(page.locator("svg.plan-svg circle.ed-point").nth(4));
  await mouseDrag(page, p, [p[0] - 70, p[1] - 60]);
  await pressEsc(page);
  await page.locator(".checks-panel:not(.venue-check)").getByRole("button", { name: "Show" }).first().click();
  await shot(page, "checks-errors");
  await page.context().close();

  // a track's page: Fit to a venue, lap times, 3D, the build sheet
  page = await open(DESKTOP);
  await page.goto("/");
  await page.getByRole("link", { name: "Freeform example", exact: true }).first().click();
  await page.locator("svg.plan-svg").waitFor();
  await page.getByRole("button", { name: "Fit to a venue" }).click();
  const fit = page.locator("#fit-panel");
  await fit.locator("select").first().selectOption({ label: "Sports hall B" });
  await fit.locator("svg.plan-svg").waitFor();
  await fit.evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 120));
  await settle(page, 600);
  await shot(page, "fit-to-venue");
  await fit.locator("select").first().selectOption({ label: "Small hall" });
  await fit.getByText("Doesn't fit Small hall").waitFor();
  await shot(page, "fit-does-not-fit", fit);
  await page.goto(`/t/${CLUB_A}`);
  const laps = page.getByRole("heading", { name: /Lap times/ });
  await laps.waitFor();
  await laps.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 300);
  await shot(page, "lap-times");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.locator("canvas").first().waitFor();
  await settle(page, 3000);
  await shot(page, "track-3d");
  await page.goto(`/t/${CLUB_A}/build`);
  await page.locator(".sheet-stage svg").first().waitFor();
  await shot(page, "build-sheet");
  await page.context().close();
});

// ------------------------------------------------------------------------------------------------ 6 · Share
group("share", async () => {
  let page = await open(DESKTOP);
  await drawn(page);
  await page.getByRole("button", { name: "Tabletop", exact: true }).click();
  await page.mouse.click(...(await at(page, -7, 6)));
  await pressEsc(page);
  await page.getByRole("button", { name: "Cone", exact: true }).click();
  await page.mouse.click(...(await at(page, -7.5, 4)));
  await pressEsc(page);
  await page.locator(".name-input").fill("Example club layout");
  await page.getByRole("button", { name: "Save track" }).click();
  await page.getByPlaceholder("First version").fill("First version");
  await shot(page, "save");
  await page.getByRole("button", { name: "Save track" }).last().click();
  await page.waitForURL(/\/t\/[^/]+\/edit/);
  state.layout = /\/t\/([^/]+)\/edit/.exec(page.url())[1];
  await shot(page, "saved", page.locator(".designer-bar"));
  // a second revision: one corner opened out
  await corner(page, 3).click();
  await side(page).getByRole("button", { name: /Sweeper/ }).click();
  await pressEsc(page);
  await page.getByRole("button", { name: "Save revision" }).click();
  await page.getByPlaceholder(/tighter hairpin/).fill("Opened out corner 3");
  await shot(page, "save-revision");
  await page.getByRole("button", { name: /^Save as revision/ }).click();
  await page.getByText("Saved · revision 2").waitFor();

  await page.goto(`/t/${state.layout}`);
  await page.locator("svg.plan-svg").waitFor();
  await shot(page, "track-draft");
  const share = page.getByRole("heading", { name: "Share and download" });
  await share.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  await shot(page, "share-download");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: /^Submit revision/ }).click();
  await page.getByText("Submitted", { exact: false }).first().waitFor();
  await shot(page, "track-submitted");
  await page.context().close();

  // an organiser approves it
  page = await open(DESKTOP, ORGANISER, { organiser: true });
  await page.goto(`/t/${state.layout}`);
  await page.getByRole("button", { name: /^Approve revision/ }).waitFor();
  await shot(page, "organiser-approve");
  await page.getByRole("button", { name: /^Approve revision/ }).click();
  await page.getByText("Locked: in the library").waitFor();
  await page.context().close();

  page = await open(DESKTOP);
  await page.goto(`/t/${state.layout}`);
  await page.getByText("Locked: in the library").waitFor();
  await shot(page, "track-approved");
  await page.goto("/");
  await page.getByRole("button", { name: "Mine" }).click();
  await settle(page, 600);
  await shot(page, "library-mine");
  // where the forum says a layout has been raced
  await page.goto(`/t/${CLUB_A}`);
  const used = page.getByRole("heading", { name: "Used at" });
  await used.waitFor();
  await used.scrollIntoViewIfNeeded();
  await shot(page, "used-at", page.locator("section", { has: used }));
  await page.context().close();
});

// ------------------------------------------------------------------------------------------------ 7 · On a tablet or phone
/** screen centres of the corner handles, in order */
const corners = (page) => page.evaluate(() => [...document.querySelectorAll("svg.plan-svg [data-handle=point]")].map((e) => { const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }));

group("touch", async () => {
  // a tablet, held landscape: the lane is laid with a finger, then shaped from the dock
  let page = await open(TABLET);
  await newDesign(page);
  let f = await finger(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 0 })) });
  const layWithFinger = async (squares, liftAfter = true) => {
    let last = await square(page, ...squares[0]);
    await touch("touchStart", [last]);
    for (const s of squares.slice(1)) {
      const next = await square(page, ...s);
      for (let k = 1; k <= 7; k++) await touch("touchMove", [[last[0] + ((next[0] - last[0]) * k) / 7, last[1] + ((next[1] - last[1]) * k) / 7]]);
      last = next;
    }
    await page.waitForTimeout(150);
    await touch("touchMove", [last]);
    if (liftAfter) await touch("touchEnd", []);
  };
  await layWithFinger(LOOP.slice(0, 3), false);
  await shot(page, "tablet-lay-lanes");
  await touch("touchEnd", []);
  await layWithFinger(LOOP.slice(2));
  await page.locator("svg.plan-svg [data-handle=point]").first().waitFor();
  await settle(page, 600);
  await shot(page, "tablet-designer");
  // an armed tool: tap Tabletop on the dock, then tap the racing line
  await page.getByRole("button", { name: "Tabletop", exact: true }).tap();
  await shot(page, "tablet-armed");
  await f.tap(await at(page, 8.5, -1));
  await settle(page, 500);
  await shot(page, "tablet-jump-sheet");
  await page.getByRole("button", { name: "Close" }).first().tap().catch(() => {});
  // hold a corner for its panel
  const pts = await corners(page);
  await f.hold(pts[2], 800);
  await f.lift();
  await settle(page, 500);
  await shot(page, "tablet-corner-sheet");
  await page.getByRole("button", { name: "Close" }).first().tap().catch(() => {});
  await page.locator(".checks-pill").tap();
  await settle(page, 500);
  await shot(page, "tablet-checks");
  await page.getByRole("button", { name: "Close" }).first().tap().catch(() => {});
  // saved, so the phone can open it
  await page.locator(".name-input").fill("Example phone layout");
  await page.getByRole("button", { name: "Save track" }).tap();
  await page.getByRole("button", { name: "Save track" }).last().tap();
  await page.waitForURL(/\/t\/[^/]+\/edit/);
  const id = /\/t\/([^/]+)\/edit/.exec(page.url())[1];
  await page.context().close();

  // a phone, upright
  page = await open(PHONE);
  f = await finger(page);
  await page.goto(`/new/design?venue=${HALL}`);
  await page.getByText("Lay the lanes on a laptop or tablet").waitFor();
  await shot(page, "phone-new-design");
  await page.goto(`/t/${id}`);
  await page.locator("svg.plan-svg").waitFor();
  await shot(page, "phone-track");
  await page.goto(`/t/${id}/edit`);
  await page.locator("svg.plan-svg [data-handle=point]").first().waitFor();
  await settle(page, 600);
  await shot(page, "phone-designer");
  // pinch to zoom in: the corners and their inside handles come apart
  const plan = await page.locator("svg.plan-svg").boundingBox();
  await f.pinch([plan.x + plan.width / 2, plan.y + plan.height * 0.45], 40, 85);
  await settle(page, 500);
  await shot(page, "phone-zoomed");
  /** a corner that is on screen, clear of any sheet, and takes the finger itself (not its inside handle) */
  const clearCorner = async (selector = "svg.plan-svg [data-handle=point]") => {
    await settle(page, 400);
    const sheet = (await page.locator("section.bottom-sheet").count()) ? await page.locator("section.bottom-sheet").boundingBox() : null;
    const bottom = Math.min(plan.y + plan.height, sheet?.y ?? Infinity) - 60;
    const centres = await page.locator(selector).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
    for (const c of centres) {
      if (c[0] < plan.x + 30 || c[0] > plan.x + plan.width - 30 || c[1] < plan.y + 90 || c[1] > bottom) continue;
      if (await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-handle]")?.getAttribute("data-handle") === "point", c)) return c;
    }
    throw new Error("no corner clear of the sheet");
  };
  const closeSheet = async () => { const x = page.locator("section.bottom-sheet").getByRole("button", { name: "Close" }); if (await x.count()) await x.first().tap(); await settle(page, 350); };
  // tap a corner: its sheet
  await f.tap(await clearCorner());
  await settle(page, 500);
  await shot(page, "phone-selection");
  await closeSheet();
  // hold a corner: what can be done to it
  await f.hold(await clearCorner(), 800);
  await f.lift();
  await page.locator("section.phone-sheet-context").waitFor();
  await shot(page, "phone-context");
  await closeSheet();
  // the Jump sheet, and an armed jump
  await page.getByRole("button", { name: "Jump", exact: true }).tap();
  await settle(page, 500);
  await shot(page, "phone-jumps");
  await page.getByRole("button", { name: "Tabletop", exact: true }).tap();
  await settle(page, 500);
  await shot(page, "phone-armed");
  await page.getByRole("button", { name: "Select", exact: true }).tap();
  await page.locator(".checks-pill").tap();
  await settle(page, 500);
  await shot(page, "phone-checks");
  await closeSheet();
  await page.getByRole("button", { name: "More" }).tap();
  await settle(page, 500);
  await shot(page, "phone-more");
  // Advanced: a corner point's sheet at full height, with Make hairpin
  await page.getByRole("menuitemradio", { name: "Advanced" }).tap();
  await closeSheet();
  await f.tap(await clearCorner("svg.plan-svg circle.ed-point"));
  await settle(page, 500);
  await page.getByRole("button", { name: "Full height" }).focus();
  await page.keyboard.press("Enter");
  await settle(page, 500);
  await shot(page, "phone-advanced-selection");
  // the context sheet in Advanced has Make hairpin too
  await closeSheet();
  await f.hold(await clearCorner("svg.plan-svg circle.ed-point"), 800);
  await f.lift();
  await page.locator("section.phone-sheet-context").waitFor();
  await shot(page, "phone-context-advanced");
  await page.context().close();
});

// ------------------------------------------------------------------------------------------------ run
let failed = 0;
for (const [name, fn] of groups) {
  if (only && !only.split(",").some((o) => name.includes(o))) continue;
  console.log(name);
  try {
    await fn();
  } catch (e) {
    failed++;
    console.log(`  FAILED: ${e.message.split("\n").slice(0, 6).join("\n  ")}`);
    if (process.env.FAIL_DIR && lastPage) await lastPage.screenshot({ path: `${process.env.FAIL_DIR}/fail-${name}.png` }).catch(() => {});
  }
}
await browser.close();
forum.close();
process.exit(failed ? 1 : 0);
