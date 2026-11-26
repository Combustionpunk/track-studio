// #190: a venue template linked to a forum venue track takes its surface from the forum (the forum is the source).
// Track Studio maps the forum's surface to the format's, serves it on the template, doesn't store its own copy, and
// copies it into a layout started from or adapted to the template. Unlinked templates keep their own surface.
import type { RcTrack, RcVenue } from "@track-studio/engine";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ForumVenues, FORUM_VENUES_TTL_MS, templateSurface } from "../src/forum-venues.js";
import { withForumSurface } from "../src/venue-surface.js";
import { ALICE, FORUM_URL, login, makeApp, ORGANISER } from "./helpers.js";

const FREEFORM = "3b542396-6bd2-55e8-8665-852e74dc54a9";

/** The forum's GET /des/venues: Niagara centre's indoor track is carpet; `tracks` can be changed between calls. */
function forum() {
  const state = {
    down: false,
    tracks: [
      { id: 31, name: "Indoor (Winter)", surface: "carpet" as string | null, environment: "indoor" as string | null, width_m: 12, length_m: 22 },
      { id: 32, name: "Outdoor", surface: "grass" as string | null, environment: "outdoor" as string | null, width_m: 30, length_m: 40 },
      { id: 33, name: "Car park", surface: null as string | null, environment: null as string | null, width_m: null, length_m: null },
    ],
  };
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (state.down) throw new Error("forum down");
    if (url === `${FORUM_URL}/des/venues`) return Response.json({ venues: [{ id: 12, name: "Niagara centre", address: "Sheffield, S9 1AA", tracks: state.tracks }] });
    return new Response("not found", { status: 404 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch, state };
}

const quiet = { info: () => {}, warn: () => {} };

const req = (app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

const linked = (trackId = 31, extra: Record<string, unknown> = {}) => ({
  info: { name: "Niagara centre – Indoor (Winter)", venue: { id: 12, name: "Niagara centre", trackId, trackName: "Indoor (Winter)" } },
  area: { length: 22, width: 12 },
  rostrum: { side: "south", offset: 0 },
  obstacles: [],
  ...extra,
});

const doc = (over: Partial<RcVenue> = {}): RcVenue =>
  ({ format: "rcvenue", version: 1, id: "venue-x", revision: 1, ...linked(), ...over }) as unknown as RcVenue;

async function setup() {
  const f = forum();
  const { app } = await makeApp({ seeded: true, forumFetch: f.fetch });
  return { app, f, org: await login(app, ORGANISER), alice: await login(app, ALICE) };
}

describe("the forum's surfaces in the format", () => {
  it.each([
    ["carpet", "carpet"],
    ["astroturf", "astro"],
    ["tarmac", "tarmac"],
    ["dirt", "dirt"],
    ["mixed", "mixed"],
    ["Carpet", "carpet"],
    ["grass", null],
    ["", null],
    [null, null],
    ["constructor", null],
    ["lava", null],
  ])("forum %j → %j", (forumValue, surface) => {
    expect(templateSurface(forumValue)).toBe(surface);
  });

  it("the forum venue list carries each track's surface in the format's words", async () => {
    const { fetch } = forum();
    const list = await new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet }).list();
    expect(list.venues[0].tracks.map((t) => [t.surface, t.templateSurface])).toEqual([
      ["carpet", "carpet"],
      ["grass", null],
      [null, null],
    ]);
  });
});

describe("withForumSurface", () => {
  it("a template linked to a forum track takes the forum's surface, whatever it saved", async () => {
    const { fetch } = forum();
    const fv = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet });
    const out = await withForumSurface(doc({ surface: "astro" }), fv);
    expect(out.doc.surface).toBe("carpet");
    expect(out.forumTrack).toEqual({ known: true, surface: "carpet", environment: "indoor", stale: false });
  });

  it("a forum surface with no match (grass) or none at all: the template has no surface", async () => {
    const { fetch } = forum();
    const fv = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet });
    const grass = await withForumSurface(doc({ surface: "astro", info: linked(32).info } as Partial<RcVenue>), fv);
    expect(grass.doc).not.toHaveProperty("surface");
    expect(grass.forumTrack).toMatchObject({ known: true, surface: "grass", environment: "outdoor" });
    const none = await withForumSurface(doc({ info: linked(33).info } as Partial<RcVenue>), fv);
    expect(none.doc).not.toHaveProperty("surface");
    expect(none.forumTrack).toMatchObject({ known: true, surface: null });
  });

  it("a change on the forum shows once the cache runs out (10 minutes)", async () => {
    const { fetch, state } = forum();
    let t = 1_000_000;
    const fv = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet, now: () => t });
    expect((await withForumSurface(doc(), fv)).doc.surface).toBe("carpet");
    state.tracks[0].surface = "astroturf";
    t += FORUM_VENUES_TTL_MS - 1;
    expect((await withForumSurface(doc(), fv)).doc.surface).toBe("carpet");
    t += 1;
    expect((await withForumSurface(doc(), fv)).doc.surface).toBe("astro");
  });

  it("forum down: the last known value, marked stale; nothing known: no surface", async () => {
    const { fetch, state } = forum();
    let t = 1_000_000;
    const fv = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet, now: () => t });
    await withForumSurface(doc(), fv);
    state.down = true;
    t += FORUM_VENUES_TTL_MS + 1;
    const last = await withForumSurface(doc(), fv);
    expect(last.doc.surface).toBe("carpet");
    expect(last.forumTrack).toMatchObject({ known: true, stale: true });

    const cold = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet });
    const none = await withForumSurface(doc({ surface: "astro" }), cold);
    expect(none.doc).not.toHaveProperty("surface");
    expect(none.forumTrack).toEqual({ known: false, surface: null, environment: null, stale: false });
  });

  it("a track no longer on the forum's list: not known, no surface", async () => {
    const { fetch } = forum();
    const fv = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet });
    const out = await withForumSurface(doc({ info: linked(99).info } as Partial<RcVenue>), fv);
    expect(out.doc).not.toHaveProperty("surface");
    expect(out.forumTrack?.known).toBe(false);
  });

  it("unlinked templates, and old ones linked to a venue but no track, keep their own surface without asking the forum", async () => {
    const { fetch, calls } = forum();
    const fv = new ForumVenues({ forumUrl: FORUM_URL, fetch, log: quiet });
    const own = await withForumSurface(doc({ surface: "astro", info: { name: "Hall", venue: null } }), fv);
    expect(own).toEqual({ doc: expect.objectContaining({ surface: "astro" }), forumTrack: null });
    const legacy = await withForumSurface(doc({ surface: "dirt", info: { name: "Hall", venue: { id: 12, name: "Niagara centre" } } }), fv);
    expect(legacy).toEqual({ doc: expect.objectContaining({ surface: "dirt" }), forumTrack: null });
    expect(calls).not.toHaveBeenCalled();
  });
});

