import type { RcTrack } from "@track-studio/engine";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { ForumEvents, usedAt } from "../src/forum-events.js";
import { ALICE, FORUM_URL, login, makeApp, ORGANISER, referenceJson } from "./helpers.js";

const CLUB_A = "7c002509-b640-5e9d-8e79-0ae336a2ae04";
const FREEFORM = "3b542396-6bd2-55e8-8665-852e74dc54a9";

/** What the forum plugin's GET /des/layouts/:id/events returns (newest first). */
const ev = (id: number, date: string, venue: [number, string] | null, track: [number, string] | null = null) => ({
  id,
  title: `Round ${id}`,
  start_date: date,
  url: `${FORUM_URL}/t/round-${id}/${100 + id}`,
  venue: venue && { id: venue[0], name: venue[1] },
  venue_track: track && { id: track[0], name: track[1] },
});

const HALL: [number, string] = [7, "Misfits Hall"];
const BARN: [number, string] = [9, "The Barn"];

/** A forum stub: events per layout id; counts calls. */
function forum(byLayout: Record<string, unknown[]>, opts: { down?: boolean } = {}) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (opts.down) throw new Error("connect ECONNREFUSED");
    const m = /\/des\/layouts\/([^/]+)\/events$/.exec(new URL(url).pathname);
    return Response.json({ events: (m && byLayout[decodeURIComponent(m[1])]) ?? [] });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("ForumEvents client", () => {
  it("asks the forum for the layout's events and maps them", async () => {
    const f = forum({ abc: [ev(2, "2026-10-04T09:00:00Z", HALL, [3, "Carpet"]), ev(1, "2026-09-01T09:00:00Z", null)] });
    const client = new ForumEvents({ forumUrl: FORUM_URL, fetch: f.fetch });
    const events = await client.forLayout("abc");
    expect(f.calls).toEqual([`${FORUM_URL}/des/layouts/abc/events`]);
    expect(events).toEqual([
      { id: 2, title: "Round 2", startDate: "2026-10-04T09:00:00Z", url: `${FORUM_URL}/t/round-2/102`, venue: { id: 7, name: "Misfits Hall" }, venueTrack: { id: 3, name: "Carpet" } },
      { id: 1, title: "Round 1", startDate: "2026-09-01T09:00:00Z", url: `${FORUM_URL}/t/round-1/101`, venue: null, venueTrack: null },
    ]);
  });

  it("sorts newest first, drops malformed events, and only keeps http(s) links (relative ones resolve on the forum)", async () => {
    const f = forum({
      abc: [
        ev(1, "2026-01-01", HALL),
        { ...ev(2, "2026-03-01", HALL), url: "javascript:alert(1)" },
        { ...ev(3, "2026-02-01", HALL), url: "/t/round-3/103" },
        { id: "x", title: 5 },
        null,
      ],
    });
    const events = await new ForumEvents({ forumUrl: FORUM_URL, fetch: f.fetch }).forLayout("abc");
    expect(events?.map((e) => [e.id, e.url])).toEqual([
      [2, null],
      [3, `${FORUM_URL}/t/round-3/103`],
      [1, `${FORUM_URL}/t/round-1/101`],
    ]);
  });

  it("caches for 10 minutes", async () => {
    let t = 0;
    const f = forum({ abc: [ev(1, "2026-01-01", HALL)] });
    const client = new ForumEvents({ forumUrl: FORUM_URL, fetch: f.fetch, now: () => t });
    await client.forLayout("abc");
    await Promise.all([client.forLayout("abc"), client.forLayout("abc")]);
    t = 9 * 60_000;
    await client.forLayout("abc");
    expect(f.calls).toHaveLength(1);
    t = 10 * 60_000 + 1;
    await client.forLayout("abc");
    expect(f.calls).toHaveLength(2);
  });

  it("forum down: null (unknown), or the last good answer if there is one", async () => {
    let t = 0;
    let down = false;
    const ok = forum({ abc: [ev(1, "2026-01-01", HALL)] });
    const fetch = (async (u: string) => (down ? Promise.reject(new Error("down")) : ok.fetch(u))) as typeof globalThis.fetch;
    const client = new ForumEvents({ forumUrl: FORUM_URL, fetch, now: () => t });
    expect(await client.forLayout("abc")).toHaveLength(1);
    down = true;
    t = 11 * 60_000;
    expect(await client.forLayout("abc")).toHaveLength(1);
    expect(await client.forLayout("never-seen")).toBeNull();
    // an error status or a body that isn't the events list counts as down too
    const bad = new ForumEvents({ forumUrl: FORUM_URL, fetch: (async () => new Response("<html>", { status: 502 })) as typeof globalThis.fetch });
    expect(await bad.forLayout("abc")).toBeNull();
    const odd = new ForumEvents({ forumUrl: FORUM_URL, fetch: (async () => Response.json({ nope: 1 })) as typeof globalThis.fetch });
    expect(await odd.forLayout("abc")).toBeNull();
  });

  it("gives up after the timeout", async () => {
    const hang = (async (_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof globalThis.fetch;
    const client = new ForumEvents({ forumUrl: FORUM_URL, fetch: hang, timeoutMs: 20 });
    expect(await client.forLayout("abc")).toBeNull();
  });

  it("usedAt: the events and their distinct venues, in order of most recent use", () => {
    const events = [ev(3, "2026-03-01", BARN), ev(2, "2026-02-01", HALL), ev(1, "2026-01-01", BARN), ev(0, "2025-12-01", null)].map((e) => ({
      id: e.id,
      title: e.title,
      startDate: e.start_date,
      url: e.url,
      venue: e.venue,
      venueTrack: null,
    }));
    expect(usedAt(events).venues).toEqual([
      { id: 9, name: "The Barn" },
      { id: 7, name: "Misfits Hall" },
    ]);
    expect(usedAt(events).events).toHaveLength(4);
  });
});

const req = (app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe("Used at on the track page (#66)", () => {
  it("GET /api/tracks/:id has usedAt from the forum", async () => {
    const f = forum({ [CLUB_A]: [ev(2, "2026-10-04", HALL, [3, "Carpet"]), ev(1, "2026-09-01", BARN)] });
    const { app } = await makeApp({ seeded: true, forumFetch: f.fetch });
    const got = (await req(app, "GET", `/api/tracks/${CLUB_A}`)).json();
    expect(got.usedAt.events.map((e: { id: number }) => e.id)).toEqual([2, 1]);
    expect(got.usedAt.events[0]).toMatchObject({ title: "Round 2", venue: { name: "Misfits Hall" }, venueTrack: { name: "Carpet" } });
    expect(got.usedAt.venues).toEqual([
      { id: 7, name: "Misfits Hall" },
      { id: 9, name: "The Barn" },
    ]);
  });

  it("not raced yet: an empty list; forum down: usedAt null and the page still loads", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({}).fetch });
    expect((await req(app, "GET", `/api/tracks/${CLUB_A}`)).json().usedAt).toEqual({ events: [], venues: [] });
    const down = await makeApp({ seeded: true, forumFetch: forum({}, { down: true }).fetch });
    const res = await req(down.app, "GET", `/api/tracks/${CLUB_A}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().usedAt).toBeNull();
    expect(res.json().track.locked).toBe("library");
  });
});

describe("a layout used by an event is locked (#64, #66)", () => {
  it("one or more forum events lock even a draft: locked event, can't edit, PUT -> 409 layout-locked", async () => {
    const byLayout: Record<string, unknown[]> = {};
    const { app } = await makeApp({ seeded: true, forumFetch: forum(byLayout).fetch });
    const alice = await login(app, ALICE);
    const org = await login(app, ORGANISER);
    const created = (await req(app, "POST", "/api/tracks", alice, { track: referenceJson<RcTrack>("examples/freeform-example.rctrack.json") })).json();
    const id = created.track.id as string;
    byLayout[id] = [ev(1, "2026-10-04", HALL)];
    for (const cookie of [alice, org]) {
      const got = (await req(app, "GET", `/api/tracks/${id}`, cookie)).json();
      expect(got.track).toMatchObject({ status: "draft", locked: "event" });
      expect(got.can).toMatchObject({ edit: false, copy: true });
      const res = await req(app, "PUT", `/api/tracks/${id}`, cookie, { track: created.doc });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ error: "layout-locked", details: { reason: "event", copy: `/api/tracks/${id}/copy` } });
      expect(res.json().message).toMatch(/used by an event/);
    }
    // an approved layout an event uses says so, rather than "in the library"
    byLayout[FREEFORM] = [ev(2, "2026-10-05", BARN)];
    expect((await req(app, "GET", `/api/tracks/${FREEFORM}`)).json().track.locked).toBe("event");
  });

  it("no events: a draft stays editable", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({}).fetch });
    const alice = await login(app, ALICE);
    const created = (await req(app, "POST", "/api/tracks", alice, { track: referenceJson<RcTrack>("examples/freeform-example.rctrack.json") })).json();
    const got = (await req(app, "GET", `/api/tracks/${created.track.id}`, alice)).json();
    expect(got.track.locked).toBeNull();
    expect(got.can.edit).toBe(true);
    expect((await req(app, "PUT", `/api/tracks/${created.track.id}`, alice, { track: created.doc })).statusCode).toBe(200);
  });
});

describe("Library: Raced at <venue> (#66)", () => {
  it("GET /api/raced-venues lists the venues library layouts were raced at; ?racedAt= filters to them", async () => {
    const f = forum({ [CLUB_A]: [ev(2, "2026-10-04", HALL), ev(1, "2026-09-01", BARN)], [FREEFORM]: [ev(3, "2026-08-01", BARN)] });
    const { app } = await makeApp({ seeded: true, forumFetch: f.fetch });
    expect((await req(app, "GET", "/api/raced-venues")).json()).toEqual({
      venues: [
        { id: 9, name: "The Barn", layouts: 2 },
        { id: 7, name: "Misfits Hall", layouts: 1 },
      ],
    });
    const ids = async (q: string) => ((await req(app, "GET", `/api/tracks${q}`)).json().tracks as { id: string }[]).map((t) => t.id).sort();
    expect(await ids("?racedAt=7")).toEqual([CLUB_A]);
    expect(await ids("?racedAt=9")).toEqual([CLUB_A, FREEFORM].sort());
    expect(await ids("?racedAt=9&q=freeform")).toEqual([FREEFORM]);
    expect(await ids("?racedAt=1234")).toEqual([]);
    expect((await req(app, "GET", "/api/tracks?racedAt=abc")).statusCode).toBe(400);
  });

  it("forum down: no raced venues, and the filter finds nothing rather than erroring", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({}, { down: true }).fetch });
    expect((await req(app, "GET", "/api/raced-venues")).json()).toEqual({ venues: [], unavailable: true });
    const res = await req(app, "GET", "/api/tracks?racedAt=7");
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toEqual([]);
  });
});
