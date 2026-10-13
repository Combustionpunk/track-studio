// Designer-era rules: approved revisions stay public, errors block submitting, copies, stale saves.
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
  it("editing an approved track adds a newer draft; the approved revision stays public", async () => {
    const { app, alice, org } = await setup();
    const { track } = (await send(app, "POST", "/api/tracks", alice, { track: freeform() })).json();
    await send(app, "POST", `/api/tracks/${track.id}/submit`, alice);
    await send(app, "POST", `/api/tracks/${track.id}/approve`, org);
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

  it("a track from a venue template keeps the template's area, obstacles and rostrum", async () => {
    const { app, alice } = await setup();
    const adapted = referenceJson<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json");
    const { track, doc } = (await send(app, "POST", "/api/tracks", alice, { track: { info: { name: "T" }, design: adapted.design }, fromVenue: "venue-2" })).json();
    const sneaky = { ...doc, area: { length: 40, width: 30 }, obstacles: [], design: { ...doc.design, rostrum: { side: "north" } } };
    const saved = (await send(app, "PUT", `/api/tracks/${track.id}`, alice, { track: sneaky })).json().doc;
    expect(saved.area).toEqual({ length: 25, width: 14 });
    expect(saved.obstacles).toHaveLength(3);
    expect(saved.design.rostrum).toEqual({ side: "south", offset: 3 });
  });
});

describe("errors block submitting", () => {
  it("on the server, for submit and approve; warnings are fine", async () => {
    const { app, alice, org } = await setup();
    const broken = freeform();
    broken.area = { length: 18, width: 12 }; // the track runs outside the area: an error
    const { track } = (await send(app, "POST", "/api/tracks", alice, { track: broken })).json();
    expect(track.errors).toBe(1);
    const sub = await send(app, "POST", `/api/tracks/${track.id}/submit`, alice);
    expect(sub.statusCode).toBe(409);
    expect(sub.json()).toMatchObject({ error: "has-errors", message: expect.stringContaining("outside the venue's track area") });
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
    expect((await send(app, "GET", `/api/tracks/${CLUB_A}`, org)).json().can).toMatchObject({ edit: true, approve: false, archive: true });
    expect((await send(app, "GET", `/api/tracks/${CLUB_A}`)).json().can).toMatchObject({ edit: false, copy: false });
  });
});

describe("backfill", () => {
  it("fills in revision summaries saved before migration 003", async () => {
    const { app } = await makeApp({ seeded: true });
    app.db.prepare("UPDATE track_revisions SET name = NULL, lap_length = NULL, corners = NULL, preview_hash = NULL").run();
    expect(backfillRevisions(app.db)).toBe(3);
    expect(backfillRevisions(app.db)).toBe(0);
    expect((await send(app, "GET", `/api/tracks/${CLUB_A}`)).json().track).toMatchObject({ name: "Club A", corners: 12, lapLength: 124.036 });
  });
});
