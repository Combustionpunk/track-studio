import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOT_DIR } from "../src/config.js";
import { contrast, deriveTokens, FONTS, GREY_AMBER, ThemeSync, themeCss, type Roles } from "../src/theme.js";
import { ADMIN, ALICE, FORUM_URL, login, makeApp, ORGANISER } from "./helpers.js";

/** A Discourse colour scheme as it appears in site.json. */
function scheme(id: number, name: string, isDark: boolean, roles: Partial<Roles>) {
  return { id, name, is_dark: isDark, colors: Object.entries(roles).map(([name, hex]) => ({ name, hex: hex.replace("#", ""), default_hex: "000000", is_advanced: false })) };
}

const OCEAN: Roles = {
  primary: "#1a2b3c",
  secondary: "#fafafa",
  tertiary: "#0a6ebd",
  header_background: "#0b3d63",
  header_primary: "#ffffff",
  highlight: "#ffe08a",
  success: "#1f8a3d",
  danger: "#c0392b",
  hover: "#eef3f8",
  selected: "#dde8f2",
};
const NIGHT: Roles = { ...GREY_AMBER, tertiary: "#7fd3ff", highlight: "#7fd3ff", success: "#57c27c" };

const siteJson = (light: unknown, dark: unknown = null) => ({ default_archetype: "regular", default_light_color_scheme: light, default_dark_color_scheme: dark, user_color_schemes: [] });

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const quietLog = () => ({ info: vi.fn(), warn: vi.fn() });

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "track-studio-theme-"));
  dirs.push(d);
  return d;
};

