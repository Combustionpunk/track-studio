// Tabs left open across a deploy (#88): the version check, the reload banner, the full load on the next navigation,
// the chunk-load guard and the route error page.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, type RouteObject } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as v from "../src/lib/version.js";
import { UpdateBanner } from "../src/components/UpdateBanner.js";
import { ErrorView } from "../src/pages/ErrorPage.js";
import { routes } from "../src/routes.js";
import { buildVersion, stampVersion } from "../version-stamp.js";

const location = { href: "https://tracks.example/", assign: vi.fn(), reload: vi.fn() };

function storage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, val) => void m.set(k, val), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; } };
}

beforeEach(() => {
  v.resetForTests("build-a");
  location.assign.mockReset();
  location.reload.mockReset();
  vi.stubGlobal("window", { location });
});
afterEach(() => vi.unstubAllGlobals());

const nav = (from: string, to: string) => ({ currentUrl: new URL(from, "https://tracks.example"), nextUrl: new URL(to, "https://tracks.example") });
const gate = (to: string) => v.versionGate({ request: new Request(new URL(to, "https://tracks.example")) });

describe("noticing a new version", () => {
  it("a different version on an API response marks the tab out of date", () => {
    v.noteServerVersion(null); // no header (an old server, a proxy error): nothing to compare
    v.noteServerVersion("build-a");
    expect(v.isStale()).toBe(false);
    const seen = vi.fn();
    const stop = v.subscribe(seen);
    v.noteServerVersion("build-b");
    expect(v.isStale()).toBe(true);
    expect(seen).toHaveBeenCalled();
    stop();
  });

  it("api() reads the header from every response", async () => {
    const { api } = await import("../src/lib/api.js");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: 1 }), { headers: { "content-type": "application/json", "x-app-version": "build-b" } }));
    await api("/api/config");
    expect(v.isStale()).toBe(true);
  });

  it("api() notices it even when the request fails", async () => {
    const { api } = await import("../src/lib/api.js");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "x", message: "no" }), { status: 500, headers: { "content-type": "application/json", "x-app-version": "build-b" } }));
    await expect(api("/api/tracks")).rejects.toThrow();
    expect(v.isStale()).toBe(true);
  });

  it("checks /healthz when the tab regains focus", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, version: "build-b" }), { headers: { "x-app-version": "build-b" } }));
    await v.checkNow(fetch);
    expect(fetch).toHaveBeenCalledWith("/healthz", expect.anything());
    expect(v.isStale()).toBe(true);
  });

  it("the banner shows only when the tab is out of date, with a Reload button", () => {
    expect(renderToStaticMarkup(<UpdateBanner />)).toBe("");
    v.noteServerVersion("build-b");
    const html = renderToStaticMarkup(<UpdateBanner />);
    expect(html).toContain("Track Studio has been updated. Reload to get the latest version.");
    expect(html).toMatch(/<button[^>]*>Reload<\/button>/);
    expect(html).toContain('role="status"');
  });
});

describe("the next navigation is a full page load", () => {
  it("only a change of page runs the gate (filters in the query string don't)", () => {
    expect(v.gateRevalidates(nav("/", "/t/abc"))).toBe(true);
    expect(v.gateRevalidates(nav("/?q=hall", "/?q=hall+b"))).toBe(false);
  });

  it("up to date: the app navigates as usual", () => {
    expect(gate("/t/abc")).toBeNull();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it("out of date: the browser loads the next page from the server", () => {
    v.noteServerVersion("build-b");
    const result = gate("/t/abc?r=2");
    expect(location.assign).toHaveBeenCalledWith("https://tracks.example/t/abc?r=2");
    expect(result).toBeInstanceOf(Promise); // never settles: the old page stays until the new one loads
  });

  it("unsaved work holds the reload: only the banner shows, and the app navigates as usual", () => {
    v.noteServerVersion("build-b");
    const release = v.holdReload();
    expect(gate("/v")).toBeNull();
    expect(location.assign).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<UpdateBanner />)).toContain("Reload");
    release();
    gate("/v");
    expect(location.assign).toHaveBeenCalledWith("https://tracks.example/v");
  });

  it("two editors holding: both must let go", () => {
    v.noteServerVersion("build-b");
    const a = v.holdReload();
    const b = v.holdReload();
    a();
    a(); // releasing twice counts once
    expect(gate("/v")).toBeNull();
    b();
    expect(gate("/v")).not.toBeNull();
  });
});

