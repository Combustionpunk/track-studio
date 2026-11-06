// Venue templates (#12): organisers create and edit them, every save is a new revision with a visible history,
// tracks keep the revision they were drawn on and new designs pick up the latest.
import { validateVenue, type RcTrack, type RcVenue } from "@track-studio/engine";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { ADMIN, ALICE, login, makeApp, ORGANISER, referenceJson } from "./helpers.js";

const req = (app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function setup() {
  const { app } = await makeApp({ seeded: true });
  return { app, alice: await login(app, ALICE), org: await login(app, ORGANISER), admin: await login(app, ADMIN) };
}

/** What the venue editor sends for a new venue: no id, revision or format fields. */
const newVenue = () => ({
  info: { name: "Misfits Main Hall", venue: { id: 12, name: "Misfits Main Hall", trackId: 31, trackName: "Indoor carpet" }, notes: "Pillar by the door" },
  area: { length: 22, width: 12 },
  rostrum: { side: "south", offset: -4 },
  obstacles: [
    { type: "circle", x: 9, z: 2, radius: 0.5, label: "Pillar" },
    { type: "rect", x: -10, z: 5, length: 2, width: 1, rotation: 0, label: "Fire door keep-clear" },
  ],
});

describe("venue editing permissions", () => {
  it("organisers and forum admins create and edit; members and visitors can't", async () => {
    const { app, alice, org, admin } = await setup();
    expect((await req(app, "POST", "/api/venues", undefined, newVenue())).statusCode).toBe(401);
    expect((await req(app, "PUT", "/api/venues/venue-1", undefined, newVenue())).statusCode).toBe(401);
    expect((await req(app, "POST", "/api/venues", alice, newVenue())).statusCode).toBe(403);
    expect((await req(app, "PUT", "/api/venues/venue-1", alice, newVenue())).statusCode).toBe(403);
    expect((await req(app, "POST", "/api/venues", org, newVenue())).statusCode).toBe(201);
    // another template, so another forum track (one template per track, #65)
    const other = { ...newVenue(), info: { name: "Club hall", venue: { id: 1, name: "Club hall", trackId: 7, trackName: "Carpet" } } };
    expect((await req(app, "PUT", "/api/venues/venue-1", admin, other)).statusCode).toBe(200);
  });

  it("GET /api/venues/:id says who may edit", async () => {
    const { app, alice, org } = await setup();
    expect((await req(app, "GET", "/api/venues/venue-1")).json().can).toEqual({ edit: false });
    expect((await req(app, "GET", "/api/venues/venue-1", alice)).json().can).toEqual({ edit: false });
    expect((await req(app, "GET", "/api/venues/venue-1", org)).json().can).toEqual({ edit: true });
  });
});

describe("saved venue files", () => {
  it("are valid rcvenue documents in metres, with a generated id", async () => {
    const { app, org } = await setup();
    const res = await req(app, "POST", "/api/venues", org, newVenue());
    const { venue, doc } = res.json() as { venue: { id: string }; doc: RcVenue };
    expect(venue.id).toMatch(/^venue-[0-9a-f]{8}$/);
    expect(validateVenue(doc)).toEqual({ valid: true, errors: [] });
    const stored = (await req(app, "GET", `/api/venues/${venue.id}`)).json().doc as RcVenue;
    expect(stored).toEqual({ format: "rcvenue", version: 1, id: venue.id, revision: 1, ...newVenue() });
  });

  it("reject what the schema rejects", async () => {
    const { app, org } = await setup();
    const bad = [
      { ...newVenue(), area: { length: 0, width: 12 } },
      { ...newVenue(), rostrum: { side: "up" } },
      { ...newVenue(), obstacles: [{ type: "circle", x: 0, z: 0 }] },
      { ...newVenue(), info: { name: "x".repeat(81) } },
    ];
    bad.push({ ...newVenue(), id: "new" } as never); // /v/new is the editor
    for (const b of bad) {
      const res = await req(app, "POST", "/api/venues", org, b);
      expect(res.statusCode, JSON.stringify(b).slice(0, 80)).toBe(400);
      expect(res.json().error).toBe("invalid-venue");
    }
  });
});

describe("venue revisions", () => {
  it("each save is a new revision; the history lists them all, newest first, and each can be fetched", async () => {
    const { app, org, admin } = await setup();
    const { venue } = (await req(app, "POST", "/api/venues", org, newVenue())).json();
    const v2 = { ...newVenue(), area: { length: 24, width: 12 } };
    expect((await req(app, "PUT", `/api/venues/${venue.id}`, org, { venue: v2, baseRevision: 1 })).json().venue.revision).toBe(2);
    expect((await req(app, "PUT", `/api/venues/${venue.id}`, admin, { venue: { ...v2, info: { name: "Main hall" } }, baseRevision: 2 })).json().venue).toMatchObject({ revision: 3, name: "Main hall" });

    const revs = (await req(app, "GET", `/api/venues/${venue.id}/revisions`)).json().revisions;
    expect(revs.map((r: { revision: number }) => r.revision)).toEqual([3, 2, 1]);
    expect(revs.map((r: { createdBy: { username: string } }) => r.createdBy.username)).toEqual(["root", "olive", "olive"]);
    expect(revs[0]).toMatchObject({ name: "Main hall", area: { length: 24, width: 12 }, obstacles: 2, downloadUrl: `/api/venues/${venue.id}/r/3.rcvenue.json` });
    expect(typeof revs[0].createdAt).toBe("string");

    expect((await req(app, "GET", `/api/venues/${venue.id}/r/1`)).json().area).toEqual({ length: 22, width: 12 });
    const dl = await req(app, "GET", `/api/venues/${venue.id}/r/2.rcvenue.json`);
    expect(dl.headers["content-disposition"]).toBe('attachment; filename="misfits-main-hall-r2.rcvenue.json"');
    expect(dl.json().revision).toBe(2);
    for (const url of [`/api/venues/${venue.id}/r/9`, `/api/venues/${venue.id}/r/x`, "/api/venues/nope/revisions"]) expect((await req(app, "GET", url)).statusCode, url).toBe(404);
  });

  it("a revision whose author has no user row (seeded or imported) still lists, as an unknown author, and downloads (#30)", async () => {
    const { app, org } = await setup();
    const { venue } = (await req(app, "POST", "/api/venues", org, newVenue())).json();
    await req(app, "PUT", `/api/venues/${venue.id}`, org, { venue: newVenue(), baseRevision: 1 });
    await req(app, "PUT", `/api/venues/${venue.id}`, org, { venue: newVenue(), baseRevision: 2 });
    app.db.pragma("foreign_keys = OFF");
    app.db.prepare("UPDATE venue_revisions SET created_by = 999999 WHERE venue_id = ? AND revision = 2").run(venue.id);
    app.db.pragma("foreign_keys = ON");

    const revs = (await req(app, "GET", `/api/venues/${venue.id}/revisions`)).json().revisions;
    expect(revs.map((r: { revision: number }) => r.revision)).toEqual([3, 2, 1]);
    expect(revs.map((r: { createdBy: unknown }) => r.createdBy)).toEqual([
      { id: ORGANISER.id, username: "olive" },
      { id: 999999, username: null },
      { id: ORGANISER.id, username: "olive" },
    ]);
    const dl = await req(app, "GET", revs[1].downloadUrl);
    expect(dl.statusCode).toBe(200);
    expect(dl.json().revision).toBe(2);
  });

  it("a save on top of a stale revision is refused", async () => {
    const { app, org } = await setup();
    expect((await req(app, "PUT", "/api/venues/venue-2", org, { venue: newVenue(), baseRevision: 1 })).statusCode).toBe(200);
    const stale = await req(app, "PUT", "/api/venues/venue-2", org, { venue: newVenue(), baseRevision: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("stale");
  });

  it("existing tracks keep their basedOn revision; new designs use the latest", async () => {
    const { app, alice, org } = await setup();
    const before = (await req(app, "GET", "/api/tracks?venue=venue-2")).json().tracks as { id: string }[];
    expect(before.length).toBeGreaterThan(0);
    const basedOn = async () => Promise.all(before.map(async (t) => ((await req(app, "GET", `/api/tracks/${t.id}`)).json().doc as RcTrack).basedOn));
    const was = await basedOn();
    expect(was.every((b) => b?.venueTemplate === "venue-2" && b.revision === 1)).toBe(true);

    const sports = referenceJson<RcVenue>("venues/sports-hall-b.rcvenue.json");
    const edited = { ...sports, area: { length: 26, width: 15 }, obstacles: [] };
    expect((await req(app, "PUT", "/api/venues/venue-2", org, { venue: edited })).json().venue.revision).toBe(2);
    expect(await basedOn()).toEqual(was);

    const track = referenceJson<RcTrack>("examples/freeform-example.rctrack.json");
    const created = await req(app, "POST", "/api/tracks", alice, { track: { info: { name: "On the new hall" }, design: track.design }, fromVenue: "venue-2" });
    expect(created.statusCode, created.body).toBe(201);
    const doc = created.json().doc as RcTrack;
    expect(doc.basedOn).toEqual({ venueTemplate: "venue-2", revision: 2 });
    expect(doc.area).toEqual({ length: 26, width: 15 });
    expect(doc.obstacles).toEqual([]);
  });

  it("venue summaries count the tracks drawn on each venue", async () => {
    const { app } = await setup();
    const list = (await req(app, "GET", "/api/venues")).json().venues as { id: string; tracks: number }[];
    const counts = Object.fromEntries(list.map((v) => [v.id, v.tracks]));
    const onSports = (await req(app, "GET", "/api/tracks?venue=venue-2")).json().tracks.length;
    expect(counts["venue-2"]).toBe(onSports);
    expect((await req(app, "GET", "/api/venues/venue-2")).json().venue.tracks).toBe(onSports);
  });
});

describe("venue editor pages", () => {
  it("/v/new and /v/:id/edit serve the app", async () => {
    const { app } = await setup();
    const html = { accept: "text/html" };
    expect((await app.inject({ method: "GET", url: "/v/new", headers: html })).statusCode).toBe(200);
    const edit = await app.inject({ method: "GET", url: "/v/venue-2/edit", headers: html });
    expect(edit.statusCode).toBe(200);
    expect(edit.body).toContain("<title>Edit Sports hall B · Track Studio</title>");
    expect((await app.inject({ method: "GET", url: "/v/nope/edit", headers: html })).statusCode).toBe(404);
  });
});
