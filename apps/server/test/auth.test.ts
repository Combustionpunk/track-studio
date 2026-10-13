import { describe, expect, it } from "vitest";
import { signPayload } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { ADMIN, ALICE, BASE_URL, callbackUrl, FORUM_URL, forumResponse, login, makeApp, ORGANISER, SECRET, startLogin } from "./helpers.js";

describe("config", () => {
  const good = { BASE_URL: "http://192.168.0.6:3000/", FORUM_URL: "http://discourse-dev.local:3000", DISCOURSE_CONNECT_SECRET: "x".repeat(20), SESSION_SECRET: "y".repeat(40), DATA_DIR: "./data" };

  it("loads and normalises", () => {
    const c = loadConfig(good);
    expect(c.baseUrl).toBe("http://192.168.0.6:3000");
    expect(c.port).toBe(3000);
    expect(c.organiserGroup).toBe("track-admins");
    expect(c.dataDir.startsWith("/")).toBe(true);
  });

  it("lists every missing value and never echoes secrets", () => {
    const err = (() => {
      try {
        loadConfig({ ...good, SESSION_SECRET: "tooshort-but-secret", DISCOURSE_CONNECT_SECRET: "", DATA_DIR: "" });
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(err).toMatch(/DISCOURSE_CONNECT_SECRET is required/);
    expect(err).toMatch(/SESSION_SECRET must be at least 32/);
    expect(err).toMatch(/DATA_DIR is required/);
    expect(err).not.toContain("tooshort-but-secret");
  });

  it("refuses DEV_LOGIN in production", () => {
    expect(() => loadConfig({ ...good, DEV_LOGIN: "1", NODE_ENV: "production" })).toThrow(/DEV_LOGIN=1 is not allowed/);
    expect(loadConfig({ ...good, DEV_LOGIN: "1", DISCOURSE_CONNECT_SECRET: "" }).devLogin).toBe(true);
  });
});

describe("DiscourseConnect login", () => {
  it("redirects to the forum with a signed payload", async () => {
    const { app } = await makeApp();
    const { res, loc, sso, sig, nonce, returnSsoUrl } = await startLogin(app, "/t/abc");
    expect(res.statusCode).toBe(302);
    expect(`${loc.origin}${loc.pathname}`).toBe(`${FORUM_URL}/session/sso_provider`);
    expect(sig).toBe(signPayload(sso, SECRET));
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(returnSsoUrl).toBe(`${BASE_URL}/auth/callback`);
    const row = app.db.prepare("SELECT return_path, expires_at FROM auth_nonces WHERE nonce = ?").get(nonce) as { return_path: string; expires_at: number };
    expect(row.return_path).toBe("/t/abc");
    expect(row.expires_at - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it("round trip: verifies, creates the user, sets the session cookie, returns to the page", async () => {
    const { app } = await makeApp();
    const { nonce } = await startLogin(app, "/t/abc?x=1");
    const res = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, { ...ORGANISER, name: "Olive O" })) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/t/abc?x=1");
    const c = res.cookies.find((c) => c.name === "ts_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    expect(c.path).toBe("/");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: `ts_session=${c.value}` } });
    expect(me.json()).toMatchObject({ id: ORGANISER.id, username: "olive", name: "Olive O", organiser: true, admin: false });
    expect(me.json().avatarUrl).toContain("/avatar/olive.png");
  });

  it("organiser = group member or forum admin, nobody else", async () => {
    const { app } = await makeApp();
    for (const [u, organiser] of [[ALICE, false], [ORGANISER, true], [ADMIN, true]] as const) {
      const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: await login(app, u) } });
      expect(me.json().organiser).toBe(organiser);
    }
  });

  it("refreshes groups on each login", async () => {
    const { app } = await makeApp();
    await login(app, ORGANISER);
    const cookie = await login(app, { ...ORGANISER, groups: [] });
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json().organiser).toBe(false);
  });

  it("rejects a bad signature", async () => {
    const { app } = await makeApp();
    const { nonce } = await startLogin(app);
    const forged = forumResponse(nonce, { ...ALICE, admin: true }, "not-the-secret");
    const res = await app.inject({ method: "GET", url: callbackUrl(forged) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden", message: expect.stringMatching(/signature/) });
    expect(res.cookies).toHaveLength(0);
    // a valid signature over a different payload is no better
    const good = forumResponse(nonce, ALICE);
    const swapped = await app.inject({ method: "GET", url: callbackUrl({ sso: forumResponse(nonce, ADMIN).sso, sig: good.sig }) });
    expect(swapped.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/auth/callback?sso=abc&sig=zz" })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/auth/callback" })).statusCode).toBe(400);
  });

  it("rejects a reused nonce", async () => {
    const { app } = await makeApp();
    const { nonce } = await startLogin(app);
    const url = callbackUrl(forumResponse(nonce, ALICE));
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(302);
    const again = await app.inject({ method: "GET", url });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe("bad-login");
    expect(again.cookies).toHaveLength(0);
  });

  it("rejects an unknown nonce", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: callbackUrl(forumResponse("f".repeat(32), ALICE)) });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an expired nonce", async () => {
    const { app } = await makeApp();
    const { nonce } = await startLogin(app);
    app.db.prepare("UPDATE auth_nonces SET expires_at = ? WHERE nonce = ?").run(Date.now() - 1, nonce);
    const res = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)) });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/expired/);
    expect(res.cookies).toHaveLength(0);
  });

  it("only returns to local paths", async () => {
    const { app } = await makeApp();
    for (const evil of ["//evil.example/x", "https://evil.example/", "/\\evil.example", "javascript:alert(1)"]) {
      const { nonce } = await startLogin(app, evil);
      const res = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, ALICE)) });
      expect(res.headers.location).toBe("/");
    }
  });

  it("logout, and tampered or missing cookies mean logged out", async () => {
    const { app } = await makeApp();
    const cookie = await login(app, ALICE);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json().username).toBe("alice");
    const tampered = cookie.replace(/^ts_session=101/, "ts_session=1");
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: tampered } })).body).toBe("null");
    expect((await app.inject({ method: "GET", url: "/api/me" })).body).toBe("null");
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(out.cookies.find((c) => c.name === "ts_session")!.value).toBe("");
  });

  it("refuses cross-origin writes", async () => {
    const { app } = await makeApp();
    const cookie = await login(app, ALICE);
    const res = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie, origin: "http://forum.test" } });
    expect(res.statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie, origin: BASE_URL } });
    expect(ok.statusCode).toBe(200);
  });
});

