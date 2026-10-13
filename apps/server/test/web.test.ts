import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORUM_URL, makeApp } from "./helpers.js";

const SPORTS = "46897d82-0114-460f-9a75-984ee97bca0e";

/** A stand-in for apps/web/dist. */
function fakeDist() {
  const root = mkdtempSync(join(tmpdir(), "track-studio-web-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Track Studio</title><!--app-head--><script type="module" src="/assets/app-abc123.js"></script></head><body><div id="root"><!--app-body--></div></body></html>`);
  writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log('app')");
  writeFileSync(join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  return { mode: "static" as const, root, dist };
}

const html = { accept: "text/html,application/xhtml+xml" };

describe("web app pages", () => {
  it("serves the built app with the track's Open Graph tags filled in", async () => {
    const { app: a } = await makeAppWithWeb(fakeDist());
    const res = await a.inject({ method: "GET", url: `/t/${SPORTS}`, headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<script type="module" src="/assets/app-abc123.js">');
    expect(res.body).toContain("<title>Freeform example @ Sports hall B · Track Studio</title>");
    expect(res.body).toContain('<meta property="og:title" content="Freeform example @ Sports hall B">');
    expect(res.body).toMatch(new RegExp(`<meta property="og:image" content="http://tracks.test/p/${SPORTS}/1.png\\?v=[0-9a-f]{12}">`));
    expect(res.body).toMatch(/<div id="root"><h1>Freeform example/); // static fallback until the app starts
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(res.headers["content-security-policy"]).not.toContain(FORUM_URL);
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("embed pages may be framed by the forum only", async () => {
    const { app } = await makeAppWithWeb(fakeDist());
    const res = await app.inject({ method: "GET", url: `/embed/${SPORTS}`, headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toContain(`frame-ancestors 'self' ${FORUM_URL}`);
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(res.body).toContain('<meta property="og:title"');
  });

  it("pinned revisions: ?r= picks the image", async () => {
    const { app } = await makeAppWithWeb(fakeDist());
    const res = await app.inject({ method: "GET", url: `/embed/${SPORTS}?r=1`, headers: html });
    expect(res.body).toContain(`/p/${SPORTS}/1.png`);
    expect((await app.inject({ method: "GET", url: `/embed/${SPORTS}?r=7`, headers: html })).statusCode).toBe(404);
  });

  it("static assets: hashed files cached forever, others briefly", async () => {
    const { app } = await makeAppWithWeb(fakeDist());
    const js = await app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await app.inject({ method: "GET", url: "/favicon.svg" })).headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("venue pages, list pages and 404s", async () => {
    const { app } = await makeAppWithWeb(fakeDist());
    for (const url of ["/", "/v", "/v/venue-2"]) {
      const res = await app.inject({ method: "GET", url, headers: html });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    }
    expect((await app.inject({ method: "GET", url: "/v/venue-2", headers: html })).body).toContain("25 × 14 m track area · rostrum south · 3 obstacles");
    for (const url of ["/t/nope", "/v/nope", "/no/such/page"]) {
      const res = await app.inject({ method: "GET", url, headers: html });
      expect(res.statusCode, url).toBe(404);
      expect(res.body).toContain('<div id="root">'); // the app shows its own not-found page
    }
    // API clients still get JSON
    const api = await app.inject({ method: "GET", url: "/api/nope", headers: html });
    expect(api.json().error).toBe("not-found");
    expect((await app.inject({ method: "GET", url: "/no/such/page" })).json().error).toBe("not-found");
  });

  it("without a web build: fallback pages with the same tags", async () => {
    const { app } = await makeApp({ seeded: true });
    const res = await app.inject({ method: "GET", url: `/t/${SPORTS}`, headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(res.headers["content-security-policy"]).toBe("frame-ancestors 'self'");
  });

  it("/api/config", async () => {
    const { app } = await makeApp({ config: { devLogin: true } });
    expect((await app.inject({ method: "GET", url: "/api/config" })).json()).toMatchObject({ devLogin: true, forumUrl: FORUM_URL });
  });
});

async function makeAppWithWeb(web: ReturnType<typeof fakeDist>) {
  return makeApp({ seeded: true, web });
}
