// Silent sign-in with the forum (DiscourseConnect prompt=none) and one sign-out for all sites (#132).
import { describe, expect, it, vi } from "vitest";
import { decodePayload, encodePayload, NONCE_COOKIE, signPayload, SSO_CHECKED_COOKIE } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { ForumReachable } from "../src/forum-reachable.js";
import { ALICE, BASE_URL, callbackUrl, FORUM_URL, forumResponse, forumUp, login, makeApp, SECRET, startLogin } from "./helpers.js";

/** What a browser sends when the user opens a page (top-level navigation). */
const browser = {
  accept: "text/html,application/xhtml+xml",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

type App = Awaited<ReturnType<typeof makeApp>>["app"];
type Res = Awaited<ReturnType<App["inject"]>>;

/** The cookies a response sets, as the browser would send them back (cleared ones dropped). */
const cookieHeader = (...responses: Res[]) =>
  responses
    .flatMap((r) => r.cookies)
    .filter((c) => c.value !== "")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

/** The forum's answer to a prompt=none request when nobody is signed in there. */
function forumFailed(nonce: string) {
  const sso = encodePayload({ nonce, failed: "true", return_sso_url: `${BASE_URL}/auth/callback` });
  return { sso, sig: signPayload(sso, SECRET) };
}

/** An app whose forum is up (the status probe answers), as the silent check needs. */
const silentApp = (opts: Parameters<typeof makeApp>[0] = {}) => makeApp({ seeded: true, forumFetch: forumUp, ...opts });

async function openPage(app: App, url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url, headers: { ...browser, ...headers } });
}

function forumRequest(location: string) {
  const loc = new URL(location);
  const p = decodePayload(loc.searchParams.get("sso")!);
  return { loc, p, sig: loc.searchParams.get("sig")!, sso: loc.searchParams.get("sso")! };
}

/** The silent round trip's first half: the page's redirect, the nonce it carries, and the cookies the browser now holds. */
async function startSilent(app: App, url: string, headers: Record<string, string> = {}) {
  const first = await openPage(app, url, headers);
  expect(first.statusCode).toBe(302);
  const { p } = forumRequest(first.headers.location as string);
  return { first, nonce: p.get("nonce")!, cookie: [headers.cookie, cookieHeader(first)].filter(Boolean).join("; ") };
}

