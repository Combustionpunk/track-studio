// A club's committee edits its own club's venue templates (#173). The forum says which club manages a venue
// (GET /des/venues/:id → venue.managing_organisation.short_code); DiscourseConnect sends the member's groups at
// sign-in, and a club's committee and officers are the forum groups "<short_code>-com" and "<short_code>-off".
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { ALICE, FORUM_URL, login, makeApp, ORGANISER, type ForumUser } from "./helpers.js";

const req = (app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

const CARL: ForumUser = { id: 201, username: "carl", groups: ["trust_level_1", "soar-mem", "soar-com"] }; // SOAR committee
const OLLIE: ForumUser = { id: 202, username: "ollie", groups: ["soar-off"] }; // SOAR officer
const DAVE: ForumUser = { id: 203, username: "dave", groups: ["brc-mem", "brc-com"] }; // BRC committee
const MEMBER: ForumUser = { id: 204, username: "molly", groups: ["soar-mem"] }; // a SOAR member, not on the committee

// forum venue 12 (SOAR's), 20 (BRC's), 30 (no managing club)
const FORUM_VENUES = [
  { id: 12, name: "Soar Hall", club: "soar", tracks: [{ id: 31, name: "Carpet" }, { id: 32, name: "Outdoor" }] },
  { id: 20, name: "Barnsley Hall", club: "brc", tracks: [{ id: 41, name: "Carpet" }] },
  { id: 30, name: "Leisure Centre", club: null, tracks: [{ id: 51, name: "Astro" }] },
];

function forum(opts: { down?: boolean } = {}) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (opts.down) throw new Error("forum down");
    if (url === `${FORUM_URL}/des/venues`) return Response.json({ venues: FORUM_VENUES.map(({ club: _c, ...v }) => v) });
    const m = /\/des\/venues\/(\d+)$/.exec(url);
    const v = m && FORUM_VENUES.find((x) => x.id === Number(m[1]));
    if (v) return Response.json({ venue: { id: v.id, name: v.name, managing_organisation: v.club ? { id: 1, name: v.club.toUpperCase(), short_code: v.club } : null } });
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls };
}

const template = (venueId: number | null, trackId?: number, name = "Hall") => ({
  info: { name, venue: venueId === null ? null : { id: venueId, name: `Venue ${venueId}`, trackId, trackName: "Carpet" } },
  area: { length: 20, width: 10 },
});

async function setup(opts: { down?: boolean } = {}) {
  const f = forum(opts);
  const { app } = await makeApp({ forumFetch: f.fetch });
  const [carl, ollie, dave, member, org, alice] = await Promise.all([CARL, OLLIE, DAVE, MEMBER, ORGANISER, ALICE].map((u) => login(app, u)));
  return { app, f, carl, ollie, dave, member, org, alice };
}

