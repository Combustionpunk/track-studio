import { bakeBuilt, type FitResult, type RcTrack, type RcVenue } from "@track-studio/engine";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_DIR } from "../src/config.js";
import { ALICE, BOB, login, makeApp, ORGANISER, referenceJson } from "./helpers.js";

const freeform = () => referenceJson<RcTrack>("examples/freeform-example.rctrack.json");
const fitExpected = JSON.parse(readFileSync(join(ROOT_DIR, "packages/engine/test/fixtures/fit-expected.json"), "utf8")) as Record<string, FitResult[]>;
const CLUB_A = "7c002509-b640-5e9d-8e79-0ae336a2ae04";
const FREEFORM = "3b542396-6bd2-55e8-8665-852e74dc54a9";

async function setup() {
  const { app } = await makeApp({ seeded: true });
  const alice = await login(app, ALICE);
  const bob = await login(app, BOB);
  const org = await login(app, ORGANISER);
  return { app, alice, bob, org };
}

async function setupWithDb() {
  const { app } = await makeApp({ seeded: true });
  return { app, db: app.db, alice: await login(app, ALICE), org: await login(app, ORGANISER) };
}

const req = (app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function createAs(app: FastifyInstance, cookie: string, body: unknown = { track: freeform(), note: "first" }) {
  const res = await req(app, "POST", "/api/tracks", cookie, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { track: { id: string; revision: number; status: string; author: { username: string } }; doc: RcTrack };
}

describe("permissions", () => {
  it("anonymous writes -> 401", async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ["POST", "/api/tracks"],
      ["PUT", `/api/tracks/${CLUB_A}`],
      ["POST", `/api/tracks/${CLUB_A}/submit`],
      ["POST", `/api/tracks/${CLUB_A}/approve`],
      ["POST", `/api/tracks/${CLUB_A}/archive`],
      ["POST", `/api/tracks/${CLUB_A}/adapt/venue-1`],
      ["POST", "/api/venues"],
      ["PUT", "/api/venues/venue-1"],
    ] as const) {
      const res = await req(app, method, url, undefined, {});
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: "unauthorized", message: "Log in first" });
    }
  });

  it("reads are public", async () => {
    const { app } = await setup();
    for (const url of ["/api/tracks", `/api/tracks/${CLUB_A}`, `/api/tracks/${CLUB_A}/revisions`, "/api/venues", "/api/venues/venue-2", `/api/tracks/${CLUB_A}/fit/venue-1`, `/t/${CLUB_A}`]) {
      expect((await req(app, "GET", url)).statusCode, url).toBe(200);
    }
  });

  it("non-author update -> 403; organiser may", async () => {
    const { app, alice, bob, org } = await setup();
    const { track } = await createAs(app, alice);
    const res = await req(app, "PUT", `/api/tracks/${track.id}`, bob, { track: freeform() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden");
    expect((await req(app, "PUT", `/api/tracks/${track.id}`, org, { track: freeform() })).statusCode).toBe(200);
  });

  it("non-organiser approve/archive -> 403, only the author submits", async () => {
    const { app, alice, bob, org } = await setup();
    const { track } = await createAs(app, alice);
    expect((await req(app, "POST", `/api/tracks/${track.id}/approve`, alice)).statusCode).toBe(403);
    expect((await req(app, "POST", `/api/tracks/${track.id}/archive`, alice)).statusCode).toBe(403);
    expect((await req(app, "POST", `/api/tracks/${track.id}/submit`, bob)).statusCode).toBe(403);
    expect((await req(app, "POST", `/api/tracks/${track.id}/submit`, org)).statusCode).toBe(403);
  });

  it("venues: organisers only", async () => {
    const { app, alice, org } = await setup();
    const venue = { ...referenceJson<RcVenue>("venues/club-hall.rcvenue.json"), id: "new-hall" };
    expect((await req(app, "POST", "/api/venues", alice, venue)).statusCode).toBe(403);
    expect((await req(app, "PUT", "/api/venues/venue-1", alice, venue)).statusCode).toBe(403);
    const created = await req(app, "POST", "/api/venues", org, venue);
    expect(created.statusCode).toBe(201);
    expect(created.json().venue).toMatchObject({ id: "new-hall", revision: 1, ownerId: ORGANISER.id });
    expect((await req(app, "POST", "/api/venues", org, venue)).statusCode).toBe(409);
    const updated = await req(app, "PUT", "/api/venues/new-hall", org, { venue: { ...venue, area: { length: 30, width: 15 } } });
    expect(updated.json().venue.revision).toBe(2);
    expect((await req(app, "GET", "/api/venues/new-hall")).json().doc.area).toEqual({ length: 30, width: 15 });
    expect((await req(app, "POST", "/api/venues", org, { ...venue, id: "../etc" })).statusCode).toBe(400);
  });
});