describe("silent sign-in on the first visit", () => {
  it("a visitor with no session is sent to the forum with prompt=none, and the check and nonce cookies are set", async () => {
    const { app } = await silentApp();
    const res = await openPage(app, "/v");
    expect(res.statusCode).toBe(302);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { loc, p, sso, sig } = forumRequest(res.headers.location as string);
    expect(`${loc.origin}${loc.pathname}`).toBe(`${FORUM_URL}/session/sso_provider`);
    expect(sig).toBe(signPayload(sso, SECRET));
    expect(p.get("prompt")).toBe("none");
    expect(p.get("return_sso_url")).toBe(`${BASE_URL}/auth/callback`);
    const c = res.cookies.find((c) => c.name === SSO_CHECKED_COOKIE)!;
    expect(c).toBeTruthy();
    expect(c.maxAge).toBe(30 * 60);
    expect(c.httpOnly).toBe(true);
    expect(c.path).toBe("/");
    const n = res.cookies.find((c) => c.name === NONCE_COOKIE)!;
    expect(n.value).toBe(p.get("nonce"));
    expect(n.httpOnly).toBe(true);
    expect(n.sameSite).toBe("Lax");
    expect(n.path).toBe("/auth");
    expect(n.maxAge).toBe(10 * 60);
    expect(app.db.prepare("SELECT silent FROM auth_nonces WHERE nonce = ?").pluck().get(p.get("nonce"))).toBe(1);
  });

  it("signed into the forum: signed in automatically and back on the page asked for", async () => {
    const { app } = await silentApp();
    const { nonce, cookie } = await startSilent(app, "/v");
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)), headers: { cookie } });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe("/v");
    expect(back.cookies.find((c) => c.name === NONCE_COOKIE)!.value).toBe(""); // used up
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieHeader(back) } });
    expect(me.json()).toMatchObject({ id: ALICE.id, username: "alice" });
  });

  it("a deep link (path and query) is preserved", async () => {
    const { app } = await silentApp();
    const { nonce, cookie } = await startSilent(app, "/t/46897d82-0114-460f-9a75-984ee97bca0e/build?paper=a4&x=1");
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)), headers: { cookie } });
    expect(back.headers.location).toBe("/t/46897d82-0114-460f-9a75-984ee97bca0e/build?paper=a4&x=1");
  });

  it("not signed into the forum: stays a visitor with no error, and the page loads with no loop", async () => {
    const { app } = await silentApp();
    const { nonce, cookie } = await startSilent(app, "/v");
    const back = await app.inject({ method: "GET", url: callbackUrl(forumFailed(nonce)), headers: { cookie } });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe("/v");
    expect(back.cookies.find((c) => c.name === "ts_session")).toBeUndefined();
    const page = await openPage(app, "/v", { cookie });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
  });

  it("the cookie stops repeat checks on every page", async () => {
    const { app } = await silentApp();
    const checked = cookieHeader(await openPage(app, "/"));
    for (const url of ["/", "/v", "/lap-speeds", "/new"]) {
      const res = await openPage(app, url, { cookie: checked });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it("signed-in users aren't checked while the cookie lasts; a login sets it", async () => {
    const { app } = await silentApp();
    const { nonce, cookie } = await startLogin(app, "/v");
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)), headers: { cookie } });
    expect(back.cookies.find((c) => c.name === SSO_CHECKED_COOKIE)?.maxAge).toBe(30 * 60);
    expect((await openPage(app, "/v", { cookie: cookieHeader(back) })).statusCode).toBe(200);
  });

  it("signed out of the forum: the next silent check signs out here too", async () => {
    const { app } = await silentApp();
    const session = await login(app, ALICE);
    const { nonce, cookie } = await startSilent(app, "/v", { cookie: session }); // the check cookie has lapsed
    const back = await app.inject({ method: "GET", url: callbackUrl(forumFailed(nonce)), headers: { cookie } });
    expect(back.headers.location).toBe("/v");
    expect(back.cookies.find((c) => c.name === "ts_session")!.value).toBe("");
  });

  it("still signed into the forum: the check keeps the session (and refreshes groups)", async () => {
    const { app } = await silentApp();
    const session = await login(app, ALICE);
    const { nonce, cookie } = await startSilent(app, "/v", { cookie: session });
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, { ...ALICE, groups: ["track-admins"] })), headers: { cookie } });
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieHeader(back) } });
    expect(me.json()).toMatchObject({ username: "alice", organiser: true });
  });

  it("several tabs at once: each check is in flight for this browser, the newest four", async () => {
    const { app } = await silentApp();
    let cookie = "";
    const nonces: string[] = [];
    for (const url of ["/", "/v", "/new", "/lap-speeds", "/v/new"]) {
      const res = await openPage(app, url, { cookie: `${NONCE_COOKIE}=${nonces.join(".")}` }); // no check cookie: each tab opened before any answer
      nonces.push(forumRequest(res.headers.location as string).p.get("nonce")!);
      cookie = res.cookies.find((c) => c.name === NONCE_COOKIE)!.value;
    }
    expect(cookie.split(".")).toEqual(nonces.slice(1)); // the oldest fell off
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonces[2]!, ALICE)), headers: { cookie: `${NONCE_COOKIE}=${cookie}; ${SSO_CHECKED_COOKIE}=1` } });
    expect(back.headers.location).toBe("/new");
    expect(back.cookies.find((c) => c.name === NONCE_COOKIE)!.value.split(".")).toEqual([nonces[1], nonces[3], nonces[4]]);
  });

  it("no redirect for bots, HEAD requests, API calls, embeds, or anything that isn't a page navigation", async () => {
    const { app } = await silentApp();
    const bots = ["Googlebot/2.1 (+http://www.google.com/bot.html)", "Discourse Forum Onebox v3.3", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "Twitterbot/1.0", "Mozilla/5.0 (compatible; bingbot/2.0)"];
    for (const ua of bots) expect((await openPage(app, "/v", { "user-agent": ua })).statusCode, ua).toBe(200);
    expect((await app.inject({ method: "HEAD", url: "/v", headers: browser })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: browser })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/config", headers: browser })).statusCode).toBe(200);
    // a link-preview fetcher or script with no Sec-Fetch headers
    expect((await app.inject({ method: "GET", url: "/v", headers: { accept: "text/html" } })).statusCode).toBe(200);
    // the forum's embedded viewer (an iframe)
    expect((await openPage(app, "/embed/no-such-track", { "sec-fetch-dest": "iframe" })).statusCode).toBe(404);
    expect((await openPage(app, "/embed/no-such-track")).statusCode).toBe(404);
    // a page in someone's iframe, and prefetches
    expect((await openPage(app, "/v", { "sec-fetch-dest": "iframe" })).statusCode).toBe(200);
    expect((await openPage(app, "/v", { "sec-purpose": "prefetch" })).statusCode).toBe(200);
    expect((await openPage(app, "/v", { purpose: "prefetch" })).statusCode).toBe(200);
    // a page that isn't there isn't worth a round trip
    expect((await openPage(app, "/t/no-such-track")).statusCode).toBe(404);
    expect((await openPage(app, "/no/such/page")).statusCode).toBe(404);
  });

  it("dev-login users aren't checked against the forum", async () => {
    const { app } = await silentApp({ config: { devLogin: true } });
    const dev = await app.inject({ method: "GET", url: "/auth/dev-login?user=dana" });
    expect((await openPage(app, "/v", { cookie: cookieHeader(dev) })).statusCode).toBe(200);
  });

  it("is off when forum login isn't configured (dev login only)", async () => {
    const { app } = await silentApp({ config: { discourseConnectSecret: "", devLogin: true } });
    expect((await openPage(app, "/v")).statusCode).toBe(200);
  });

  it("SILENT_SIGNIN=off is the kill switch: no check, while Log in and Log out still work", async () => {
    const { app } = await silentApp({ config: { silentSignin: false } });
    const page = await openPage(app, "/v");
    expect(page.statusCode).toBe(200);
    expect(page.cookies).toHaveLength(0);
    expect(app.db.prepare("SELECT count(*) FROM auth_nonces").pluck().get()).toBe(0);
    const session = await login(app, ALICE);
    expect((await openPage(app, "/v", { cookie: session })).statusCode).toBe(200);
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: session } });
    expect(forumRequest(out.json().redirect).p.get("logout")).toBe("true");
    const env = { BASE_URL, FORUM_URL, DISCOURSE_CONNECT_SECRET: SECRET, SESSION_SECRET: "s".repeat(40), DATA_DIR: "/tmp/x" };
    expect(loadConfig(env).silentSignin).toBe(true);
    expect(loadConfig({ ...env, SILENT_SIGNIN: "off" }).silentSignin).toBe(false);
    expect(loadConfig({ ...env, SILENT_SIGNIN: "on" }).silentSignin).toBe(true);
  });
});