describe("chunk-load failures", () => {
  it("recognises a failed dynamic import or chunk load", () => {
    expect(v.isChunkError(new TypeError("Failed to fetch dynamically imported module: https://tracks.example/assets/three-Ab12.js"))).toBe(true);
    expect(v.isChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(v.isChunkError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(v.isChunkError(Object.assign(new Error("Loading chunk 3 failed"), { name: "ChunkLoadError" }))).toBe(true);
    expect(v.isChunkError(new Error("Unable to preload CSS for /assets/index-x.css"))).toBe(true);
    expect(v.isChunkError(new TypeError("Cannot read properties of undefined (reading 'side')"))).toBe(false);
    expect(v.isChunkError("nope")).toBe(false);
  });

  it("reloads once per version and never loops", () => {
    const s = storage();
    expect(v.reloadOnceForChunkError(s)).toBe(true);
    expect(location.reload).toHaveBeenCalledTimes(1);
    // the reload brought back the same build (the chunk is really missing): no second reload
    expect(v.reloadOnceForChunkError(s)).toBe(false);
    expect(v.reloadOnceForChunkError(s)).toBe(false);
    expect(location.reload).toHaveBeenCalledTimes(1);
    // a later deploy may reload once more
    v.resetForTests("build-c");
    expect(v.reloadOnceForChunkError(s)).toBe(true);
    expect(location.reload).toHaveBeenCalledTimes(2);
  });

  it("no session storage (private mode, blocked): never reloads automatically", () => {
    const broken = { ...storage(), getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } as Storage;
    expect(v.reloadOnceForChunkError(broken)).toBe(false);
    expect(location.reload).not.toHaveBeenCalled();
  });
});

describe("the error page", () => {
  const page = (error: unknown, updated = false) => renderToStaticMarkup(<MemoryRouter><ErrorView error={error} updated={updated} /></MemoryRouter>);

  it("says what happened, with Reload and Back to the library, and the detail behind a toggle", () => {
    const html = page(new TypeError("Cannot read properties of undefined (reading 'side')"));
    expect(html).toContain("Something went wrong showing this page.");
    expect(html).toMatch(/<button[^>]*>Reload<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Back to the library<\/a>/);
    expect(html).toMatch(/<details[^>]*><summary>Details<\/summary>.*TypeError: Cannot read properties of undefined \(reading &#x27;side&#x27;\)/);
    expect(html).not.toContain("at "); // no stack trace
    expect(html).not.toContain("updated while this page was open");
  });

  it("after a deploy, says the app was updated and offers Reload", () => {
    for (const html of [page(new Error("boom"), true), page(new TypeError("Failed to fetch dynamically imported module: /assets/x.js"))]) {
      expect(html).toContain("Track Studio was updated while this page was open.");
      expect(html).toMatch(/<button[^>]*>Reload<\/button>/);
    }
  });

  it("an error that isn't an Error still shows a short detail", () => {
    expect(page("plain string")).toContain("plain string");
    expect(page({ status: 500, statusText: "Server error" })).toContain("500 Server error");
  });

  it("every route has the app's error page above it, never React Router's default", () => {
    const uncovered: string[] = [];
    const walk = (rs: RouteObject[], covered: boolean, prefix: string) => {
      for (const r of rs) {
        const path = r.path ?? prefix;
        const here = covered || !!r.errorElement;
        if (r.children) walk(r.children, here, path);
        else if (!here) uncovered.push(path);
      }
    };
    walk(routes, false, "");
    expect(uncovered).toEqual([]);
    // pages inside the site chrome keep the header when they fail: their error page sits below the layout
    const layout = routes[0].children!.find((r) => !r.path && r.children);
    expect(layout?.children?.every((r) => !!r.errorElement)).toBe(true);
    // and the root gate runs before each change of page
    expect(routes[0].loader).toBe(v.versionGate);
    expect(routes[0].shouldRevalidate).toBe(v.gateRevalidates);
  });
});

describe("the build's version", () => {
  it("changes when a built file does, ignores order, index.html and source maps", () => {
    const a = buildVersion(["index.html", "assets/index-Ckahg9hH.js", "assets/index-Dx1.css", "favicon.svg"]);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(buildVersion(["favicon.svg", "assets/index-Dx1.css", "assets/index-Ckahg9hH.js", "assets/index-Ckahg9hH.js.map"])).toBe(a);
    expect(buildVersion(["index.html", "assets/index-Zz9.js", "assets/index-Dx1.css", "favicon.svg"])).not.toBe(a);
  });

  it("is stamped into index.html, where the server and the tab read it", () => {
    const html = stampVersion("<!doctype html><html><head><title>Track Studio</title></head></html>", "abc123def456");
    expect(html).toContain('<meta name="app-version" content="abc123def456">');
    expect(() => stampVersion("<html></html>", "x")).toThrow();
  });
});
