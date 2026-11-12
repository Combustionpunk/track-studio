// Silent sign-in with the forum (DiscourseConnect prompt=none) and one sign-out for all sites (#132).
import { describe, expect, it } from "vitest";
import { decodePayload, encodePayload, signPayload, SSO_CHECKED_COOKIE } from "../src/auth.js";
import { ALICE, BASE_URL, callbackUrl, FORUM_URL, forumResponse, login, makeApp, SECRET, startLogin } from "./helpers.js";

/** What a browser sends when the user opens a page (top-level navigation). */
const browser = {
  accept: "text/html,application/xhtml+xml",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

const cookieHeader = (res: { cookies: { name: string; value: string }[] }) => res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

/** The forum's answer to a prompt=none request when nobody is signed in there. */
function forumFailed(nonce: string) {
  const sso = encodePayload({ nonce, failed: "true", return_sso_url: `${BASE_URL}/auth/callback` });
  return { sso, sig: signPayload(sso, SECRET) };
}

async function openPage(app: Awaited<ReturnType<typeof makeApp>>["app"], url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url, headers: { ...browser, ...headers } });
}

function forumRequest(location: string) {
  const loc = new URL(location);
  const p = decodePayload(loc.searchParams.get("sso")!);
  return { loc, p, sig: loc.searchParams.get("sig")!, sso: loc.searchParams.get("sso")! };
}

describe("silent sign-in on the first visit", () => {
  it("a visitor with no session is sent to the forum with prompt=none, and the check cookie is set", async () => {
    const { app } = await makeApp({ seeded: true });
    const res = await openPage(app, "/v");
    expect(res.statusCode).toBe(302);
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
  });

  it("signed into the forum: signed in automatically and back on the page asked for", async () => {
    const { app } = await makeApp({ seeded: true });
    const first = await openPage(app, "/v");
    const { p } = forumRequest(first.headers.location as string);
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(p.get("nonce")!, ALICE)) });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe("/v");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieHeader(back) } });
    expect(me.json()).toMatchObject({ id: ALICE.id, username: "alice" });
  });

  it("a deep link (path and query) is preserved", async () => {
    const { app } = await makeApp({ seeded: true });
    const first = await openPage(app, "/t/some-track/build?paper=a4&x=1");
    const { p } = forumRequest(first.headers.location as string);
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(p.get("nonce")!, ALICE)) });
    expect(back.headers.location).toBe("/t/some-track/build?paper=a4&x=1");
  });

  it("not signed into the forum: stays a visitor with no error, and the page loads with no loop", async () => {
    const { app } = await makeApp({ seeded: true });
    const first = await openPage(app, "/v");
    const checked = cookieHeader(first);
    const { p } = forumRequest(first.headers.location as string);
    const back = await app.inject({ method: "GET", url: callbackUrl(forumFailed(p.get("nonce")!)), headers: { cookie: checked } });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe("/v");
    expect(back.cookies.find((c) => c.name === "ts_session")).toBeUndefined();
    const page = await openPage(app, "/v", { cookie: checked });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
  });

  it("a failed answer is still checked: bad signature or unknown nonce is refused", async () => {
    const { app } = await makeApp();
    const bad = forumFailed("whatever");
    expect((await app.inject({ method: "GET", url: callbackUrl({ ...bad, sig: "0".repeat(64) }) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: callbackUrl(bad) })).statusCode).toBe(400);
  });

  it("the cookie stops repeat checks on every page", async () => {
    const { app } = await makeApp({ seeded: true });
    const checked = cookieHeader(await openPage(app, "/"));
    for (const url of ["/", "/v", "/lap-speeds", "/new"]) {
      const res = await openPage(app, url, { cookie: checked });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it("signed-in users aren't checked while the cookie lasts; a login sets it", async () => {
    const { app } = await makeApp({ seeded: true });
    const { nonce } = await startLogin(app, "/v");
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)) });
    expect(back.cookies.find((c) => c.name === SSO_CHECKED_COOKIE)?.maxAge).toBe(30 * 60);
    expect((await openPage(app, "/v", { cookie: cookieHeader(back) })).statusCode).toBe(200);
  });

  it("signed out of the forum: the next silent check signs out here too", async () => {
    const { app } = await makeApp({ seeded: true });
    const session = await login(app, ALICE);
    const first = await openPage(app, "/v", { cookie: session }); // the check cookie has lapsed
    expect(first.statusCode).toBe(302);
    const { p } = forumRequest(first.headers.location as string);
    const back = await app.inject({ method: "GET", url: callbackUrl(forumFailed(p.get("nonce")!)), headers: { cookie: session } });
    expect(back.headers.location).toBe("/v");
    expect(back.cookies.find((c) => c.name === "ts_session")!.value).toBe("");
  });

  it("still signed into the forum: the check keeps the session (and refreshes groups)", async () => {
    const { app } = await makeApp({ seeded: true });
    const session = await login(app, ALICE);
    const first = await openPage(app, "/v", { cookie: session });
    const { p } = forumRequest(first.headers.location as string);
    const back = await app.inject({ method: "GET", url: callbackUrl(forumResponse(p.get("nonce")!, { ...ALICE, groups: ["track-admins"] })) });
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieHeader(back) } });
    expect(me.json()).toMatchObject({ username: "alice", organiser: true });
  });

  it("no redirect for bots, HEAD requests, API calls, embeds, or anything that isn't a page navigation", async () => {
    const { app } = await makeApp({ seeded: true });
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
  });

  it("is off when forum login isn't configured (dev login only)", async () => {
    const { app } = await makeApp({ seeded: true, config: { discourseConnectSecret: "", devLogin: true } });
    expect((await openPage(app, "/v")).statusCode).toBe(200);
  });
});

describe("one sign-out", () => {
  it("ends the session and sends the browser to the forum's logout", async () => {
    const { app } = await makeApp();
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
    const { app } = await makeApp({ seeded: true });
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