describe("while the forum is down", () => {
  /** A forum whose status page answers only while `up` is true, counting the probes; and a clock the tests move. */
  function flakyForum(up: () => boolean) {
    const clock = { now: 1_700_000_000_000 };
    const probes = vi.fn(async (_url: string) => (up() ? new Response("ok", { status: 200 }) : Promise.reject(new Error("ECONNREFUSED"))));
    const probe = new ForumReachable({ forumUrl: FORUM_URL, fetch: probes as unknown as typeof fetch, now: () => clock.now });
    return { clock, probes, probe };
  }

  it("the page is served as a visitor, with no redirect, no cookie and no nonce; the next visit after the cache lapses tries again", async () => {
    let up = false;
    const { clock, probes, probe } = flakyForum(() => up);
    const { app } = await makeApp({ seeded: true, forumReachable: probe });
    const page = await openPage(app, "/v?sort=name");
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.cookies).toHaveLength(0);
    expect(app.db.prepare("SELECT count(*) FROM auth_nonces").pluck().get()).toBe(0);
    expect(probes).toHaveBeenCalledTimes(1);
    expect(probes.mock.calls[0]![0]).toBe(`${FORUM_URL}/srv/status`);
    // a signed-in member keeps their session meanwhile
    const session = await login(app, ALICE);
    expect((await openPage(app, "/v", { cookie: session })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: session } })).json()).toMatchObject({ username: "alice" });
    // the forum is back, but the answer is believed for a minute
    up = true;
    expect((await openPage(app, "/v")).statusCode).toBe(200);
    expect(probes).toHaveBeenCalledTimes(1);
    clock.now += 61_000;
    const again = await openPage(app, "/v?sort=name");
    expect(again.statusCode).toBe(302);
    expect(probes).toHaveBeenCalledTimes(2);
    const { nonce, cookie } = await startSilent(app, "/");
    expect((await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)), headers: { cookie } })).headers.location).toBe("/");
  });

  it("the probe is cached: many pages, one status request, up or down", async () => {
    const { probes, probe } = flakyForum(() => true);
    const { app } = await makeApp({ seeded: true, forumReachable: probe });
    for (const url of ["/", "/v", "/lap-speeds", "/new", "/v/new"]) expect((await openPage(app, url)).statusCode, url).toBe(302);
    expect(probes).toHaveBeenCalledTimes(1);
  });

  it("a page never waits for the probe beyond its timeout", async () => {
    const never = (_url: string, init?: { signal?: AbortSignal }) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const probe = new ForumReachable({ forumUrl: FORUM_URL, fetch: never as unknown as typeof fetch, timeoutMs: 50 });
    const { app } = await makeApp({ seeded: true, forumReachable: probe });
    const started = Date.now();
    const page = await openPage(app, "/v");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(page.statusCode).toBe(200);
    expect(page.cookies).toHaveLength(0);
  });

  it("sign-out stays local: the session ends here and the browser isn't sent to the forum", async () => {
    const { probe } = flakyForum(() => false);
    const { app } = await makeApp({ seeded: true, forumReachable: probe });
    const session = await login(app, ALICE);
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: session } });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({ ok: true, redirect: null });
    expect(out.cookies.find((c) => c.name === "ts_session")!.value).toBe("");
    expect(out.cookies.find((c) => c.name === SSO_CHECKED_COOKIE)!.maxAge).toBe(30 * 60);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieHeader(out) } })).json()).toBeNull();
  });
});

