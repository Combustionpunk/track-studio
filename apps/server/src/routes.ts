// JSON API. Reads are public; writes need a session (see auth.ts guards).
import type { FastifyInstance } from "fastify";
import type { DB } from "./db.js";
import { requireOrganiser, requireUser } from "./auth.js";
import { badRequest, notFound } from "./errors.js";
import {
  adaptTrack,
  changeStatus,
  copyTrack,
  createTrack,
  createVenue,
  fitTrack,
  getTrackDoc,
  getTrackRow,
  getVenueDoc,
  getVenueRow,
  listRevisions,
  listTracks,
  listVenues,
  permissions,
  publicRevision,
  tracksFitting,
  trackSummary,
  updateTrack,
  updateVenue,
  venueSummary,
  type ListQuery,
  type StatusAction,
} from "./store.js";

const STATUSES = ["draft", "submitted", "approved", "archived"];

function num(v: unknown, name: string): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest("bad-request", `${name} must be a number`);
  return n;
}

function revisionParam(v: string): number {
  if (!/^\d{1,9}$/.test(v)) throw notFound("Track revision");
  return Number(v);
}

const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").toLowerCase().slice(0, 60) || "track";

export function registerRoutes(app: FastifyInstance, db: DB): void {
  // ---------------------------------------------------------------- tracks
  app.get("/api/tracks", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    if (q.status && !STATUSES.includes(q.status)) throw badRequest("bad-request", `status must be one of ${STATUSES.join(", ")}`);
    const filter: ListQuery = {
      status: q.status,
      venue: q.venue || undefined,
      minLap: num(q.minLap, "minLap"),
      maxLap: num(q.maxLap, "maxLap"),
      minCorners: num(q.minCorners, "minCorners"),
      maxCorners: num(q.maxCorners, "maxCorners"),
      q: q.q || undefined,
    };
    if (q.fits) {
      const { status: _ignored, ...rest } = filter;
      return { tracks: tracksFitting(db, q.fits, rest) };
    }
    return { tracks: listTracks(db, filter).map(trackSummary) };
  });

  app.post("/api/tracks", async (req, reply) => {
    const user = requireUser(req);
    return reply.code(201).send(createTrack(db, user, req.body));
  });

  // the public revision (approved ?? latest); editors load the latest with /r/:revision
  app.get("/api/tracks/:id", async (req) => {
    const row = getTrackRow(db, (req.params as { id: string }).id);
    return { track: trackSummary(row), doc: getTrackDoc(db, row, publicRevision(row)), can: permissions(req.user, row) };
  });

  app.put("/api/tracks/:id", async (req) => updateTrack(db, requireUser(req), (req.params as { id: string }).id, req.body));

  app.get("/api/tracks/:id/revisions", async (req) => {
    const row = getTrackRow(db, (req.params as { id: string }).id);
    return { revisions: listRevisions(db, row) };
  });

  // download: /api/tracks/:id/r/3.rctrack.json (or /r/3 for plain JSON)
  app.get("/api/tracks/:id/r/:file", async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const m = /^(\d+)(\.rctrack\.json)?$/.exec(file);
    if (!m) throw notFound("Track revision");
    const row = getTrackRow(db, id);
    const doc = getTrackDoc(db, row, revisionParam(m[1]));
    if (m[2]) {
      reply.header("content-disposition", `attachment; filename="${slug(doc.info.name)}-r${doc.revision}.rctrack.json"`);
      reply.header("cache-control", "public, max-age=300");
    }
    return reply.type("application/json; charset=utf-8").send(JSON.stringify(doc, null, 1));
  });

  for (const action of ["submit", "approve", "archive"] as StatusAction[]) {
    app.post(`/api/tracks/:id/${action}`, async (req) => ({ track: changeStatus(db, requireUser(req), (req.params as { id: string }).id, action) }));
  }

  // ?r=<revision>, default the public one
  app.get("/api/tracks/:id/fit/:venueId", async (req) => {
    const { id, venueId } = req.params as { id: string; venueId: string };
    const { r } = req.query as { r?: string };
    return fitTrack(db, getTrackRow(db, id), venueId, r ? revisionParam(r) : undefined);
  });

  app.post("/api/tracks/:id/adapt/:venueId", async (req, reply) => {
    const user = requireUser(req);
    const { id, venueId } = req.params as { id: string; venueId: string };
    const body = (req.body ?? {}) as { orientation?: unknown; revision?: unknown };
    const orientation = typeof body.orientation === "string" ? body.orientation : undefined;
    const revision = typeof body.revision === "number" ? body.revision : undefined;
    return reply.code(201).send(adaptTrack(db, user, id, venueId, orientation, revision));
  });

  // "Make my own copy" — body {revision?}, default the public revision
  app.post("/api/tracks/:id/copy", async (req, reply) => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as { revision?: unknown };
    return reply.code(201).send(copyTrack(db, user, (req.params as { id: string }).id, typeof body.revision === "number" ? body.revision : undefined));
  });

  // ---------------------------------------------------------------- venues
  app.get("/api/venues", async () => ({ venues: listVenues(db) }));

  app.get("/api/venues/:id", async (req) => {
    const { id } = req.params as { id: string };
    return { venue: venueSummary(getVenueRow(db, id)), doc: getVenueDoc(db, id) };
  });

  app.post("/api/venues", async (req, reply) => reply.code(201).send(createVenue(db, requireOrganiser(req), req.body)));

  app.put("/api/venues/:id", async (req) => updateVenue(db, requireOrganiser(req), (req.params as { id: string }).id, req.body));
}
