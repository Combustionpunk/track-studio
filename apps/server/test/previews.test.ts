import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seed } from "../src/seed.js";
import { ROOT_DIR } from "../src/config.js";
import { ALICE, BASE_URL, login, makeApp } from "./helpers.js";

const FREEFORM = "3b542396-6bd2-55e8-8665-852e74dc54a9";
const SPORTS = "46897d82-0114-460f-9a75-984ee97bca0e";
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("PNG previews", () => {
  it("renders a 1200 px PNG, caches it on disk, long cache headers", async () => {
    const { app, config } = await makeApp({ seeded: true });
    const first = await app.inject({ method: "GET", url: `/p/${FREEFORM}/1.png` });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toBe("image/png");
    expect(first.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(first.headers["x-preview-cache"]).toBe("miss");
    const png = first.rawPayload;
    expect(png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(png.readUInt32BE(16)).toBe(1200); // IHDR width
    expect(png.readUInt32BE(20)).toBe(Math.round((1200 * 17) / 27)); // area 22 x 12 + 2.5 m margins
    const file = join(config.dataDir, "previews", FREEFORM, "1.png");
    expect(existsSync(file)).toBe(true);
    const mtime = statSync(file).mtimeMs;
    expect(app.db.prepare("SELECT png_path FROM track_revisions WHERE track_id = ? AND revision = 1").pluck().get(FREEFORM)).toBe(join("previews", FREEFORM, "1.png"));

    const second = await app.inject({ method: "GET", url: `/p/${FREEFORM}/1.png` });
    expect(second.headers["x-preview-cache"]).toBe("hit");
    expect(second.rawPayload.equals(png)).toBe(true);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  it("each revision gets its own image; unknown ones 404", async () => {
    const { app } = await makeApp({ seeded: true });
    const cookie = await login(app, ALICE);
    const created = (await app.inject({ method: "POST", url: "/api/tracks", headers: { cookie }, payload: { track: (await app.inject({ method: "GET", url: `/api/tracks/${FREEFORM}` })).json().doc } })).json();
    const id = created.track.id as string;
    const doc = created.doc;
    doc.design.points[1].x -= 1; // every point sets its own width, so move a corner instead
    expect((await app.inject({ method: "PUT", url: `/api/tracks/${id}`, headers: { cookie }, payload: { track: doc } })).statusCode).toBe(200);
    const a = await app.inject({ method: "GET", url: `/p/${id}/1.png` });
    const b = await app.inject({ method: "GET", url: `/p/${id}/2.png` });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.rawPayload.equals(b.rawPayload)).toBe(false);
    for (const url of [`/p/${id}/3.png`, `/p/${id}/1.jpg`, `/p/${id}/..%2F1.png`, "/p/nope/1.png"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(404);
    }
  });
});

describe("track page (Open Graph)", () => {
  const meta = (html: string, key: string) => {
    const m = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html);
    return m?.[1];
  };

  it("has the right tags", async () => {
    const { app } = await makeApp({ seeded: true });
    const res = await app.inject({ method: "GET", url: `/t/${SPORTS}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    const html = res.body;
    expect(meta(html, "og:title")).toBe("Freeform example @ Sports hall B");
    expect(meta(html, "og:description")).toBe("94 m lap · 12 corners · Sports hall B · approved");
    expect(meta(html, "og:image")).toBe(`${BASE_URL}/p/${SPORTS}/1.png`);
    expect(meta(html, "og:url")).toBe(`${BASE_URL}/t/${SPORTS}`);
    expect(meta(html, "og:image:width")).toBe("1200");
    expect(meta(html, "og:image:height")).toBe(String(Math.round((1200 * 19) / 30)));
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(html).toContain(`<img src="${BASE_URL}/p/${SPORTS}/1.png"`);
    // the image the tags point at exists
    const img = await app.inject({ method: "GET", url: new URL(meta(html, "og:image")!).pathname });
    expect(img.statusCode).toBe(200);
  });

  it("escapes the track name and follows the current revision", async () => {
    const { app } = await makeApp({ seeded: true });
    const cookie = await login(app, ALICE);
    const doc = (await app.inject({ method: "GET", url: `/api/tracks/${FREEFORM}` })).json().doc;
    doc.info.name = `Tom & "Jerry" <b>`;
    const created = (await app.inject({ method: "POST", url: "/api/tracks", headers: { cookie }, payload: doc })).json();
    await app.inject({ method: "PUT", url: `/api/tracks/${created.track.id}`, headers: { cookie }, payload: doc });
    const html = (await app.inject({ method: "GET", url: `/t/${created.track.id}` })).body;
    expect(meta(html, "og:title")).toBe("Tom &amp; &quot;Jerry&quot; &lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(meta(html, "og:description")).toBe("94 m lap · 12 corners · no venue · draft");
    expect(meta(html, "og:image")).toBe(`${BASE_URL}/p/${created.track.id}/2.png`);
  });
});

describe("seed", () => {
  it("imports reference venues and examples as approved, once", async () => {
    const { app, config } = await makeApp();
    const log: string[] = [];
    expect(seed(app.db, config, join(ROOT_DIR, "reference"), (s) => log.push(s))).toBe(6);
    expect(seed(app.db, config, join(ROOT_DIR, "reference"), () => {})).toBe(0);
    const tracks = (await app.inject({ method: "GET", url: "/api/tracks?status=approved" })).json().tracks;
    expect(tracks).toHaveLength(3);
    for (const t of tracks) expect(t).toMatchObject({ author: { id: 0, username: "system" }, approvedRevision: 1 });
    expect((await app.inject({ method: "GET", url: "/api/venues" })).json().venues.map((v: { id: string }) => v.id).sort()).toEqual(["venue-1", "venue-2", "venue-3"]);
    const sports = (await app.inject({ method: "GET", url: `/api/tracks/${SPORTS}` })).json();
    expect(sports.track).toMatchObject({ venueTemplateId: "venue-2", derivedFromId: FREEFORM });
  });
});