describe("a browser that keeps no cookies", () => {
  it("comes back to the page once, marked ?nosignin=1, and isn't sent round again", async () => {
    const { app } = await silentApp();
    const { nonce } = await startSilent(app, "/v?sort=name");
    // the forum answers, but the browser sends none of our cookies back
    const back = await app.inject({ method: "GET", url: callbackUrl(forumFailed(nonce)) });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe("/v?sort=name&nosignin=1");
    expect(back.cookies.find((c) => c.name === "ts_session")).toBeUndefined();
    const page = await openPage(app, "/v?sort=name&nosignin=1");
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    // a signed answer without our cookies can't sign anyone in either (it wasn't this browser that asked)
    const { nonce: n2 } = await startSilent(app, "/");
    const signed = await app.inject({ method: "GET", url: callbackUrl(forumResponse(n2, ALICE)) });
    expect(signed.statusCode).toBe(302);
    expect(signed.headers.location).toBe("/?nosignin=1");
    expect(signed.cookies.find((c) => c.name === "ts_session")).toBeUndefined();
  });

  it("the marker is never added to an ordinary login's return", async () => {
    const { app } = await silentApp();
    const { nonce, cookie } = await startLogin(app, "/v?sort=name");
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)), headers: { cookie } });
    expect(back.headers.location).toBe("/v?sort=name");
  });
});

describe("a silent check that goes wrong", () => {
  it("bad signature, expired nonce or missing signature: back on the page as a visitor, no error page", async () => {
    const { app } = await silentApp();
    const forged = await startSilent(app, "/v");
    const bad = await app.inject({ method: "GET", url: callbackUrl({ ...forumResponse(forged.nonce, ALICE), sig: "0".repeat(64) }), headers: { cookie: forged.cookie } });
    expect(bad.statusCode).toBe(302);
    expect(bad.headers.location).toBe("/v");
    expect(bad.cookies.find((c) => c.name === "ts_session")).toBeUndefined();
    expect(bad.cookies.find((c) => c.name === NONCE_COOKIE)!.value).toBe("");
    expect(app.db.prepare("SELECT count(*) FROM auth_nonces WHERE nonce = ?").pluck().get(forged.nonce)).toBe(1); // not consumed by a forgery

    const stale = await startSilent(app, "/lap-speeds");
    app.db.prepare("UPDATE auth_nonces SET expires_at = ? WHERE nonce = ?").run(Date.now() - 1, stale.nonce);
    const late = await app.inject({ method: "GET", url: callbackUrl(forumResponse(stale.nonce, ALICE)), headers: { cookie: stale.cookie } });
    expect(late.statusCode).toBe(302);
    expect(late.headers.location).toBe("/lap-speeds");
    expect(late.cookies.find((c) => c.name === "ts_session")).toBeUndefined();

    const unsigned = await startSilent(app, "/new");
    const none = await app.inject({ method: "GET", url: `/auth/callback?sso=${encodeURIComponent(forumResponse(unsigned.nonce, ALICE).sso)}`, headers: { cookie: unsigned.cookie } });
    expect(none.statusCode).toBe(302);
    expect(none.headers.location).toBe("/new");
  });

  it("an unknown nonce or no payload at all is still an error (nobody's page to go back to)", async () => {
    const { app } = await silentApp();
    expect((await app.inject({ method: "GET", url: callbackUrl(forumFailed("f".repeat(32))) })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/auth/callback" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: callbackUrl({ ...forumFailed("whatever"), sig: "0".repeat(64) }) })).statusCode).toBe(403);
  });

  it("an ordinary login keeps its error page", async () => {
    const { app } = await silentApp();
    const { nonce, cookie } = await startLogin(app, "/v");
    const res = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE, "not-the-secret")), headers: { cookie } });
    expect(res.statusCode).toBe(403);
    const again = await startLogin(app, "/v");
    const failed = await app.inject({ method: "GET", url: callbackUrl(forumFailed(again.nonce)), headers: { cookie: again.cookie } });
    expect(failed.statusCode).toBe(400);
    expect(failed.json().error).toBe("bad-login");
  });
});

