// The plan PNG and the Open Graph card both come from the engine's plan renderer (planSvg / planInBox).
import { planScene, planSvg, type RcTrack } from "@track-studio/engine";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_HEIGHT, CARD_WIDTH, cardSvg, wrapName } from "../src/card.js";
import { ROOT_DIR } from "../src/config.js";
import { previewFontFiles, prepareFonts } from "../src/fonts.js";
import { drawPreview } from "../src/drawing.js";
import { fallbackTheme } from "../src/theme.js";
import { ALICE, BASE_URL, login, makeApp } from "./helpers.js";

const SPORTS = "46897d82-0114-460f-9a75-984ee97bca0e";
const CLUB = "7c002509-b640-5e9d-8e79-0ae336a2ae04";
const ref = (f: string) => JSON.parse(readFileSync(join(ROOT_DIR, "reference/examples", f), "utf8")) as RcTrack;
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1];
const colors = fallbackTheme().colors;

describe("plan previews use the shared renderer", () => {
  it("drawPreview is the engine's planSvg at 1200 px", () => {
    const doc = ref("club-a.rctrack.json");
    expect(drawPreview(doc)).toBe(planSvg(planScene(doc), { width: 1200 }));
  });

  it("the stored preview hash is of that drawing", async () => {
    const { app } = await makeApp({ seeded: true });
    const { doc, track } = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB}` })).json();
    const { previewHash } = await import("../src/store.js");
    expect(track.previewUrl).toBe(`/p/${CLUB}/1.png?v=${previewHash(doc)}`);
  });

  it("migration 004 clears old hashes so they are recomputed at start", async () => {
    const { app } = await makeApp({ seeded: true });
    app.db.prepare("UPDATE track_revisions SET preview_hash = 'old0old0old0'").run();
    const sql = readFileSync(join(ROOT_DIR, "apps/server/migrations/004_plan_drawing.sql"), "utf8");
    app.db.exec(sql);
    const { backfillRevisions } = await import("../src/store.js");
    expect(backfillRevisions(app.db)).toBe(3);
    expect(app.db.prepare("SELECT count(*) FROM track_revisions WHERE preview_hash = 'old0old0old0' OR preview_hash IS NULL").pluck().get()).toBe(0);
  });
});

describe("fonts for pictures", () => {
  it("Inter and Oswald come from the web app's own font files, as TrueType for resvg", async () => {
    const { config } = await makeApp();
    const files = await prepareFonts(config.dataDir);
    expect(files.map((f) => f.split("/").pop()).sort()).toEqual(expect.arrayContaining(["inter-latin-wght-normal.ttf", "oswald-latin-wght-normal.ttf"]));
    for (const f of files) {
      expect(existsSync(f)).toBe(true);
      expect(readFileSync(f).subarray(0, 4).toString("hex")).toBe("00010000"); // sfnt (TrueType outlines)
    }
    expect(previewFontFiles()).toEqual(expect.arrayContaining(files));
    // the Latin Extended subsets (same family names, no ASCII) come after the basic Latin ones
    const names = files.map((f) => f.split("/").pop()!);
    expect(names.indexOf("oswald-latin-wght-normal.ttf")).toBeLessThan(names.indexOf("oswald-latin-ext-wght-normal.ttf"));
    expect(names.indexOf("inter-latin-wght-normal.ttf")).toBeLessThan(names.indexOf("inter-latin-ext-wght-normal.ttf"));
  });
});

describe("Open Graph card", () => {
  const doc = ref("club-a.rctrack.json");

  it("is 1200 × 630 with the logo, name, plan, lap, corners, size and status", () => {
    const svg = cardSvg(doc, "approved", colors);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1200" height="630" viewBox="0 0 1200 630"/);
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1200, 630]);
    expect(svg).toContain('class="logo"');
    expect(svg).toContain(">Club A</text>");
    expect(svg).toContain(">124 m</text>");
    expect(svg).toContain(">12</text>");
    expect(svg).toContain(">22 × 12 m</text>");
    expect(svg).toContain(">Approved</text>");
    expect(svg).toMatch(/>LAP<\/text>.*>CORNERS<\/text>.*>SIZE<\/text>/);
    expect(svg).toContain('class="p-carpet"'); // the plan, drawn by the shared renderer
    expect(svg).not.toMatch(/var\(--/); // resvg has no CSS variables
  });

  it("uses the theme's colours for the frame and the fixed plan palette for the plan", () => {
    const svg = cardSvg(doc, "draft", colors);
    expect(svg).toContain(`fill="${colors.bg}"`);
    expect(svg).toContain(`fill="${colors.headerBg}"`);
    expect(svg).toContain(">Draft</text>");
  });

  it("escapes the name and wraps long ones onto two lines, then shortens", () => {
    expect(cardSvg({ ...doc, info: { ...doc.info, name: 'Tom & "Jerry" <b>' } }, "draft", colors)).toContain("Tom &amp; &quot;Jerry&quot; &lt;b&gt;");
    expect(wrapName("Club A")).toEqual(["Club A"]);
    const long = wrapName("The Winter Carpet Championship Layout Number Three For The Big Hall");
    expect(long).toHaveLength(2);
    expect(long[1].endsWith("…")).toBe(true);
    expect(wrapName("Supercalifragilisticexpialidociousandthensome")[0].endsWith("…")).toBe(true);
  });

  it("the track page points og:image at the card (1200 × 630), cached by a hash of the card", async () => {
    const { app } = await makeApp({ seeded: true });
    const html = (await app.inject({ method: "GET", url: `/t/${SPORTS}` })).body;
    const image = meta(html, "og:image")!;
    expect(image).toMatch(new RegExp(`^${BASE_URL}/p/${SPORTS}/1/card.png\\?v=[0-9a-f]{12}$`));
    expect(meta(html, "og:image:width")).toBe("1200");
    expect(meta(html, "og:image:height")).toBe("630");
    expect(meta(html, "twitter:image")).toBe(image);
    const url = new URL(image);
    const res = await app.inject({ method: "GET", url: url.pathname + url.search });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.rawPayload.readUInt32BE(16)).toBe(1200);
    expect(res.rawPayload.readUInt32BE(20)).toBe(630);
    expect((await app.inject({ method: "GET", url: url.pathname + url.search })).headers["x-preview-cache"]).toBe("hit");
    expect((await app.inject({ method: "GET", url: url.pathname })).headers["cache-control"]).toBe("public, max-age=300");
    for (const bad of [`/p/${SPORTS}/9/card.png`, `/p/${SPORTS}/1/card.jpg`, "/p/nope/1/card.png"]) expect((await app.inject({ method: "GET", url: bad })).statusCode, bad).toBe(404);
  });

  it("a new status gives a new card URL (the plan is unchanged)", async () => {
    const { app } = await makeApp({ seeded: true });
    const cookie = await login(app, ALICE);
    const doc = (await app.inject({ method: "GET", url: `/api/tracks/${SPORTS}` })).json().doc;
    const created = (await app.inject({ method: "POST", url: "/api/tracks", headers: { cookie }, payload: doc })).json();
    const id = created.track.id as string;
    const before = meta((await app.inject({ method: "GET", url: `/t/${id}` })).body, "og:image");
    expect((await app.inject({ method: "POST", url: `/api/tracks/${id}/submit`, headers: { cookie } })).statusCode).toBe(200);
    const after = meta((await app.inject({ method: "GET", url: `/t/${id}` })).body, "og:image");
    expect(after).not.toBe(before);
  });
});
