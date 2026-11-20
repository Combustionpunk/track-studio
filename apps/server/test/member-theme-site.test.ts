// The member's theme on the site (#141): read from the forum at sign-in, handed to the pages with the signed-in user
// in /api/me. Pages never call the forum and never see the key; the key is never logged.
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ALICE, BOB, FORUM_URL, login, makeApp } from "./helpers.js";

const KEY = "CANARY-member-theme-key-0123456789";
const WORKS_BLUE = { theme: "works-blue-light", dark_theme: "works-blue", mode: "dark", colours: [], brand_version: "0.5.0" };
const MATCH_MY_CAR = { theme: "match-my-car", dark_theme: null, mode: "light", colours: ["#E6FF00", "#111111"], brand_version: "0.5.0" };

/** A forum with member themes (and nothing else): records each theme read; `status` overrides the answer. */
function themeForum() {
  const forum = { themes: new Map<number, unknown>([[ALICE.id, WORKS_BLUE]]), reads: [] as { id: number; key: string | null }[], status: 0 };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = new RegExp(`^${FORUM_URL}/des/members/(\\d+)/theme\\.json$`).exec(url);
    if (!m) return Promise.reject(new Error(`no network in tests (${url})`));
    const key = new Headers(init?.headers).get("api-key");
    forum.reads.push({ id: Number(m[1]), key });
    if (forum.status) return Response.json({ errors: ["no"] }, { status: forum.status });
    if (key !== KEY) return Response.json({ errors: ["not permitted"] }, { status: 403 });
    return forum.themes.has(Number(m[1])) ? Response.json(forum.themes.get(Number(m[1]))) : Response.json({ errors: ["not found"] }, { status: 404 });
  };
  return { forum, fetch };
}

function logCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, logger: { level: "trace", stream } };
}

describe("the member's theme from the forum (#141)", () => {
  it("a signed-in member's /api/me carries their theme, read at sign-in with the key", async () => {
    const { forum, fetch } = themeForum();
    const { app } = await makeApp({ config: { forumThemeApiKey: KEY }, forumFetch: fetch });
    const cookie = await login(app, ALICE);
    expect(forum.reads.map((r) => r.id)).toContain(ALICE.id);
    const me = (await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json();
    expect(me).toMatchObject({ id: ALICE.id, username: "alice", theme: WORKS_BLUE });
    expect(forum.reads).toHaveLength(1); // the sign-in's read served the page
  });

  it("Match my car comes through with its colours and mode", async () => {
    const { forum, fetch } = themeForum();
    forum.themes.set(ALICE.id, MATCH_MY_CAR);
    const { app } = await makeApp({ config: { forumThemeApiKey: KEY }, forumFetch: fetch });
    const me = (await app.inject({ method: "GET", url: "/api/me", headers: { cookie: await login(app, ALICE) } })).json();
    expect(me.theme).toEqual(MATCH_MY_CAR);
  });

  it("every sign-in reads afresh, even within the 10 minutes", async () => {
    const { forum, fetch } = themeForum();
    const { app } = await makeApp({ config: { forumThemeApiKey: KEY }, forumFetch: fetch });
    await login(app, ALICE);
    forum.themes.set(ALICE.id, MATCH_MY_CAR);
    const cookie = await login(app, ALICE);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json().theme).toEqual(MATCH_MY_CAR);
    expect(forum.reads).toHaveLength(2);
  });

  it("theme: null, a member the forum doesn't know (404), 401 and 403: no theme, so the page behaves as now", async () => {
    const { forum, fetch } = themeForum();
    forum.themes.set(ALICE.id, { theme: null, dark_theme: null, mode: "auto", colours: [], brand_version: "0.5.0" });
    const { app } = await makeApp({ config: { forumThemeApiKey: KEY }, forumFetch: fetch });
    const meOf = async (u: typeof ALICE) => (await app.inject({ method: "GET", url: "/api/me", headers: { cookie: await login(app, u) } })).json();
    expect((await meOf(ALICE)).theme).toEqual({ theme: null, dark_theme: null, mode: "auto", colours: [], brand_version: "0.5.0" });
    expect("theme" in (await meOf(BOB))).toBe(false); // 404
    for (const status of [401, 403]) {
      const { forum: f, fetch: ff } = themeForum();
      f.status = status;
      const { app: a } = await makeApp({ config: { forumThemeApiKey: KEY }, forumFetch: ff });
      const me = (await a.inject({ method: "GET", url: "/api/me", headers: { cookie: await login(a, ALICE) } })).json();
      expect(me.username).toBe("alice");
      expect("theme" in me).toBe(false);
    }
  });

  it("no key: the forum is never asked and /api/me is as before", async () => {
    const { forum, fetch } = themeForum();
    const { app } = await makeApp({ forumFetch: fetch });
    const me = (await app.inject({ method: "GET", url: "/api/me", headers: { cookie: await login(app, ALICE) } })).json();
    expect("theme" in me).toBe(false);
    expect(forum.reads).toHaveLength(0);
  });

  it("signed out: exactly as now (null), and the forum isn't asked", async () => {
    const { forum, fetch } = themeForum();
    const { app } = await makeApp({ config: { forumThemeApiKey: KEY }, forumFetch: fetch });
    expect((await app.inject({ method: "GET", url: "/api/me" })).body).toBe("null");
    expect(forum.reads).toHaveLength(0);
  });

  it("a dev login (no forum user id) is never looked up", async () => {
    const { forum, fetch } = themeForum();
    const { app } = await makeApp({ config: { forumThemeApiKey: KEY, devLogin: true }, forumFetch: fetch });
    const res = await app.inject({ method: "GET", url: "/auth/dev-login?user=dev" });
    const cookie = `ts_session=${res.cookies.find((c) => c.name === "ts_session")!.value}`;
    expect("theme" in (await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json()).toBe(false);
    expect(forum.reads).toHaveLength(0);
  });

  it("the startup log says whether members' themes are read from the forum, without the key", async () => {
    const on = logCapture();
    await makeApp({ config: { forumThemeApiKey: KEY }, logger: on.logger });
    expect(on.lines.join("")).toMatch(/members' own themes: read from the forum/);
    const off = logCapture();
    await makeApp({ logger: off.logger });
    expect(off.lines.join("")).toMatch(/members' own themes: not read from the forum \(FORUM_THEME_API_KEY not set\)/);
    expect(on.lines.join("")).not.toContain(KEY);
  });

  it("the key never appears in a log or in anything sent to a page", async () => {
    const { forum, fetch } = themeForum();
    const log = logCapture();
    const { app } = await makeApp({ seeded: true, config: { forumThemeApiKey: KEY }, forumFetch: fetch, logger: log.logger });
    const cookie = await login(app, ALICE);
    const sent: string[] = [];
    const get = async (url: string) => {
      const res = await app.inject({ method: "GET", url, headers: { cookie, accept: "text/html" } });
      sent.push(res.body, JSON.stringify(res.headers));
    };
    for (const url of ["/api/me", "/api/config", "/api/theme.json", "/", "/tracks"]) await get(url);
    // and while the forum refuses the key (the error is logged)
    forum.status = 403;
    await login(app, BOB);
    await get("/api/me");
    expect(forum.reads.every((r) => r.key === KEY)).toBe(true);
    expect(log.lines.join("\n")).toMatch(/read_member_themes/);
    expect(log.lines.join("\n")).not.toContain(KEY);
    expect(sent.join("\n")).not.toContain(KEY);
  });
});
