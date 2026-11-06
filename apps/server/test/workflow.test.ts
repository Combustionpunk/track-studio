// Designer-era rules: approved tracks are locked and their approved revision stays public, errors block submitting, copies, stale saves.
import type { RcTrack } from "@track-studio/engine";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { backfillRevisions } from "../src/store.js";
import { ALICE, BOB, login, makeApp, ORGANISER, referenceJson } from "./helpers.js";

const CLUB_A = "7c002509-b640-5e9d-8e79-0ae336a2ae04";
const freeform = () => referenceJson<RcTrack>("examples/freeform-example.rctrack.json");
const send = (app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function setup() {
  const { app } = await makeApp({ seeded: true });
  return { app, alice: await login(app, ALICE), bob: await login(app, BOB), org: await login(app, ORGANISER) };
}

describe("approved tracks are protected", () => {
  it("an approved track is locked; changes go on a copy (#64)", async () => {
    const { app, alice, org } = await setup();
    const { track } = (await send(app, "POST", "/api/tracks", alice, { track: freeform() })).json();
    await send(app, "POST", `/api/tracks/${track.id}/submit`, alice);
    await send(app, "POST", `/api/tracks/${track.id}/approve`, org);
    const res = await send(app, "PUT", `/api/tracks/${track.id}`, alice, { track: freeform(), baseRevision: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "layout-locked", message: expect.stringContaining("Copy it") });
  });

  it("a track approved before #64 with a newer draft: the approved revision stays public", async () => {
    const { app, alice, org } = await setup();
    const { track } = (await send(app, "POST", "/api/tracks", alice, { track: freeform() })).json();
    await send(app, "POST", `/api/tracks/${track.id}/submit`, alice);
    await send(app, "POST", `/api/tracks/${track.id}/approve`, org);
    // what an edit of an approved track used to do: back to draft, approved revision pinned
    app.db.prepare("UPDATE tracks SET status = 'draft' WHERE id = ?").run(track.id);
    const v2 = freeform();
    v2.info.name = "Freeform, longer straight";
    v2.design.points[3].radius = 2.5; // still inside the area (no errors)
    const upd = (await send(app, "PUT", `/api/tracks/${track.id}`, alice, { track: v2, note: "longer", baseRevision: 1 })).json();
    expect(upd.track).toMatchObject({ revision: 2, approvedRevision: 1, publicRevision: 1, status: "draft", name: "Freeform example", newerRevision: { revision: 2, status: "draft" } });
    expect(upd.doc.revision).toBe(2); // the save returns what was saved

    // public views: the approved revision
    const pub = (await send(app, "GET", `/api/tracks/${track.id}`)).json();
    expect(pub.doc.revision).toBe(1);
    expect(pub.doc.info.status).toBe("approved");
    expect(pub.track.previewUrl).toMatch(new RegExp(`^/p/${track.id}/1\\.png\\?v=`));
    const approved = (await send(app, "GET", "/api/tracks?status=approved")).json().tracks.find((t: { id: string }) => t.id === track.id);
    expect(approved).toMatchObject({ name: "Freeform example", publicRevision: 1 });
    expect((await send(app, "GET", "/api/tracks?q=longer")).json().tracks).toEqual([]); // search sees the public name
    const fitting = (await send(app, "GET", "/api/tracks?fits=venue-1")).json().tracks.find((t: { id: string }) => t.id === track.id);
    expect(fitting.fit.revision).toBe(1);
    const page = (await app.inject({ method: "GET", url: `/t/${track.id}`, headers: { accept: "text/html" } })).body;
    expect(page).toContain('<meta property="og:title" content="Freeform example">');
    expect(page).toContain("approved");
    // the newer draft is still there to view / edit
    expect((await send(app, "GET", `/api/tracks/${track.id}/r/2`)).json().info.name).toBe("Freeform, longer straight");

    // approving the draft makes it public
    await send(app, "POST", `/api/tracks/${track.id}/submit`, alice);
    expect((await send(app, "POST", `/api/tracks/${track.id}/approve`, org)).json().track).toMatchObject({ approvedRevision: 2, publicRevision: 2, name: "Freeform, longer straight", newerRevision: null });
  });

  it("a stale save is refused", async () => {
    const { app, alice, org } = await setup();
    const { track } = (await send(app, "POST", "/api/tracks", alice, { track: freeform() })).json();
    expect((await send(app, "PUT", `/api/tracks/${track.id}`, org, { track: freeform(), baseRevision: 1 })).statusCode).toBe(200);
    const stale = await send(app, "PUT", `/api/tracks/${track.id}`, alice, { track: freeform(), baseRevision: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("stale");
  });

  it("a track drawn for a venue never saves the venue's obstacles or a rostrum, even if a client sends them (1.7)", async () => {
    const { app, alice } = await setup();
    const adapted = referenceJson<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json");
    const { track, doc } = (await send(app, "POST", "/api/tracks", alice, { track: { info: { name: "T" }, design: adapted.design }, fromVenue: "venue-2" })).json();
    const sneaky = { ...doc, info: { name: "T" }, area: { length: 40, width: 30 }, obstacles: [{ type: "circle", x: 0, z: 0, radius: 1 }], basedOn: { venueTemplate: "venue-1", revision: 1 }, design: { ...doc.design, rostrum: { side: "north" } } };
    const saved = (await send(app, "PUT", `/api/tracks/${track.id}`, alice, { track: sneaky })).json().doc;
    expect(saved.area).toEqual({ length: 40, width: 30 }); // only the drawing area: the designer's to change
    expect(saved).not.toHaveProperty("obstacles");
    expect(saved).not.toHaveProperty("basedOn");
    expect(saved.design).not.toHaveProperty("rostrum");
    expect(saved.info.drawnFor).toEqual({ venueTemplate: "venue-2", name: "Sports hall B" }); // kept from the first revision
  });
});

describe("rctrack 1.7 on the server (#63)", () => {
  it("drawnFor naming a template that doesn't exist is kept as a label but counts towards no venue", async () => {
    const { app, alice } = await setup();
    const doc = freeform();
    const { track, doc: saved } = (await send(app, "POST", "/api/tracks", alice, { track: { ...doc, info: { name: "Mine", drawnFor: { venueTemplate: "nope", name: "Somewhere" } } } })).json();
    expect(saved.info.drawnFor).toEqual({ venueTemplate: "nope", name: "Somewhere" });
    expect(track.venueTemplateId).toBeNull();
    // a real one is named after the template
    const real = (await send(app, "POST", "/api/tracks", alice, { track: { ...doc, info: { name: "Mine", drawnFor: { venueTemplate: "venue-2", name: "whatever" } } } })).json();
    expect(real.doc.info.drawnFor).toEqual({ venueTemplate: "venue-2", name: "Sports hall B" });
    expect(real.track.venueTemplateId).toBe("venue-2");
  });

  it("a 1.6 revision whose only errors were venue checks can be submitted before the rebake", async () => {
    const { app, alice } = await setup();
    const { track, doc } = (await send(app, "POST", "/api/tracks", alice, { track: freeform() })).json();
    // as rctrack 1.6 stored it: an obstacle error in built.checks, counted in the error column
    const old = { ...doc, obstacles: [{ type: "circle", x: 0, z: 0, radius: 1 }], built: { ...doc.built, checks: [{ level: "error", code: "obstacle", message: "Track overlaps a fixed obstacle" }] } };
    app.db.prepare("UPDATE track_revisions SET rctrack_json = ?, errors = 1 WHERE track_id = ?").run(JSON.stringify(old), track.id);
    app.db.prepare("UPDATE tracks SET status = 'draft' WHERE id = ?").run(track.id);
    expect((await send(app, "POST", `/api/tracks/${track.id}/submit`, alice)).statusCode).toBe(200);
  });
});

describe("errors block submitting", () => {
  it("on the server, for submit and approve; warnings are fine", async () => {
    const { app, alice, org } = await setup();
    // a figure of eight with no bridge: an error of the track itself (1.7: leaving an area is a venue check, not an error here)
    const broken = { ...freeform(), design: referenceJson<RcTrack>("../packages/engine/test/fixtures/extra/unbridged-figure8.rctrack.json").design };
    const { track } = (await send(app, "POST", "/api/tracks", alice, { track: broken })).json();
    expect(track.errors).toBe(1);
    const sub = await send(app, "POST", `/api/tracks/${track.id}/submit`, alice);
    expect(sub.statusCode).toBe(409);
    expect(sub.json()).toMatchObject({ error: "has-errors", message: expect.stringContaining("with no bridge") });
    expect((await send(app, "POST", `/api/tracks/${track.id}/approve`, org)).json().error).toBe("has-errors");
    // fixed: submit works
    const fixed = (await send(app, "PUT", `/api/tracks/${track.id}`, alice, { track: freeform() })).json();
    expect(fixed.track.errors).toBe(0);
    expect((await send(app, "POST", `/api/tracks/${track.id}/submit`, alice)).statusCode).toBe(200);
    // warnings only (a tight corner) don't block
    const tight = freeform();
    tight.design.points[0].radius = 0.4;
    const t2 = (await send(app, "POST", "/api/tracks", alice, { track: tight })).json();
    expect(t2.doc.built.checks.map((c: { code: string }) => c.code)).toContain("tight-corner");
    expect((await send(app, "POST", `/api/tracks/${t2.track.id}/submit`, alice)).statusCode).toBe(200);
  });
});

describe("make my own copy", () => {
  it("copies the public revision for the user, credited to the original", async () => {
    const { app, bob } = await setup();
    expect((await send(app, "POST", `/api/tracks/${CLUB_A}/copy`)).statusCode).toBe(401);
    const res = await send(app, "POST", `/api/tracks/${CLUB_A}/copy`, bob);
    expect(res.statusCode).toBe(201);
    const { track, doc, can } = res.json();
    expect(track).toMatchObject({ name: "Club A (copy)", status: "draft", author: { username: "bob" }, derivedFromId: CLUB_A, derivedFrom: { id: CLUB_A, name: "Club A", author: "system" } });
    expect(doc.info.derivedFrom).toEqual({ id: CLUB_A, revision: 1, author: "system" });
    expect(doc.design).toEqual((await send(app, "GET", `/api/tracks/${CLUB_A}`)).json().doc.design);
    expect(can.edit).toBe(true);
    expect((await send(app, "GET", `/api/tracks/${track.id}/revisions`)).json().revisions[0].note).toBe("Copy of Club A r1 by system");
    // the original is untouched
    expect((await send(app, "GET", `/api/tracks/${CLUB_A}`)).json().track.revision).toBe(1);
  });

  it("permissions tell the UI what to show", async () => {
    const { app, bob, org } = await setup();
    expect((await send(app, "GET", `/api/tracks/${CLUB_A}`, bob)).json().can).toEqual({ edit: false, submit: false, approve: false, archive: false, adapt: true, copy: true });
    // approved (in the library), so locked even for organisers
    expect((await send(app, "GET", `/api/tracks/${CLUB_A}`, org)).json().can).toMatchObject({ edit: false, approve: false, archive: true, copy: true });
    expect((await send(app, "GET", `/api/tracks/${CLUB_A}`)).json().can).toMatchObject({ edit: false, copy: false });
  });
});

describe("backfill", () => {
  it("fills in revision summaries saved before migration 003", async () => {
    const { app } = await makeApp({ seeded: true });
    app.db.prepare("UPDATE track_revisions SET name = NULL, lap_length = NULL, corners = NULL, preview_hash = NULL").run();
    expect(backfillRevisions(app.db)).toBe(3);
    expect(backfillRevisions(app.db)).toBe(0);
    expect((await send(app, "GET", `/api/tracks/${CLUB_A}`)).json().track).toMatchObject({ name: "Club A", corners: 12, lapLength: 123.972 });
  });
});