describe("a club's committee and its venue templates", () => {
  it("creates templates for its own club's venues only", async () => {
    const { app, carl, ollie, member, alice } = await setup();
    expect((await req(app, "POST", "/api/venues", carl, template(12, 31))).statusCode).toBe(201);
    expect((await req(app, "POST", "/api/venues", ollie, template(12, 32))).statusCode).toBe(201); // officers too
    const other = await req(app, "POST", "/api/venues", carl, template(20, 41));
    expect(other.statusCode).toBe(403);
    expect(other.json().message).toMatch(/committee/);
    expect((await req(app, "POST", "/api/venues", carl, template(30, 51))).statusCode).toBe(403); // no managing club: organisers only
    expect((await req(app, "POST", "/api/venues", carl, template(null))).statusCode).toBe(403); // no forum venue: organisers only
    expect((await req(app, "POST", "/api/venues", member, template(12, 31, "Again"))).statusCode).toBe(403); // a member, not the committee
    expect((await req(app, "POST", "/api/venues", alice, template(12, 31, "Again"))).statusCode).toBe(403);
  });

  it("edits its own club's templates; another club's committee can't, and a template can't be moved to another club's venue", async () => {
    const { app, carl, dave, org } = await setup();
    const soar = (await req(app, "POST", "/api/venues", org, template(12, 31))).json().venue.id as string;
    const brc = (await req(app, "POST", "/api/venues", org, template(20, 41))).json().venue.id as string;
    expect((await req(app, "PUT", `/api/venues/${soar}`, carl, template(12, 31, "Soar Hall carpet"))).statusCode).toBe(200);
    expect((await req(app, "PUT", `/api/venues/${brc}`, carl, template(20, 41, "Mine now"))).statusCode).toBe(403);
    expect((await req(app, "PUT", `/api/venues/${soar}`, dave, template(12, 31, "Mine now"))).statusCode).toBe(403);
    expect((await req(app, "PUT", `/api/venues/${soar}`, carl, template(20, 41, "Moved"))).statusCode).toBe(403);
    expect((await req(app, "PUT", `/api/venues/${brc}`, dave, template(20, 41, "Barnsley carpet"))).statusCode).toBe(200);
  });

  it("GET /api/venues/:id says so", async () => {
    const { app, carl, dave, member, org } = await setup();
    const soar = (await req(app, "POST", "/api/venues", org, template(12, 31))).json().venue.id as string;
    const none = (await req(app, "POST", "/api/venues", org, template(null))).json().venue.id as string;
    expect((await req(app, "GET", `/api/venues/${soar}`, carl)).json().can).toEqual({ edit: true });
    expect((await req(app, "GET", `/api/venues/${soar}`, dave)).json().can).toEqual({ edit: false });
    expect((await req(app, "GET", `/api/venues/${soar}`, member)).json().can).toEqual({ edit: false });
    expect((await req(app, "GET", `/api/venues/${none}`, carl)).json().can).toEqual({ edit: false });
    expect((await req(app, "GET", `/api/venues/${soar}`, org)).json().can).toEqual({ edit: true });
  });

  it("/api/me lists the clubs whose committee the member is on, read from the groups at sign-in", async () => {
    const { app, carl, ollie, member, org } = await setup();
    const clubs = async (c: string) => (await req(app, "GET", "/api/me", c)).json().clubs;
    expect(await clubs(carl)).toEqual(["soar"]);
    expect(await clubs(ollie)).toEqual(["soar"]);
    expect(await clubs(member)).toEqual([]);
    expect(await clubs(org)).toEqual([]);
  });

  it("matches club groups and short codes whatever their case", async () => {
    const { committeeClubs } = await import("../src/auth.js");
    const { parseManagingClub } = await import("../src/forum-venues.js");
    expect(committeeClubs(["SOAR-Com", "brc-off", "brc-com", "x-mem", "track-admins", "-com"])).toEqual(["brc", "soar"]);
    expect(parseManagingClub({ venue: { managing_organisation: { short_code: " SOAR " } } })).toBe("soar");
    expect(parseManagingClub({ venue: { managing_organisation: null } })).toBeNull();
  });

  it("after the forum fails, waits before asking about that venue again", async () => {
    const { app, f, carl } = await setup({ down: true });
    expect((await req(app, "POST", "/api/venues", carl, template(12, 31))).statusCode).toBe(503);
    expect((await req(app, "POST", "/api/venues", carl, template(12, 31))).statusCode).toBe(503);
    expect(f.calls.filter((u) => u === `${FORUM_URL}/des/venues/12`)).toHaveLength(1);
  });

  it("asks the forum once per venue in ten minutes", async () => {
    const { app, f, carl } = await setup();
    await req(app, "POST", "/api/venues", carl, template(12, 31));
    await req(app, "POST", "/api/venues", carl, template(12, 32));
    expect(f.calls.filter((u) => u === `${FORUM_URL}/des/venues/12`)).toHaveLength(1);
  });

  it("while the forum is down a committee member's save is refused (503); organisers carry on", async () => {
    const { app, carl, org } = await setup({ down: true });
    const res = await req(app, "POST", "/api/venues", carl, template(12, 31));
    expect(res.statusCode).toBe(503);
    expect((await req(app, "POST", "/api/venues", org, template(12, 31))).statusCode).toBe(201);
  });
});