describe("saving tracks", () => {
  it("re-bakes on save: a tampered built is replaced", async () => {
    const { app, alice } = await setup();
    const doc = freeform();
    const tampered = { ...doc, built: { ...doc.built!, lapLength: 1, dividers: [], checks: [{ level: "info", code: "fake", message: "hi" }] } };
    const { track, doc: saved } = await createAs(app, alice, tampered);
    const expected = bakeBuilt(doc);
    expect(saved.built!.lapLength).toBe(93.534);
    expect(saved.built).toEqual(expected);
    // also on update, and the stored JSON is what's served
    const upd = await req(app, "PUT", `/api/tracks/${track.id}`, alice, { track: tampered });
    expect(upd.json().doc.built).toEqual(expected);
    const stored = JSON.parse(app.db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ? AND revision = 2").pluck().get(track.id) as string) as RcTrack;
    expect(stored.built).toEqual(expected);
  });

  it("server owns id, revision, author, status and dates", async () => {
    const { app, alice } = await setup();
    const doc = { ...freeform(), id: CLUB_A, revision: 42, info: { ...freeform().info, author: "mallory", status: "approved", derivedFrom: { id: "x", revision: 1, orientation: "x" } } };
    const { track, doc: saved } = await createAs(app, alice, doc);
    expect(track.id).not.toBe(CLUB_A);
    expect(saved.id).toBe(track.id);
    expect(saved.revision).toBe(1);
    expect(saved.info.author).toBe("alice");
    expect(saved.info.status).toBe("draft");
    expect(saved.info.derivedFrom).toBeUndefined();
    expect(track.status).toBe("draft");
  });

  it("revision numbering: every save adds one, old revisions stay", async () => {
    const { app, alice } = await setup();
    const { track } = await createAs(app, alice);
    for (const lane of [2.2, 1.8]) {
      const doc = freeform();
      doc.design.laneWidth = lane;
      doc.info.name = `Lane ${lane}`;
      const res = await req(app, "PUT", `/api/tracks/${track.id}`, alice, { track: doc, note: `lane ${lane}` });
      expect(res.statusCode).toBe(200);
    }
    const got = (await req(app, "GET", `/api/tracks/${track.id}`)).json();
    expect(got.track.revision).toBe(3);
    expect(got.track.name).toBe("Lane 1.8");
    expect(got.doc.revision).toBe(3);
    expect(got.doc.info.created).toBeDefined();
    const revs = (await req(app, "GET", `/api/tracks/${track.id}/revisions`)).json().revisions;
    expect(revs.map((r: { revision: number }) => r.revision)).toEqual([3, 2, 1]);
    expect(revs.map((r: { note: string }) => r.note)).toEqual(["lane 1.8", "lane 2.2", "first"]);
    const r1 = (await req(app, "GET", `/api/tracks/${track.id}/r/1.rctrack.json`)).json() as RcTrack;
    expect(r1.revision).toBe(1);
    expect(r1.info.name).toBe("Freeform example");
  });

  it("a revision whose author has no user row (seeded or imported) still lists, as an unknown author, and downloads (#30)", async () => {
    const { app, alice } = await setup();
    const { track } = await createAs(app, alice);
    for (const note of ["second", "third"]) await req(app, "PUT", `/api/tracks/${track.id}`, alice, { track: freeform(), note });
    app.db.pragma("foreign_keys = OFF");
    app.db.prepare("UPDATE track_revisions SET created_by = 999999 WHERE track_id = ? AND revision = 2").run(track.id);
    app.db.pragma("foreign_keys = ON");

    const revs = (await req(app, "GET", `/api/tracks/${track.id}/revisions`)).json().revisions;
    expect(revs.map((r: { revision: number }) => r.revision)).toEqual([3, 2, 1]);
    expect(revs.map((r: { createdBy: unknown }) => r.createdBy)).toEqual([
      { id: ALICE.id, username: "alice" },
      { id: 999999, username: null },
      { id: ALICE.id, username: "alice" },
    ]);
    const dl = await req(app, "GET", revs[1].downloadUrl);
    expect(dl.statusCode).toBe(200);
    expect((dl.json() as RcTrack).revision).toBe(2);
  });

  it("status workflow: draft and submitted save as before; approval locks", async () => {
    const { app, alice, org } = await setup();
    const { track } = await createAs(app, alice);
    expect((await req(app, "PUT", `/api/tracks/${track.id}`, alice, { track: freeform() })).json().track).toMatchObject({ status: "draft", revision: 2, locked: null });
    expect((await req(app, "POST", `/api/tracks/${track.id}/submit`, alice)).json().track.status).toBe("submitted");
    expect((await req(app, "POST", `/api/tracks/${track.id}/submit`, alice)).statusCode).toBe(409);
    // a submitted layout still saves; the save takes it back to draft
    expect((await req(app, "PUT", `/api/tracks/${track.id}`, alice, { track: freeform() })).json().track).toMatchObject({ status: "draft", revision: 3 });
    expect((await req(app, "POST", `/api/tracks/${track.id}/submit`, alice)).json().track.status).toBe("submitted");
    expect((await req(app, "POST", `/api/tracks/${track.id}/approve`, org)).json().track).toMatchObject({ status: "approved", revision: 3, approvedRevision: 3, locked: "library" });
    expect((await req(app, "GET", `/api/tracks/${track.id}/r/3.rctrack.json`)).json().info.status).toBe("approved");
    expect((await req(app, "POST", `/api/tracks/${track.id}/approve`, org)).statusCode).toBe(409);
    expect((await req(app, "POST", `/api/tracks/${track.id}/archive`, org)).json().track).toMatchObject({ status: "archived", locked: null });
    expect((await req(app, "PUT", `/api/tracks/${track.id}`, alice, { track: freeform() })).statusCode).toBe(409);
    // archived tracks drop out of the default list but still open
    const list = (await req(app, "GET", "/api/tracks")).json().tracks as { id: string }[];
    expect(list.some((t) => t.id === track.id)).toBe(false);
    expect((await req(app, "GET", `/api/tracks/${track.id}`)).statusCode).toBe(200);
  });

  it("saving an approved layout -> 409 layout-locked, no revision added (#64)", async () => {
    const { app, alice, org } = await setup();
    const { track } = await createAs(app, alice);
    expect((await req(app, "POST", `/api/tracks/${track.id}/approve`, org)).statusCode).toBe(200);
    const got = (await req(app, "GET", `/api/tracks/${track.id}`, alice)).json();
    expect(got.track.locked).toBe("library");
    expect(got.can).toMatchObject({ edit: false, copy: true, archive: false });
    expect((await req(app, "GET", `/api/tracks/${track.id}`, org)).json().can).toMatchObject({ edit: false, approve: false, archive: true });
    for (const cookie of [alice, org]) {
      const res = await req(app, "PUT", `/api/tracks/${track.id}`, cookie, { track: freeform(), baseRevision: 1 });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().error).toBe("layout-locked");
      expect(res.json().message).toMatch(/copy/i);
      expect(res.json().details).toEqual({ copy: `/api/tracks/${track.id}/copy` });
    }
    const revs = (await req(app, "GET", `/api/tracks/${track.id}/revisions`)).json().revisions as unknown[];
    expect(revs).toHaveLength(1);
    expect((await req(app, "GET", `/api/tracks/${track.id}`)).json().track).toMatchObject({ status: "approved", revision: 1, approvedRevision: 1 });
    // archiving is still allowed
    expect((await req(app, "POST", `/api/tracks/${track.id}/archive`, org)).json().track.status).toBe("archived");
  });

  it("copy of a locked layout: a draft for the caller with derivedFrom; the original is unchanged (#64)", async () => {
    const { app, alice, bob, org } = await setup();
    const { track } = await createAs(app, alice);
    await req(app, "POST", `/api/tracks/${track.id}/approve`, org);
    const before = (await req(app, "GET", `/api/tracks/${track.id}`)).json();
    for (const [cookie, who] of [[alice, "alice"], [bob, "bob"]] as const) {
      const res = await req(app, "POST", `/api/tracks/${track.id}/copy`, cookie);
      expect(res.statusCode, res.body).toBe(201);
      const copy = res.json();
      expect(copy.track).toMatchObject({ status: "draft", revision: 1, locked: null, author: { username: who }, derivedFrom: { id: track.id, author: "alice" } });
      expect(copy.track.id).not.toBe(track.id);
      expect(copy.doc.info).toMatchObject({ name: `${before.doc.info.name} (copy)`, author: who, status: "draft", derivedFrom: { id: track.id, revision: 1, author: "alice" } });
      expect(copy.can.edit).toBe(true);
      // the copy saves
      expect((await req(app, "PUT", `/api/tracks/${copy.track.id}`, cookie, { track: copy.doc })).json().track).toMatchObject({ revision: 2, derivedFrom: { id: track.id } });
    }
    const after = (await req(app, "GET", `/api/tracks/${track.id}`)).json();
    expect(after.track).toEqual(before.track);
    expect(after.doc).toEqual(before.doc);
  });

  it("an approval pinned before #64 with a newer draft keeps both revisions", async () => {
    const { app, alice, org, db } = await setupWithDb();
    const { track } = await createAs(app, alice);
    await req(app, "PUT", `/api/tracks/${track.id}`, alice, { track: freeform() });
    // the old flow: revision 1 approved, revision 2 a draft on top
    db.prepare("UPDATE tracks SET approved_revision = 1 WHERE id = ?").run(track.id);
    const got = (await req(app, "GET", `/api/tracks/${track.id}`, alice)).json();
    expect(got.track).toMatchObject({ status: "draft", revision: 2, approvedRevision: 1, publicRevision: 1, locked: null });
    expect(got.can.edit).toBe(true);
    expect((await req(app, "POST", `/api/tracks/${track.id}/approve`, org)).json().track).toMatchObject({ approvedRevision: 2, locked: "library" });
  });

  it("starting from a venue template copies area, obstacles, rostrum, basedOn", async () => {
    const { app, alice } = await setup();
    const doc = freeform();
    // move it so it fits Sports hall B's pillars (as the adapted example does)
    const adapted = referenceJson<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json");
    const { doc: saved } = await createAs(app, alice, { track: { info: { name: "From template" }, design: adapted.design }, fromVenue: "venue-2" });
    const venue = referenceJson<RcVenue>("venues/sports-hall-b.rcvenue.json");
    expect(saved.area).toEqual(venue.area);
    expect(saved.obstacles).toEqual(venue.obstacles);
    expect(saved.design.rostrum).toEqual(venue.rostrum);
    expect(saved.basedOn).toEqual({ venueTemplate: "venue-2", revision: 1 });
    expect(saved.info.venue).toEqual(venue.info.venue);
    expect(saved.built!.checks).toEqual([]);
    expect(doc.area).not.toEqual(venue.area);
    expect((await req(app, "POST", "/api/tracks", alice, { track: { design: adapted.design }, fromVenue: "nope" })).statusCode).toBe(404);
  });

  it("starting blank keeps the area sent, with basedOn null and no obstacles (#14)", async () => {
    const { app, alice } = await setup();
    const points = [[-10, -5], [10, -5], [10, 5], [-10, 5]].map(([x, z]) => ({ x, z, r: 1 }));
    const blank = { info: { name: "Blank" }, area: { length: 22, width: 12 }, obstacles: [], basedOn: null, design: { laneWidth: 2, points, features: [], start: { distance: 0 }, rostrum: { side: "south" } } };
    const { doc: saved } = await createAs(app, alice, { track: blank, note: "First version" });
    expect(saved.area).toEqual({ length: 22, width: 12 });
    expect(saved.basedOn).toBeNull();
    expect(saved.obstacles).toEqual([]);
    expect(saved.built!.checks.filter((c) => c.level === "error")).toEqual([]);
  });

  it("invalid tracks -> 400 with details", async () => {
    const { app, alice } = await setup();
    const doc = freeform();
    const cases: unknown[] = [
      [1, 2, 3],
      { track: { ...doc, design: { ...doc.design, points: doc.design.points.slice(0, 2) } } },
      { track: { ...doc, area: { length: -1, width: 3 } } },
      { track: { ...doc, design: { ...doc.design, points: [doc.design.points[0], doc.design.points[0], doc.design.points[1]] } } },
      { track: { ...doc, area: { length: 5000, width: 12 } } },
      { track: { ...doc, design: { ...doc.design, points: doc.design.points.map((p) => ({ ...p, x: p.x * 100 })) } } },
    ];
    for (const body of cases) {
      const res = await req(app, "POST", "/api/tracks", alice, body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.json().error).toMatch(/^(invalid-track|bad-request)$/);
      expect(typeof res.json().message).toBe("string");
    }
    const notJson = await app.inject({ method: "POST", url: "/api/tracks", headers: { cookie: alice, "content-type": "application/xml" }, payload: "<track/>" });
    expect(notJson.statusCode).toBe(415);
    expect(notJson.json().error).toBe("unsupported-media-type");
  });

  it("404s and errors are {error, message}", async () => {
    const { app, alice } = await setup();
    for (const url of ["/api/tracks/nope", "/api/tracks/nope/revisions", `/api/tracks/${CLUB_A}/r/9.rctrack.json`, `/api/tracks/${CLUB_A}/r/x.zip`, "/api/venues/nope", `/api/tracks/${CLUB_A}/fit/nope`, "/nothing/here", `/p/${CLUB_A}/7.png`]) {
      const res = await req(app, "GET", url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual({ error: "not-found", message: expect.any(String) });
    }
    expect((await req(app, "PUT", "/api/tracks/nope", alice, { track: freeform() })).statusCode).toBe(404);
    const bad = await app.inject({ method: "POST", url: "/api/tracks", headers: { cookie: alice, "content-type": "application/json" }, payload: "{nope" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("bad-request");
  });

  it("download has a sensible filename", async () => {
    const { app } = await setup();
    const res = await req(app, "GET", `/api/tracks/${FREEFORM}/r/1.rctrack.json`);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="freeform-example-r1.rctrack.json"');
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.json().id).toBe(FREEFORM);
  });

  it("list filters", async () => {
    const { app } = await setup();
    const names = async (qs: string) => ((await req(app, "GET", `/api/tracks${qs}`)).json().tracks as { name: string }[]).map((t) => t.name).sort();
    expect(await names("")).toEqual(["Club A", "Freeform example", "Freeform example @ Sports hall B"]);
    expect(await names("?q=freeform")).toEqual(["Freeform example", "Freeform example @ Sports hall B"]);
    expect(await names("?minLap=100")).toEqual(["Club A"]);
    expect(await names("?maxLap=100")).toEqual(["Freeform example", "Freeform example @ Sports hall B"]);
    expect(await names("?venue=venue-2")).toEqual(["Freeform example @ Sports hall B"]);
    expect(await names("?status=draft")).toEqual([]);
    expect(await names("?q=%25")).toEqual([]);
    expect((await req(app, "GET", "/api/tracks?status=bogus")).statusCode).toBe(400);
  });

  it("author=me lists only the signed-in user's tracks", async () => {
    const { app, alice, bob } = await setup();
    const a = await createAs(app, alice);
    await createAs(app, bob);
    const ids = async (qs: string, cookie?: string) => {
      const res = await req(app, "GET", `/api/tracks${qs}`, cookie);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json().tracks as { id: string; author: { username: string } }[]).map((t) => ({ id: t.id, author: t.author.username }));
    };
    expect(await ids("?author=me", alice)).toEqual([{ id: a.track.id, author: "alice" }]);
    expect((await ids("?author=me", bob)).map((t) => t.author)).toEqual(["bob"]);
    expect((await ids("", alice)).length).toBe(5);
  });

  it("author=me combines with the other filters", async () => {
    const { app, alice } = await setup();
    const a = await createAs(app, alice);
    const ids = async (qs: string) => ((await req(app, "GET", `/api/tracks${qs}`, alice)).json().tracks as { id: string }[]).map((t) => t.id);
    expect(await ids("?author=me&status=draft")).toEqual([a.track.id]);
    expect(await ids("?author=me&status=approved")).toEqual([]);
    expect(await ids("?author=me&q=freeform")).toEqual([a.track.id]);
    expect(await ids("?author=me&q=club")).toEqual([]);
    expect(await ids("?author=me&minLap=100")).toEqual([]);
    expect(await ids("?author=me&maxLap=100")).toEqual([a.track.id]);
    expect(await ids("?author=me&venue=venue-2")).toEqual([]);
    // fits= lists approved tracks only; none of alice's are approved yet
    expect(await ids("?author=me&fits=venue-2")).toEqual([]);
  });

  it("author=me with fits lists only the user's approved tracks that fit", async () => {
    const { app, alice, org } = await setup();
    const a = await createAs(app, alice);
    expect((await req(app, "POST", `/api/tracks/${a.track.id}/approve`, org)).statusCode).toBe(200);
    const ids = async (qs: string) => ((await req(app, "GET", `/api/tracks${qs}`, alice)).json().tracks as { id: string }[]).map((t) => t.id);
    expect(await ids("?fits=venue-2")).toHaveLength(3);
    expect(await ids("?author=me&fits=venue-2")).toEqual([a.track.id]);
    expect(await ids("?author=me&fits=venue-3")).toEqual([]);
  });

  it("a track whose author has no user row still lists, fits and opens, as an unknown author (#46)", async () => {
    const { app, alice, org } = await setup();
    const a = await createAs(app, alice);
    expect((await req(app, "POST", `/api/tracks/${a.track.id}/approve`, org)).statusCode).toBe(200);
    app.db.pragma("foreign_keys = OFF");
    app.db.prepare("UPDATE tracks SET author_forum_id = 999999 WHERE id = ?").run(a.track.id);
    app.db.pragma("foreign_keys = ON");
    const orphan = { id: 999999, username: null };
    const find = async (qs: string, cookie?: string) => {
      const res = await req(app, "GET", `/api/tracks${qs}`, cookie);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json().tracks as { id: string; author: unknown; fit?: { results: unknown[] } }[]).find((t) => t.id === a.track.id);
    };

    expect((await find(""))?.author).toEqual(orphan);
    const fitted = await find("?fits=venue-2");
    expect(fitted?.author).toEqual(orphan);
    expect(fitted?.fit?.results.length).toBeGreaterThan(0);
    const fit = await req(app, "GET", `/api/tracks/${a.track.id}/fit/venue-2`);
    expect(fit.statusCode, fit.body).toBe(200);
    const got = await req(app, "GET", `/api/tracks/${a.track.id}`);
    expect(got.statusCode, got.body).toBe(200);
    expect(got.json().track.author).toEqual(orphan);
    const page = await req(app, "GET", `/t/${a.track.id}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("by Unknown");

    // author=me: it's nobody's now, and alice's other tracks still list for her
    expect(await find("?author=me", alice)).toBeUndefined();
    const b = await createAs(app, alice);
    const mine = (await req(app, "GET", "/api/tracks?author=me", alice)).json().tracks as { id: string }[];
    expect(mine.map((t) => t.id)).toEqual([b.track.id]);

    // a copy credits the original without an author
    const copy = await req(app, "POST", `/api/tracks/${a.track.id}/copy`, alice);
    expect(copy.statusCode, copy.body).toBe(201);
    expect(copy.json().doc.info.derivedFrom).toEqual({ id: a.track.id, revision: 1 });
  });

  it("author=me signed out -> 401", async () => {
    const { app } = await setup();
    const res = await req(app, "GET", "/api/tracks?author=me");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized", message: "Log in first" });
    expect((await req(app, "GET", "/api/tracks?author=me&fits=venue-2")).statusCode).toBe(401);
  });

  it("author accepts only me -> other values 400", async () => {
    const { app, alice } = await setup();
    for (const v of ["101", "alice", "ME", "me,101"]) {
      const res = await req(app, "GET", `/api/tracks?author=${encodeURIComponent(v)}`, alice);
      expect(res.statusCode, `author=${v}`).toBe(400);
      expect(res.json().error).toBe("bad-request");
    }
    expect((await req(app, "GET", "/api/tracks?author=me&author=me", alice)).statusCode).toBe(400);
    // the check comes first, signed out too
    expect((await req(app, "GET", "/api/tracks?author=101")).statusCode).toBe(400);
    // empty means no filter, like the other parameters
    expect((await req(app, "GET", "/api/tracks?author=")).json().tracks.length).toBe(3);
  });
});

describe("fit + adapt", () => {
  it("fit endpoint matches the engine", async () => {
    const { app } = await setup();
    // the engine's fit fixture (which the engine's own tests reproduce), so the slow fit search runs once per pair, not twice
    const venueFiles: Record<string, string> = { "venue-1": "club-hall", "venue-2": "sports-hall-b", "venue-3": "small-hall" };
    const trackFiles: Record<string, string> = { [CLUB_A]: "club-a", [FREEFORM]: "freeform-example" };
    for (const venueId of ["venue-1", "venue-2", "venue-3"]) {
      for (const id of [CLUB_A, FREEFORM]) {
        const res = (await req(app, "GET", `/api/tracks/${id}/fit/${venueId}`)).json();
        const want = fitExpected[`${trackFiles[id]}.rctrack.json | ${venueFiles[venueId]}.rcvenue.json`];
        expect(want).toBeDefined();
        expect({ ...res, results: res.results.map(({ thumbUrl: _t, ...r }: { thumbUrl: string }) => r) }).toEqual({ track: { id, revision: 1 }, venue: { id: venueId, revision: 1 }, results: want });
      }
    }
    // cached per track revision + venue revision
    expect(app.db.prepare("SELECT COUNT(*) FROM fit_cache").pluck().get()).toBe(6);
  });

  it("fits= lists approved tracks that fit, with their results", async () => {
    const { app, alice } = await setup();
    await createAs(app, alice); // a draft that would fit: not listed
    const res = (await req(app, "GET", "/api/tracks?fits=venue-2")).json().tracks as { id: string; fit: { results: { orientation: string }[] } }[];
    expect(res.map((t) => t.id).sort()).toEqual(["3b542396-6bd2-55e8-8665-852e74dc54a9", "46897d82-0114-460f-9a75-984ee97bca0e"]);
    expect(res.find((t) => t.id === FREEFORM)!.fit.results.map((r) => r.orientation)).toEqual(["rotated 180"]);
    expect((await req(app, "GET", "/api/tracks?fits=venue-3")).json().tracks).toEqual([]);
    expect((await req(app, "GET", "/api/tracks?fits=nope")).statusCode).toBe(404);
  });

  it("a new venue revision invalidates the cached fit", async () => {
    const { app, org } = await setup();
    await req(app, "GET", `/api/tracks/${CLUB_A}/fit/venue-3`);
    const v = (await req(app, "GET", "/api/venues/venue-3")).json().doc as RcVenue;
    await req(app, "PUT", "/api/venues/venue-3", org, { ...v, area: { length: 23, width: 13 } });
    const res = (await req(app, "GET", `/api/tracks/${CLUB_A}/fit/venue-3`)).json();
    expect(res.venue.revision).toBe(2);
    expect(res.results.length).toBeGreaterThan(0);
  });

  it("adapt creates a new draft for the user", async () => {
    const { app, alice } = await setup();
    const res = await req(app, "POST", `/api/tracks/${FREEFORM}/adapt/venue-2`, alice);
    expect(res.statusCode).toBe(201);
    const { track, doc, fit } = res.json();
    expect(fit.orientation).toBe("rotated 180");
    expect(track).toMatchObject({ status: "draft", revision: 1, venueTemplateId: "venue-2", derivedFromId: FREEFORM, author: { username: "alice" } });
    expect(doc.info).toMatchObject({ name: "Freeform example @ Sports hall B", derivedFrom: { id: FREEFORM, revision: 1, orientation: "rotated 180" } });
    // same design as the reference's adapted example
    expect(doc.design).toEqual(referenceJson<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json").design);
    expect((await req(app, "POST", `/api/tracks/${CLUB_A}/adapt/venue-3`, alice)).statusCode).toBe(422);
    const bad = await req(app, "POST", `/api/tracks/${CLUB_A}/adapt/venue-1`, alice, { orientation: "rotated 90" });
    expect(bad.statusCode).toBe(400);
    const chosen = await req(app, "POST", `/api/tracks/${CLUB_A}/adapt/venue-1`, alice, { orientation: "mirrored" });
    expect(chosen.json().fit.orientation).toBe("mirrored");
  });
});