describe("theme sync from the forum", () => {
  it("fetches the forum's site.json and maps Discourse roles to tokens", async () => {
    const fetch = vi.fn(async () => jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))));
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch, log: quietLog() });
    const res = await sync.refresh();
    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`${FORUM_URL}/site.json`, expect.anything());
    const t = sync.current();
    expect(t.source).toBe("forum");
    expect(t.scheme).toEqual({ name: "Ocean", dark: false });
    expect(t.syncedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(t.colors).toMatchObject({
      text: "#1a2b3c",
      bg: "#fafafa",
      accent: "#0a6ebd",
      headerBg: "#0b3d63",
      headerText: "#ffffff",
      highlight: "#ffe08a",
      success: "#1f8a3d",
      danger: "#c0392b",
      hover: "#eef3f8",
      selected: "#dde8f2",
    });
    // derived shades: blends of primary over secondary, getting stronger from surface to muted text
    const c = t.colors;
    expect(contrast(c.surface, c.bg)).toBeLessThan(contrast(c.surface2, c.bg));
    expect(contrast(c.surface2, c.bg)).toBeLessThan(contrast(c.border, c.bg));
    expect(contrast(c.border, c.bg)).toBeLessThan(contrast(c.muted, c.bg));
    expect(t.light).toBeNull();
    expect(t.fonts).toEqual(FONTS);
  });

  it("follows the device when the forum has both a light and a dark scheme (dark by default)", async () => {
    const fetch = vi.fn(async () => jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN), scheme(9, "Night", true, NIGHT))));
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch, log: quietLog() });
    await sync.refresh();
    const t = sync.current();
    expect(t.scheme).toEqual({ name: "Night", dark: true });
    expect(t.colors.accent).toBe("#7fd3ff");
    expect(t.light?.name).toBe("Ocean");
    expect(t.light?.colors.bg).toBe("#fafafa");
    const css = themeCss(t);
    expect(css).toMatch(/^html:root\{color-scheme:dark;--bg:#3d4147;/);
    expect(css).toContain("@media (prefers-color-scheme: light){html:root{color-scheme:light;--bg:#fafafa;");
  });

  it("uses the one scheme when light and dark are the same (the live forum today)", async () => {
    const one = scheme(7, "Grey Amber", true, GREY_AMBER);
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch: async () => jsonResponse(siteJson(one, one)), log: quietLog() });
    await sync.refresh();
    expect(sync.current().light).toBeNull();
    expect(sync.current().scheme).toEqual({ name: "Grey Amber", dark: true });
    expect(themeCss(sync.current())).not.toContain("@media");
  });

  it("uses the dark scheme alone when there's no usable default scheme", async () => {
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch: async () => jsonResponse(siteJson(null, scheme(9, "Night", true, NIGHT))), log: quietLog() });
    expect((await sync.refresh()).ok).toBe(true);
    expect(sync.current()).toMatchObject({ scheme: { name: "Night", dark: true }, light: null });
  });

  it("works out dark/light from the background when the forum doesn't say", async () => {
    const { is_dark: _, ...noFlag } = scheme(7, "Grey Amber", true, GREY_AMBER);
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch: async () => jsonResponse(siteJson(noFlag)), log: quietLog() });
    await sync.refresh();
    expect(sync.current().scheme.dark).toBe(true);
  });

  it("overlapping refreshes share one fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))));
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch, log: quietLog() });
    await Promise.all([sync.refresh(), sync.refresh()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await sync.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("starts with Grey Amber and, until the forum answers, serves it", () => {
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch: async () => jsonResponse({}), log: quietLog() });
    const t = sync.current();
    expect(t.source).toBe("fallback");
    expect(t.syncedAt).toBeNull();
    expect(t.colors).toEqual(deriveTokens(GREY_AMBER));
    expect(t.colors).toMatchObject({ text: "#d9d9d9", bg: "#3d4147", headerBg: "#36393e", accent: "#fdd459", danger: "#e45735", selected: "#272727", hover: "#2f2f30" });
  });

  const bad: [string, () => Promise<Response>][] = [
    ["unreachable", async () => Promise.reject(new TypeError("fetch failed"))],
    ["HTTP 502", async () => new Response("Bad gateway", { status: 502 })],
    ["not JSON", async () => new Response("<html>maintenance</html>", { status: 200 })],
    ["no colour scheme", async () => jsonResponse(siteJson(null))],
    ["no primary", async () => jsonResponse(siteJson(scheme(3, "Broken", false, { secondary: "#ffffff" })))],
    ["bad hex", async () => jsonResponse(siteJson(scheme(3, "Broken", false, { ...OCEAN, primary: "url(javascript:x)" })))],
    ["unreadable (text = background)", async () => jsonResponse(siteJson(scheme(3, "Broken", false, { ...OCEAN, primary: "#fafafa" })))],
  ];
  for (const [what, fetch] of bad) {
    it(`falls back to Grey Amber when the forum is ${what}`, async () => {
      const log = quietLog();
      const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch, log });
      const res = await sync.refresh();
      expect(res.ok).toBe(false);
      expect(res.error).toBeTruthy();
      expect(sync.current().source).toBe("fallback");
      expect(sync.current().colors).toEqual(deriveTokens(GREY_AMBER));
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  }

  it("logs a failing forum once, not every hour, and again only after it recovered", async () => {
    let up = false;
    const log = quietLog();
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch: async () => (up ? jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))) : Promise.reject(new Error("down"))), log });
    await sync.refresh();
    await sync.refresh();
    await sync.refresh();
    expect(log.warn).toHaveBeenCalledTimes(1);
    up = true;
    await sync.refresh();
    up = false;
    await sync.refresh();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good scheme when a later fetch fails", async () => {
    let up = true;
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch: async () => (up ? jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))) : Promise.reject(new Error("down"))), log: quietLog() });
    await sync.refresh();
    const synced = sync.current().syncedAt;
    up = false;
    await sync.refresh();
    expect(sync.current().source).toBe("forum");
    expect(sync.current().colors.bg).toBe("#fafafa");
    expect(sync.current().syncedAt).toBe(synced);
  });

  it("caches the scheme on disk, so a restart while the forum is down keeps the forum's colours", async () => {
    const cacheFile = join(tempDir(), "theme.json");
    const first = new ThemeSync({ forumUrl: FORUM_URL, cacheFile, fetch: async () => jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))), log: quietLog() });
    await first.refresh();
    const second = new ThemeSync({ forumUrl: FORUM_URL, cacheFile, fetch: async () => Promise.reject(new Error("down")), log: quietLog() });
    expect(second.current().source).toBe("cache");
    expect(second.current().colors.bg).toBe("#fafafa");
    expect(second.current().syncedAt).toBe(first.current().syncedAt);
    await second.refresh();
    expect(second.current().colors.bg).toBe("#fafafa");
  });

  it("ignores a cache for a different forum", async () => {
    const cacheFile = join(tempDir(), "theme.json");
    await new ThemeSync({ forumUrl: "http://other.test", cacheFile, fetch: async () => jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))), log: quietLog() }).refresh();
    expect(new ThemeSync({ forumUrl: FORUM_URL, cacheFile, fetch: async () => jsonResponse({}), log: quietLog() }).current().source).toBe("fallback");
  });

  it("fetches on start and every hour after", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))));
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch, log: quietLog() });
    await sync.start();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    sync.stop();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("start() never throws, even when the forum is down", async () => {
    const sync = new ThemeSync({ forumUrl: FORUM_URL, fetch: async () => Promise.reject(new Error("down")), log: quietLog() });
    await expect(sync.start()).resolves.toBeUndefined();
    sync.stop();
    expect(sync.current().source).toBe("fallback");
  });
});