describe("dev login", () => {
  it("is off unless DEV_LOGIN=1", async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: "GET", url: "/auth/dev-login?user=dev" })).statusCode).toBe(404);
  });

  it("creates a session without the forum", async () => {
    const { app } = await makeApp({ config: { devLogin: true } });
    const res = await app.inject({ method: "GET", url: "/auth/dev-login?user=dev&organiser=1&return=/t/x" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/t/x");
    const cookie = `ts_session=${res.cookies.find((c) => c.name === "ts_session")!.value}`;
    const me = (await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json();
    expect(me).toMatchObject({ username: "dev", organiser: true });
    expect(me.id).toBeLessThan(0);
    // same name -> same user
    const again = await app.inject({ method: "GET", url: "/auth/dev-login?user=dev" });
    const me2 = (await app.inject({ method: "GET", url: "/api/me", headers: { cookie: `ts_session=${again.cookies[0].value}` } })).json();
    expect(me2.id).toBe(me.id);
    expect(me2.organiser).toBe(false);
  });
});

describe("logging", () => {
  it("never logs query strings (login payloads) or cookies", async () => {
    const { buildApp } = await import("../src/app.js");
    const { testConfig } = await import("./helpers.js");
    const lines: string[] = [];
    const config = testConfig();
    const app = await buildApp(config, { logger: { level: "info", stream: { write: (s: string) => lines.push(s) } } });
    try {
      const { nonce } = await startLogin(app);
      const r = forumResponse(nonce, ALICE);
      const res = await app.inject({ method: "GET", url: callbackUrl(r) });
      const cookie = res.cookies[0].value;
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie: `ts_session=${cookie}` } });
      const log = lines.join("\n");
      expect(log).toContain('"url":"/auth/callback"');
      expect(log).not.toContain(r.sig);
      expect(log).not.toContain(encodeURIComponent(r.sso).slice(0, 20));
      expect(log).not.toContain(cookie);
      expect(log).not.toContain(SECRET);
    } finally {
      await app.close();
    }
  });
});