describe("the forum's answer only counts in the browser that asked", () => {
  it("a login callback carried to another browser is refused", async () => {
    const { app } = await silentApp();
    const { nonce } = await startLogin(app, "/v");
    const other = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)) });
    expect(other.statusCode).toBe(403);
    expect(other.json().message).toMatch(/another browser/);
    expect(other.cookies.find((c) => c.name === "ts_session")).toBeUndefined();
    // and the nonce is used up: the real browser can't finish either
    const { cookie } = await startLogin(app, "/v");
    expect((await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)), headers: { cookie } })).statusCode).toBe(400);
  });

  it("a silent callback carried to another browser leaves it as it was: no sign-in, and a captured failed=true doesn't sign a member out", async () => {
    const { app } = await silentApp();
    const { nonce } = await startSilent(app, "/v");
    const bob = await login(app, { id: 102, username: "bob" });
    // Bob's browser opens a link made from Alice's silent sign-in: he stays Bob
    const signed = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)), headers: { cookie: `${bob}; ${SSO_CHECKED_COOKIE}=1` } });
    expect(signed.statusCode).toBe(302);
    expect(signed.headers.location).toBe("/v");
    expect(signed.cookies.find((c) => c.name === "ts_session")).toBeUndefined();
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: bob } })).json()).toMatchObject({ username: "bob" });
    // and a visitor's failed=true answer opened in Bob's browser doesn't end his session
    const { nonce: n2 } = await startSilent(app, "/");
    const failed = await app.inject({ method: "GET", url: callbackUrl(forumFailed(n2)), headers: { cookie: `${bob}; ${SSO_CHECKED_COOKIE}=1` } });
    expect(failed.statusCode).toBe(302);
    expect(failed.headers.location).toBe("/");
    expect(failed.cookies.find((c) => c.name === "ts_session")).toBeUndefined();
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: bob } })).json()).toMatchObject({ username: "bob" });
  });
});

describe("one sign-out", () => {
  it("ends the session and sends the browser to the forum's logout", async () => {
    const { app } = await silentApp();
    const cookie = await login(app, ALICE);
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(out.cookies.find((c) => c.name === "ts_session")!.value).toBe("");
    const { loc, p, sso, sig } = forumRequest(out.json().redirect);
    expect(`${loc.origin}${loc.pathname}`).toBe(`${FORUM_URL}/session/sso_provider`);
    expect(sig).toBe(signPayload(sso, SECRET));
    expect(p.get("logout")).toBe("true");
    expect(p.get("return_sso_url")).toBe(`${BASE_URL}/`);
  });

  it("marks the forum as checked, so coming back from the forum's logout doesn't sign in again", async () => {
    const { app } = await silentApp();
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: await login(app, ALICE) } });
    const checked = out.cookies.find((c) => c.name === SSO_CHECKED_COOKIE)!;
    expect(checked.maxAge).toBe(30 * 60);
    expect((await openPage(app, "/", { cookie: `${SSO_CHECKED_COOKIE}=${checked.value}` })).statusCode).toBe(200);
  });

  it("with forum login off, sign-out stays local", async () => {
    const { app } = await makeApp({ config: { discourseConnectSecret: "", devLogin: true } });
    const out = await app.inject({ method: "POST", url: "/auth/logout" });
    expect(out.json()).toEqual({ ok: true, redirect: null });
  });
});