describe("derived tokens", () => {
  it("Grey Amber meets WCAG AA for text, muted text, links and danger text", () => {
    const c = deriveTokens(GREY_AMBER);
    expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.muted, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.muted, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.link, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.dangerText, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.dangerText, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.successText, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.warning, c.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.info, c.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentInk, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.headerText, c.headerBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.focus, c.bg)).toBeGreaterThanOrEqual(3);
  });

  it("a light scheme gets readable derived colours too", () => {
    const c = deriveTokens(OCEAN);
    for (const fg of [c.text, c.muted, c.link, c.dangerText, c.successText, c.warning, c.info]) expect(contrast(fg, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentInk, c.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("the web app's built-in tokens (tokens.css) are exactly the derived Grey Amber", () => {
    const css = readFileSync(join(ROOT_DIR, "apps", "web", "src", "theme", "tokens.css"), "utf8");
    const block = /\/\* synced:start \*\/([\s\S]*?)\/\* synced:end \*\//.exec(css)?.[1] ?? "";
    const vars = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const expected = Object.fromEntries(Object.entries(deriveTokens(GREY_AMBER)).map(([k, v]) => [k.replace(/[A-Z0-9]/g, (ch) => `-${ch.toLowerCase()}`), v]));
    expect(vars).toEqual(expected);
  });
});

describe("theme API and pages", () => {
  const stub = () => vi.fn(async () => jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))));

  it("GET /api/theme.json is public and returns tokens, fonts and syncedAt", async () => {
    const { app } = await makeApp({ themeFetch: stub() });
    let res = await app.inject({ method: "GET", url: "/api/theme.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.json()).toMatchObject({ source: "fallback", syncedAt: null, scheme: { name: "Grey Amber", dark: true }, fonts: { body: "Inter", headings: "Oswald" } });
    expect(res.json().colors.bg).toBe("#3d4147");
    await app.theme.refresh();
    res = await app.inject({ method: "GET", url: "/api/theme.json" });
    expect(res.json()).toMatchObject({ source: "forum", scheme: { name: "Ocean" }, colors: { bg: "#fafafa", accent: "#0a6ebd" }, light: null });
  });

  it("'Refresh theme now' is for track-admins and forum admins only", async () => {
    const fetch = stub();
    const { app } = await makeApp({ themeFetch: fetch });
    expect((await app.inject({ method: "POST", url: "/api/theme/refresh" })).statusCode).toBe(401);
    const alice = await login(app, ALICE);
    expect((await app.inject({ method: "POST", url: "/api/theme/refresh", headers: { cookie: alice } })).statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    for (const u of [ORGANISER, ADMIN]) {
      const res = await app.inject({ method: "POST", url: "/api/theme/refresh", headers: { cookie: await login(app, u) } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, theme: { source: "forum", colors: { bg: "#fafafa" } } });
      expect(res.json().css).toContain("--bg:#fafafa;");
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refresh reports a failing forum without changing the theme", async () => {
    const { app } = await makeApp({ themeFetch: async () => new Response("nope", { status: 500 }) });
    const res = await app.inject({ method: "POST", url: "/api/theme/refresh", headers: { cookie: await login(app, ORGANISER) } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, theme: { source: "fallback" } });
    expect(res.json().error).toMatch(/500/);
  });

  it("/api/me says who may refresh the theme", async () => {
    const { app } = await makeApp({ themeFetch: stub() });
    const me = async (u: typeof ALICE) => (await app.inject({ method: "GET", url: "/api/me", headers: { cookie: await login(app, u) } })).json();
    expect((await me(ALICE)).organiser).toBe(false);
    expect((await me(ORGANISER)).organiser).toBe(true);
  });

  it("every page carries the current theme as CSS variables, so the first paint is already in the forum's colours", async () => {
    const { app } = await makeApp({ themeFetch: stub() });
    const page = async () => (await app.inject({ method: "GET", url: "/", headers: { accept: "text/html" } })).body;
    expect(await page()).toContain('<style id="theme">html:root{color-scheme:dark;--bg:#3d4147;');
    expect(await page()).toContain('<meta name="theme-color" content="#36393e">');
    await app.theme.refresh();
    expect(await page()).toContain('<style id="theme">html:root{color-scheme:light;--bg:#fafafa;');
  });
});

describe("cache file location", () => {
  it("the app keeps its theme cache in DATA_DIR", async () => {
    const { app, config } = await makeApp({ themeFetch: async () => jsonResponse(siteJson(scheme(3, "Ocean", false, OCEAN))) });
    await app.theme.refresh();
    expect(JSON.parse(readFileSync(join(config.dataDir, "theme-cache.json"), "utf8")).forumUrl).toBe(FORUM_URL);
  });
});
