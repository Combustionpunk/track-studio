// Venue templates link to one forum venue and one of its tracks (#65): the forum's venue list (cached, survives the
// forum being down), one template per forum track, and the lookup the forum plugin's layout picker uses.
import { validateVenue, type RcVenue } from "@track-studio/engine";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ForumVenues, FORUM_VENUES_TTL_MS } from "../src/forum-venues.js";
import { FORUM_URL, login, makeApp, ORGANISER } from "./helpers.js";

/** What the forum's GET /des/venues answers (more fields than Track Studio passes on). */
const forumList = () => [
  {
    id: 12,
    name: "Misfits Main Hall",
    town: "Leeds",
    status: "approved",
    contact_email: "not-for-us@example.test",
    tracks: [
      { id: 31, name: "Indoor carpet", surface: "carpet", environment: "indoor", width_m: 12, length_m: 22, rostrum_covered: true, pits: 30 },
      { id: 32, name: "Outdoor tarmac", surface: "tarmac", environment: "outdoor", width_m: 20, length_m: 40, rostrum_covered: false, pits: 40 },
    ],
  },
  { id: 14, name: "Village Hall", town: "Otley", tracks: [{ id: 40, name: "Main floor", surface: "carpet", environment: "indoor", width_m: null, length_m: null }] },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A forum that answers until `down` is set. */
function fakeForum(body: unknown = forumList()) {
  const state = { down: false };
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => (state.down ? Promise.reject(new Error("forum down")) : json(body)));
  return { fetch: fetch as unknown as typeof globalThis.fetch & typeof fetch, state };
}

const quiet = { info: () => {}, warn: () => {} };

describe("forum venue client", () => {
  it("fetches FORUM_URL/des/venues with a timeout and keeps id, name, town and tracks only", async () => {
    const { fetch } = fakeForum();
    const list = await new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet }).list();
    expect(fetch).toHaveBeenCalledWith(`${FORUM_URL}/des/venues`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(list.stale).toBe(false);
    expect(list.venues[0]).toEqual({
      id: 12,
      name: "Misfits Main Hall",
      town: "Leeds",
      tracks: [
        { id: 31, name: "Indoor carpet", surface: "carpet", environment: "indoor", width_m: 12, length_m: 22 },
        { id: 32, name: "Outdoor tarmac", surface: "tarmac", environment: "outdoor", width_m: 20, length_m: 40 },
      ],
    });
    expect(list.venues[1].tracks[0]).toMatchObject({ width_m: null, length_m: null });
  });

  it("accepts {venues: [...]} as well as a bare list", async () => {
    const { fetch } = fakeForum({ venues: forumList() });
    expect((await new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet }).list()).venues.map((v) => v.id)).toEqual([12, 14]);
  });

  it("caches the list for 10 minutes", async () => {
    let t = 0;
    const { fetch } = fakeForum();
    const client = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet, now: () => t });
    await client.list();
    t = FORUM_VENUES_TTL_MS - 1;
    await client.list();
    expect(fetch).toHaveBeenCalledTimes(1);
    t = FORUM_VENUES_TTL_MS + 1;
    await client.list();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("forum down: the last cached copy, marked stale", async () => {
    let t = 0;
    const { fetch, state } = fakeForum();
    const client = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet, now: () => t });
    const first = await client.list();
    state.down = true;
    t = FORUM_VENUES_TTL_MS + 1;
    const second = await client.list();
    expect(second).toMatchObject({ stale: true, fetchedAt: first.fetchedAt });
    expect(second.venues).toEqual(first.venues);
  });

  it("forum down and nothing cached: a 503 forum-unavailable error, and no retry storm", async () => {
    const fetch = vi.fn(async () => json({ error: "nope" }, 502));
    const client = new ForumVenues({ forumUrl: FORUM_URL, fetch: fetch as unknown as typeof globalThis.fetch, log: quiet, now: () => 0 });
    await expect(client.list()).rejects.toMatchObject({ statusCode: 503, code: "forum-unavailable" });
    await expect(client.list()).rejects.toMatchObject({ statusCode: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("an answer that isn't a venue list counts as the forum being down", async () => {
    const { fetch } = fakeForum({ hello: "world" });
    await expect(new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet }).list()).rejects.toMatchObject({ statusCode: 503 });
  });
});

