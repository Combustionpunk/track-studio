// The member's theme, read from the forum server to server (#141; the forum side is plugin #457, the same contract as
// the timing site's #166): the reader on its own, against a stub forum, with its own clock.
import { describe, expect, it } from "vitest";
import {
  MEMBER_THEME_FAIL_MS,
  MEMBER_THEME_STALE_MS,
  MEMBER_THEME_TIMEOUT_MS,
  MEMBER_THEME_TTL_MS,
  MemberThemes,
  parseMemberTheme,
  type ForumMemberTheme,
} from "../src/member-theme.js";

const FORUM = "http://forum.test";
const KEY = "CANARY-member-theme-key-0123456789";

const WORKS_BLUE: ForumMemberTheme = { theme: "works-blue-light", dark_theme: "works-blue", mode: "auto", colours: [], brand_version: "0.5.0" };

/** A forum that answers what the test says, checks the key as Discourse does (403 for a wrong one), and records each read. */
function stubForum() {
  const forum = {
    now: 1_000_000,
    themes: new Map<number, unknown>(),
    /** what the next reads answer instead: a status, "hang" (never), "down" (connection refused) */
    fail: null as null | number | "hang" | "down",
    reads: [] as { url: string; headers: Record<string, string> }[],
    lines: [] as string[],
  };
  const fetch = async (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
    forum.reads.push({ url, headers: init.headers });
    const json = (status: number, body: unknown) => ({ status, json: async () => body });
    if (forum.fail === "down") throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:9") });
    if (forum.fail === "hang")
      return new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    if (typeof forum.fail === "number") return json(forum.fail, { errors: ["no"] });
    if (init.headers["api-key"] !== KEY) return json(403, { errors: ["You are not permitted to view the requested resource."] });
    const id = Number(/\/des\/members\/(\d+)\/theme\.json$/.exec(url)?.[1]);
    return forum.themes.has(id) ? json(200, forum.themes.get(id)) : json(404, { errors: ["not found"] });
  };
  const reader = (over: { apiKey?: string; timeoutMs?: number } = {}) =>
    new MemberThemes({ forumUrl: FORUM, apiKey: KEY, fetch, now: () => forum.now, print: (l) => forum.lines.push(l), ...over });
  return { forum, reader };
}

describe("parseMemberTheme", () => {
  it("keeps the contract's fields, checked; anything else is dropped", () => {
    expect(parseMemberTheme({ ...WORKS_BLUE, extra: "x", email: "a@b" })).toEqual(WORKS_BLUE);
    expect(parseMemberTheme({ theme: null, dark_theme: null, mode: "auto", colours: [], brand_version: "0.5.0" })).toEqual({
      theme: null,
      dark_theme: null,
      mode: "auto",
      colours: [],
      brand_version: "0.5.0",
    });
    expect(parseMemberTheme({ theme: "match-my-car", mode: "dark", colours: ["#E6FF00", 7, "#000000"] })).toEqual({ theme: "match-my-car", mode: "dark", colours: ["#E6FF00", "#000000"] });
    expect(parseMemberTheme({ theme: "x", mode: 3, dark_theme: {} })).toEqual({ theme: "x" });
  });

  it("isn't a theme body: undefined", () => {
    for (const v of [null, [], "pit-lane", {}, { theme: 3 }, { theme: "x".repeat(200) }]) expect(parseMemberTheme(v)).toBeUndefined();
  });
});

