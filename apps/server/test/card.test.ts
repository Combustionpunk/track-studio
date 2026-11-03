// The plan PNG and the Open Graph card both come from the engine's plan renderer (planSvg / planInBox).
import { planScene, planSvg, type RcTrack } from "@track-studio/engine";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_HEIGHT, CARD_WIDTH, cardSvg, wrapName } from "../src/card.js";
import { ROOT_DIR } from "../src/config.js";
import { FALLBACK_FONT, fontsKey, loadFonts, previewFontFiles, SERVER_FONTS_DIR } from "../src/fonts.js";
import { renderPng } from "../src/previews.js";
import { drawPreview } from "../src/drawing.js";
import { fallbackTheme } from "../src/theme.js";
import { ALICE, BASE_URL, login, makeApp } from "./helpers.js";

const SPORTS = "46897d82-0114-460f-9a75-984ee97bca0e";
const CLUB = "7c002509-b640-5e9d-8e79-0ae336a2ae04";
const ref = (f: string) => JSON.parse(readFileSync(join(ROOT_DIR, "reference/examples", f), "utf8")) as RcTrack;
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1];
const colors = fallbackTheme().colors;

describe("plan previews use the shared renderer", () => {
  it("drawPreview is the engine's planSvg at 1200 px, lines sized for a ~480 px display", () => {
    const doc = ref("club-a.rctrack.json");
    expect(drawPreview(doc)).toBe(planSvg(planScene(doc), { width: 1200, pixelRatio: 2.5 }));
  });

  it("the stored preview hash is of that drawing", async () => {
    const { app } = await makeApp({ seeded: true });
    const { doc, track } = (await app.inject({ method: "GET", url: `/api/tracks/${CLUB}` })).json();
    const { previewHash } = await import("../src/store.js");
    expect(track.previewUrl).toBe(`/p/${CLUB}/1.png?v=${previewHash(doc)}`);
  });

  it("stale preview hashes (new engine or fonts) are refreshed at start", async () => {
    const { app, config } = await makeApp({ seeded: true });
    app.db.prepare("UPDATE track_revisions SET preview_hash = 'old0old0old0'").run();
    const { buildApp } = await import("../src/app.js");
    const again = await buildApp(config, { db: app.db });
    expect(again.db.prepare("SELECT count(*) FROM track_revisions WHERE preview_hash = 'old0old0old0' OR preview_hash IS NULL").pluck().get()).toBe(0);
    const { refreshPreviewHashes } = await import("../src/store.js");
    expect(refreshPreviewHashes(again.db)).toBe(0); // nothing left to do
    await again.close();
  });
});

describe("fonts for pictures", () => {
  const name = (f: string) => f.split(/[\\/]/).pop()!;

  it("are static TrueType Inter 400/600 and Oswald 500/600 from apps/server/fonts, then DejaVu Sans", () => {
    expect(SERVER_FONTS_DIR).toBe(join(ROOT_DIR, "apps", "server", "fonts"));
    const files = previewFontFiles();
    expect(files.map(name)).toEqual(["Inter-Regular.ttf", "Inter-SemiBold.ttf", "Oswald-Medium.ttf", "Oswald-SemiBold.ttf", "DejaVuSans.ttf"]);
    for (const f of files) expect(readFileSync(f).subarray(0, 4).toString("hex"), f).toBe("00010000"); // sfnt, TrueType outlines
    expect(files.at(-1)).toBe(FALLBACK_FONT);
    // the licence travels with them
    for (const f of ["Inter-OFL.txt", "Oswald-OFL.txt"]) expect(readFileSync(join(SERVER_FONTS_DIR, f), "utf8")).toContain("SIL Open Font License, Version 1.1");
    // no more weights than the card uses
    expect(readdirSync(SERVER_FONTS_DIR).filter((f) => f.endsWith(".ttf"))).toHaveLength(4);
  });

  it("the fonts key names the static files, so pictures drawn with the variable fonts refresh", () => {
    expect(fontsKey()).toBe("Inter-Regular.ttf,Inter-SemiBold.ttf,Oswald-Medium.ttf,Oswald-SemiBold.ttf,DejaVuSans.ttf");
    expect(fontsKey()).not.toMatch(/wght/);
  });

  it("falls back to DejaVu Sans alone when the folder is missing", () => {
    expect(loadFonts(join(ROOT_DIR, "no-such-fonts"))).toEqual([FALLBACK_FONT]);
  });

  it("resvg draws each weight with its own face (the variable fonts all came out at 400)", () => {
    const png = (family: string, weight: number) =>
      renderPng(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80"><text x="10" y="60" font-size="48" font-family="${family}" font-weight="${weight}">Club A 124</text></svg>`);
    const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    expect(hash(png("Oswald", 500))).not.toBe(hash(png("Oswald", 600)));
    expect(hash(png("Inter", 400))).not.toBe(hash(png("Inter", 600)));
    // and they are Oswald and Inter, not the fallback
    expect(hash(png("Oswald", 500))).not.toBe(hash(png("DejaVu Sans", 500)));
    expect(hash(png("Inter", 400))).not.toBe(hash(png("DejaVu Sans", 400)));
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

  it("sets the title in Oswald at 500 or 600, the labels and badge in Inter 600", () => {
    const svg = cardSvg(doc, "approved", colors);
    const title = /<text [^>]*>Club A<\/text>/.exec(svg)![0];
    expect(title).toMatch(/font-family="Oswald\b/);
    expect(title).toMatch(/font-weight="(500|600)"/);
    for (const label of ["Approved", "LAP"]) {
      const el = new RegExp(`<text [^>]*>${label}</text>`).exec(svg)![0];
      expect(el, label).toMatch(/font-family="Inter\b/);
      expect(el, label).toMatch(/font-weight="600"/);
    }
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
    for (const name of ["Supercalifragilisticexpialidocious Raceway", "A Supercalifragilisticexpialidocious Raceway", "Short Supercalifragilisticexpialidocious"])
      for (const line of wrapName(name)) expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(17);
  });

  it("the track page points og:image at the card (1200 × 630), cached by a hash of the card", async () => {
    const { app, config } = await makeApp({ seeded: true });
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
    // an older card of the same revision is dropped when a new one is drawn
    const dir = join(config.dataDir, "previews", SPORTS);
    const { readdirSync, renameSync } = await import("node:fs");
    const card = readdirSync(dir).find((f) => f.startsWith("card-1-"))!;
    renameSync(join(dir, card), join(dir, "card-1-0123456789ab.png"));
    await app.inject({ method: "GET", url: url.pathname + url.search });
    expect(readdirSync(dir).filter((f) => f.startsWith("card-1-"))).toEqual([card]);
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