// ------------------------------------------------------------------------------------------------ API
const req = (app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function setup(forum = fakeForum()) {
  const { app } = await makeApp({ seeded: true, forumFetch: forum.fetch });
  return { app, forum, org: await login(app, ORGANISER) };
}

const linked = (trackId = 31, over: Record<string, unknown> = {}) => ({
  info: { name: "Misfits Main Hall – Indoor carpet", venue: { id: 12, name: "Misfits Main Hall", trackId, trackName: trackId === 31 ? "Indoor carpet" : "Outdoor tarmac" } },
  area: { length: 22, width: 12 },
  rostrum: { side: "south", offset: 0 },
  obstacles: [],
  ...over,
});

describe("GET /api/forum-venues", () => {
  it("passes the forum's list through", async () => {
    const { app } = await setup();
    const res = await req(app, "GET", "/api/forum-venues");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ stale: false, fetchedAt: expect.any(String) });
    expect(body.venues).toHaveLength(2);
    expect(body.venues[0]).not.toHaveProperty("contact_email");
  });

  it("?q= matches venue name, town or track name, ignoring case", async () => {
    const { app } = await setup();
    const ids = async (q: string) => (await req(app, "GET", `/api/forum-venues?q=${encodeURIComponent(q)}`)).json().venues.map((v: { id: number }) => v.id);
    expect(await ids("village")).toEqual([14]);
    expect(await ids("LEEDS")).toEqual([12]);
    expect(await ids("tarmac")).toEqual([12]);
    expect(await ids("nowhere")).toEqual([]);
    expect(await ids("")).toEqual([12, 14]);
  });

  it("forum unreachable: 503 forum-unavailable, not a crash", async () => {
    const forum = fakeForum();
    forum.state.down = true;
    const { app } = await setup(forum);
    const res = await req(app, "GET", "/api/forum-venues");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "forum-unavailable", message: expect.stringContaining("Forum unavailable") });
  });
});

describe("templates linked to a forum track", () => {
  it("saves info.venue with both ids and names, and lists the forum track", async () => {
    const { app, org } = await setup();
    const res = await req(app, "POST", "/api/venues", org, linked());
    expect(res.statusCode).toBe(201);
    const { venue, doc } = res.json() as { venue: { id: string; forumVenueId: number; forumTrackId: number }; doc: RcVenue };
    expect(doc.info.venue).toEqual({ id: 12, name: "Misfits Main Hall", trackId: 31, trackName: "Indoor carpet" });
    expect(validateVenue(doc).valid).toBe(true);
    expect(venue).toMatchObject({ forumVenueId: 12, forumTrackId: 31 });
    expect((await req(app, "GET", "/api/venues")).json().venues.find((v: { id: string }) => v.id === venue.id)).toMatchObject({ forumTrackId: 31 });
  });

  it("a new template linked to a forum venue must say which track", async () => {
    const { app, org } = await setup();
    const res = await req(app, "POST", "/api/venues", org, { ...linked(), info: { name: "Hall", venue: { id: 12, name: "Misfits Main Hall" } } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid-venue", message: expect.stringContaining("track") });
    // not linked at all is still fine (the forum may be down)
    expect((await req(app, "POST", "/api/venues", org, { ...linked(), info: { name: "Hall", venue: null } })).statusCode).toBe(201);
  });

  it("old templates with only info.venue.id still load and save", async () => {
    const { app, org } = await setup();
    const old = (await req(app, "GET", "/api/venues/venue-1")).json();
    expect(old.doc.info.venue).toEqual({ id: 1, name: "Club hall" });
    expect(old.venue).toMatchObject({ forumVenueId: 1, forumTrackId: null });
    const res = await req(app, "PUT", "/api/venues/venue-1", org, { venue: { ...old.doc, area: { length: 23, width: 12 } }, baseRevision: old.venue.revision });
    expect(res.statusCode).toBe(200);
  });

  it("a second template for the same forum track is refused with 409 and a link to the first", async () => {
    const { app, org } = await setup();
    const first = (await req(app, "POST", "/api/venues", org, linked())).json().venue;
    const again = await req(app, "POST", "/api/venues", org, { ...linked(), info: { ...linked().info, name: "Copy" } });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: "forum-track-taken", details: { venue: { id: first.id, name: first.name, url: `/v/${first.id}` } } });
    // another track at the same forum venue is fine
    expect((await req(app, "POST", "/api/venues", org, linked(32))).statusCode).toBe(201);
    // so is saving the first again, and re-linking another template to the taken track is not
    expect((await req(app, "PUT", `/api/venues/${first.id}`, org, { venue: linked(), baseRevision: 1 })).statusCode).toBe(200);
    const moved = await req(app, "PUT", "/api/venues/venue-1", org, { venue: linked() });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().details.venue.id).toBe(first.id);
  });

  it("GET /api/venues?forumTrack=<id> returns the template, or 404", async () => {
    const { app, org } = await setup();
    const { venue } = (await req(app, "POST", "/api/venues", org, linked())).json();
    const res = await req(app, "GET", "/api/venues?forumTrack=31");
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.json()).toMatchObject({ venue: { id: venue.id, forumTrackId: 31 }, doc: { info: { venue: { trackId: 31 } } } });
    expect((await req(app, "GET", "/api/venues?forumTrack=32")).statusCode).toBe(404);
    expect((await req(app, "GET", "/api/venues?forumTrack=abc")).statusCode).toBe(404);
    // without the parameter it's still the list
    expect((await req(app, "GET", "/api/venues")).json().venues.length).toBeGreaterThan(1);
  });
});