describe("MemberThemes", () => {
  it("asks the forum for the member by forum user id, with the key as the Api-Key header only", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    expect(await reader().get(101)).toEqual(WORKS_BLUE);
    expect(forum.reads).toHaveLength(1);
    expect(forum.reads[0]!.url).toBe(`${FORUM}/des/members/101/theme.json`);
    expect(forum.reads[0]!.headers["api-key"]).toBe(KEY);
    expect(forum.reads[0]!.url).not.toContain(KEY);
  });

  it("answers each mode, Match my car and null as the forum sent them", async () => {
    const { forum, reader } = stubForum();
    const bodies: ForumMemberTheme[] = [
      { ...WORKS_BLUE, mode: "light" },
      { ...WORKS_BLUE, mode: "dark" },
      { ...WORKS_BLUE, mode: "auto" },
      { theme: "match-my-car", dark_theme: null, mode: "dark", colours: ["#E6FF00", "#111111"], brand_version: "0.5.0" },
      { theme: null, dark_theme: null, mode: "auto", colours: [], brand_version: "0.5.0" },
      { theme: "a-newer-palette", dark_theme: null, mode: "light", colours: [], brand_version: "0.9.0" },
    ];
    bodies.forEach((b, i) => forum.themes.set(200 + i, b));
    const r = reader();
    for (const [i, b] of bodies.entries()) expect(await r.get(200 + i)).toEqual(b);
  });

  it("no key: never asks the forum", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    const r = reader({ apiKey: "  " });
    expect(r.enabled).toBe(false);
    expect(await r.get(101)).toBeNull();
    expect(await r.refresh(101)).toBeNull();
    expect(forum.reads).toHaveLength(0);
  });

  it("not a forum user id (a dev login is negative): never asks", async () => {
    const { forum, reader } = stubForum();
    const r = reader();
    for (const id of [-1, 0, 1.5, Number.NaN]) expect(await r.get(id)).toBeNull();
    expect(forum.reads).toHaveLength(0);
  });

  it.each([401, 403, 404, 500, 502])("%i: null (so the page shows the club's theme, then Pit Lane)", async (status) => {
    const { forum, reader } = stubForum();
    forum.fail = status;
    expect(await reader().get(101)).toBeNull();
  });

  it("a wrong key is a 403: null, and the log says what the key needs without the key", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    const r = new MemberThemes({ forumUrl: FORUM, apiKey: "wrong-key-abcdef", fetch: (u, i) => stubForumFetch(forum, u, i), now: () => forum.now, print: (l) => forum.lines.push(l) });
    expect(await r.get(101)).toBeNull();
    expect(forum.lines.join("\n")).toMatch(/403.*read_member_themes/);
    expect(forum.lines.join("\n")).not.toContain("wrong-key-abcdef");
  });

  it(`a forum that doesn't answer within ${MEMBER_THEME_TIMEOUT_MS} ms: null`, async () => {
    const { forum, reader } = stubForum();
    forum.fail = "hang";
    const started = Date.now();
    expect(await reader({ timeoutMs: 50 }).get(101)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(forum.lines.join("\n")).toContain("no answer within 50 ms");
    expect(MEMBER_THEME_TIMEOUT_MS).toBe(2000);
  });

  it("a forum that is down: null", async () => {
    const { forum, reader } = stubForum();
    forum.fail = "down";
    expect(await reader().get(101)).toBeNull();
    expect(forum.lines.join("\n")).toContain("ECONNREFUSED");
  });

  it("keeps an answer 10 minutes per member, then asks again", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    const r = reader();
    await r.get(101);
    forum.now += MEMBER_THEME_TTL_MS - 1;
    await r.get(101);
    expect(forum.reads).toHaveLength(1);
    forum.now += 1;
    await r.get(101);
    expect(forum.reads).toHaveLength(2);
    expect(MEMBER_THEME_TTL_MS).toBe(10 * 60_000);
  });

  it("keeps a 404 (no such member) too, as an answer", async () => {
    const { forum, reader } = stubForum();
    const r = reader();
    expect(await r.get(999)).toBeNull();
    expect(await r.get(999)).toBeNull();
    expect(forum.reads).toHaveLength(1);
  });

  it("reads afresh at sign-in, whatever the cache holds", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    const r = reader();
    await r.get(101);
    const changed = { ...WORKS_BLUE, mode: "dark" };
    forum.themes.set(101, changed);
    expect(await r.get(101)).toEqual(WORKS_BLUE); // still cached
    expect(await r.refresh(101)).toEqual(changed);
    expect(await r.get(101)).toEqual(changed);
    expect(forum.reads).toHaveLength(2);
  });

  it("reads at once share one request", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    const r = reader();
    const all = await Promise.all([r.refresh(101), r.get(101), r.get(101)]);
    expect(all).toEqual([WORKS_BLUE, WORKS_BLUE, WORKS_BLUE]);
    expect(forum.reads).toHaveLength(1);
  });

  it("while the forum fails, the last good answer stands in for up to an hour", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    const r = reader();
    await r.get(101);
    forum.now += MEMBER_THEME_TTL_MS; // stale now
    forum.fail = 503;
    expect(await r.get(101)).toEqual(WORKS_BLUE);
    forum.now += MEMBER_THEME_FAIL_MS;
    expect(await r.get(101)).toEqual(WORKS_BLUE);
    // an hour after the forum gave it, it's gone
    forum.now = 1_000_000 + MEMBER_THEME_STALE_MS;
    expect(await r.get(101)).toBeNull();
    expect(MEMBER_THEME_STALE_MS).toBe(60 * 60_000);
  });

  it("after a failure the forum isn't asked again for a minute, for anyone, sign-ins included", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    forum.themes.set(102, WORKS_BLUE);
    const r = reader();
    forum.fail = "down";
    await r.get(101);
    expect(forum.reads).toHaveLength(1);
    forum.fail = null;
    forum.now += MEMBER_THEME_FAIL_MS - 1;
    expect(await r.get(101)).toBeNull();
    expect(await r.get(102)).toBeNull();
    expect(await r.refresh(102)).toBeNull();
    expect(forum.reads).toHaveLength(1);
    forum.now += 1;
    expect(await r.get(101)).toEqual(WORKS_BLUE);
    expect(forum.reads).toHaveLength(2);
    expect(MEMBER_THEME_FAIL_MS).toBe(60_000);
  });

  it("says once when the forum starts failing, and once when it answers again", async () => {
    const { forum, reader } = stubForum();
    forum.themes.set(101, WORKS_BLUE);
    const r = reader();
    forum.fail = 502;
    await r.get(101);
    forum.now += MEMBER_THEME_FAIL_MS;
    await r.get(101);
    forum.fail = null;
    forum.now += MEMBER_THEME_FAIL_MS;
    await r.get(101);
    expect(forum.lines).toHaveLength(2);
    expect(forum.lines[0]).toMatch(/can't read/);
    expect(forum.lines[1]).toMatch(/answering again/);
    expect(forum.lines.join("\n")).not.toContain(KEY);
  });
});

/** The same stub's fetch, for a reader built with another key. */
function stubForumFetch(forum: { themes: Map<number, unknown>; reads: { url: string; headers: Record<string, string> }[] }, url: string, init: { headers: Record<string, string> }) {
  forum.reads.push({ url, headers: init.headers });
  const json = (status: number, body: unknown) => Promise.resolve({ status, json: async () => body });
  if (init.headers["api-key"] !== KEY) return json(403, { errors: ["no"] });
  const id = Number(/\/des\/members\/(\d+)\/theme\.json$/.exec(url)?.[1]);
  return forum.themes.has(id) ? json(200, forum.themes.get(id)) : json(404, {});
}