describe("venue templates and the forum's surface over the API", () => {
  it("GET /api/venues/:id: Niagara centre Indoor (Winter) is carpet, from the forum", async () => {
    const { app, org } = await setup();
    const { venue } = (await req(app, "POST", "/api/venues", org, linked())).json() as { venue: { id: string } };
    const res = (await req(app, "GET", `/api/venues/${venue.id}`)).json() as { doc: RcVenue; forumTrack: unknown };
    expect(res.doc.surface).toBe("carpet");
    expect(res.forumTrack).toEqual({ known: true, surface: "carpet", environment: "indoor", stale: false });
  });

  it("a linked template doesn't store a surface of its own: a sent one is dropped", async () => {
    const { app, org } = await setup();
    const created = await req(app, "POST", "/api/venues", org, linked(31, { surface: "astro" }));
    expect(created.statusCode).toBe(201);
    const { venue, doc } = created.json() as { venue: { id: string }; doc: RcVenue };
    expect(doc.surface).toBe("carpet"); // the answer is what the forum says
    const raw = (await req(app, "GET", `/api/venues/${venue.id}/r/1`)).json() as RcVenue;
    expect(raw.surface).toBe("carpet");
    const { db } = app as unknown as { db: { prepare(s: string): { pluck(): { get(...a: unknown[]): string } } } };
    const stored = JSON.parse(db.prepare("SELECT rcvenue_json FROM venue_revisions WHERE venue_id = ? AND revision = 1").pluck().get(venue.id)) as RcVenue;
    expect(stored).not.toHaveProperty("surface");
    // a forum value the format doesn't know isn't a reason to refuse the save either
    const updated = await req(app, "PUT", `/api/venues/${venue.id}`, org, linked(31, { surface: "grass" }));
    expect(updated.statusCode).toBe(200);
  });

  it("an unlinked template can still set its surface by hand", async () => {
    const { app, org, f } = await setup();
    const body = { ...linked(31, { surface: "astro" }), info: { name: "Scout hut", venue: null } };
    const { venue } = (await req(app, "POST", "/api/venues", org, body)).json() as { venue: { id: string } };
    const res = (await req(app, "GET", `/api/venues/${venue.id}`)).json() as { doc: RcVenue; forumTrack: unknown };
    expect(res.doc.surface).toBe("astro");
    expect(res.forumTrack).toBeNull();
    expect((await req(app, "POST", "/api/venues", org, { ...body, info: { name: "Barn", venue: null }, surface: "grass" })).statusCode).toBe(400);
    expect(f.calls).not.toHaveBeenCalledWith(`${FORUM_URL}/des/venues`, expect.anything());
  });

  it("the forum plugin's lookup by forum track has the forum's surface too", async () => {
    const { app, org } = await setup();
    await req(app, "POST", "/api/venues", org, linked());
    const res = (await req(app, "GET", "/api/venues?forumTrack=31")).json() as { doc: RcVenue };
    expect(res.doc.surface).toBe("carpet");
  });

  it("a layout adapted to the template gets info.surface from the forum", async () => {
    const { app, org, alice, f } = await setup();
    f.state.tracks[0].surface = "astroturf"; // the example layout is carpet: the copy must take the venue's
    const v = (await req(app, "GET", "/api/venues/venue-2")).json().doc as RcVenue;
    const put = await req(app, "PUT", "/api/venues/venue-2", org, { ...v, info: { ...v.info, venue: { id: 12, name: "Niagara centre", trackId: 31, trackName: "Indoor (Winter)" } } });
    expect(put.statusCode).toBe(200);
    const res = await req(app, "POST", `/api/tracks/${FREEFORM}/adapt/venue-2`, alice);
    expect(res.statusCode).toBe(201);
    expect((res.json().doc as RcTrack).info.surface).toBe("astro");
  });
});
