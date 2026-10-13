// Tracks, venues and their revisions. Every save validates, re-bakes with the engine and adds a revision row.
import { randomUUID } from "node:crypto";
import {
  adapt,
  bake,
  fits,
  validateTrack,
  validateVenue,
  type FitResult,
  type RcTrack,
  type RcVenue,
  type TrackStatus,
} from "@track-studio/engine";
import type { User } from "./auth.js";
import type { DB } from "./db.js";
import { badRequest, conflict, forbidden, HttpError, notFound } from "./errors.js";

// ------------------------------------------------------------------ input limits
// The engine's work grows with lap length and area; keep requests from logged-in users within sane bounds.
export const LIMITS = { coord: 100, area: 100, points: 300, lap: 1500, features: 100, width: 10, radius: 50, obstacles: 100 };

function checkLimits(doc: RcTrack | RcVenue): void {
  const problems: string[] = [];
  const { area } = doc;
  if (area.length > LIMITS.area || area.width > LIMITS.area) problems.push(`area is limited to ${LIMITS.area} x ${LIMITS.area} m`);
  if ((doc.obstacles?.length ?? 0) > LIMITS.obstacles) problems.push(`at most ${LIMITS.obstacles} obstacles`);
  for (const o of doc.obstacles ?? []) {
    if (Math.abs(o.x) > LIMITS.coord || Math.abs(o.z) > LIMITS.coord) problems.push(`obstacle coordinates are limited to ±${LIMITS.coord} m`);
    if (o.type === "circle" && !(o.radius > 0)) problems.push("circle obstacles need a radius > 0");
    if (o.type === "rect" && !(o.length > 0 && o.width > 0)) problems.push("rect obstacles need length and width > 0");
  }
  if (doc.format === "rctrack") {
    const { points, features = [] } = doc.design;
    if (points.length > LIMITS.points) problems.push(`at most ${LIMITS.points} points`);
    if (features.length > LIMITS.features) problems.push(`at most ${LIMITS.features} features`);
    let lap = 0;
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      lap += d;
      if (d < 0.01) problems.push(`points ${i} and ${(i + 1) % points.length} are in the same place`);
      if (Math.abs(p.x) > LIMITS.coord || Math.abs(p.z) > LIMITS.coord) problems.push(`point ${i} is more than ${LIMITS.coord} m from the centre`);
      if ((p.width ?? 0) > LIMITS.width) problems.push(`point ${i}: lane width is limited to ${LIMITS.width} m`);
      if ((p.radius ?? 0) > LIMITS.radius) problems.push(`point ${i}: radius is limited to ${LIMITS.radius} m`);
    });
    const lw = doc.design.laneWidth;
    if (lw !== undefined && !(lw >= 0.5 && lw <= LIMITS.width)) problems.push(`laneWidth must be between 0.5 and ${LIMITS.width} m`);
    if (lap > LIMITS.lap) problems.push(`lap is limited to ${LIMITS.lap} m`);
  }
  if (problems.length) throw badRequest(doc.format === "rctrack" ? "invalid-track" : "invalid-venue", problems[0], [...new Set(problems)]);
}

function assertValidTrack(doc: unknown): asserts doc is RcTrack {
  const r = validateTrack(doc);
  if (!r.valid) throw badRequest("invalid-track", `Track file is not valid: ${r.errors[0].path || "/"} ${r.errors[0].message}`, r.errors);
  checkLimits(doc as RcTrack);
}

function assertValidVenue(doc: unknown): asserts doc is RcVenue {
  const r = validateVenue(doc);
  if (!r.valid) throw badRequest("invalid-venue", `Venue file is not valid: ${r.errors[0].path || "/"} ${r.errors[0].message}`, r.errors);
  checkLimits(doc as RcVenue);
}

const now = () => new Date().toISOString();
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ------------------------------------------------------------------ venues
interface VenueRow {
  id: string;
  forum_venue_id: number | null;
  name: string;
  owner_forum_id: number;
  current_revision: number;
  created_at: string;
  updated_at: string;
}

export function venueSummary(r: VenueRow) {
  return { id: r.id, name: r.name, forumVenueId: r.forum_venue_id, ownerId: r.owner_forum_id, revision: r.current_revision, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function getVenueRow(db: DB, id: string): VenueRow {
  const r = db.prepare("SELECT * FROM venues WHERE id = ?").get(id) as VenueRow | undefined;
  if (!r) throw notFound("Venue");
  return r;
}

export function getVenueDoc(db: DB, id: string, revision?: number): RcVenue {
  const row = getVenueRow(db, id);
  const json = db
    .prepare("SELECT rcvenue_json FROM venue_revisions WHERE venue_id = ? AND revision = ?")
    .pluck()
    .get(id, revision ?? row.current_revision) as string | undefined;
  if (!json) throw notFound("Venue revision");
  return JSON.parse(json) as RcVenue;
}

export function listVenues(db: DB) {
  return (db.prepare("SELECT * FROM venues ORDER BY name").all() as VenueRow[]).map(venueSummary);
}

/** Accepts {venue: <rcvenue>} or a bare rcvenue document. */
function venueFromBody(body: unknown): Record<string, unknown> {
  const src = isObject(body) && isObject(body.venue) ? body.venue : body;
  if (!isObject(src)) throw badRequest("invalid-venue", "Body must be an rcvenue document or {venue: …}");
  return src;
}

/** Venue ids appear in URLs: the client may choose one (e.g. "sports-hall-b") or get a generated one. */
export function createVenue(db: DB, user: User, body: unknown) {
  const src = venueFromBody(body);
  if (src.id !== undefined && (typeof src.id !== "string" || !/^[A-Za-z0-9][\w-]{0,63}$/.test(src.id))) {
    throw badRequest("invalid-venue", "Venue id must be 1-64 letters, digits, _ or -");
  }
  const id = typeof src.id === "string" ? src.id : `venue-${randomUUID().slice(0, 8)}`;
  if (db.prepare("SELECT 1 FROM venues WHERE id = ?").get(id)) throw conflict("venue-exists", `Venue ${id} already exists`);
  const doc = { ...src, format: "rcvenue", version: 1, id, revision: 1 };
  assertValidVenue(doc);
  const t = now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO venues (id, forum_venue_id, name, owner_forum_id, current_revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
    ).run(id, doc.info.venue?.id ?? null, doc.info.name, user.id, t, t);
    db.prepare("INSERT INTO venue_revisions (venue_id, revision, rcvenue_json, created_at, created_by) VALUES (?, 1, ?, ?, ?)").run(id, JSON.stringify(doc), t, user.id);
  })();
  return { venue: venueSummary(getVenueRow(db, id)), doc };
}

export function updateVenue(db: DB, user: User, id: string, body: unknown) {
  const row = getVenueRow(db, id);
  const src = venueFromBody(body);
  const revision = row.current_revision + 1;
  const doc = { ...src, format: "rcvenue", version: 1, id, revision };
  assertValidVenue(doc);
  const t = now();
  db.transaction(() => {
    db.prepare("INSERT INTO venue_revisions (venue_id, revision, rcvenue_json, created_at, created_by) VALUES (?, ?, ?, ?, ?)").run(id, revision, JSON.stringify(doc), t, user.id);
    db.prepare("UPDATE venues SET name = ?, forum_venue_id = ?, current_revision = ?, updated_at = ? WHERE id = ?").run(doc.info.name, doc.info.venue?.id ?? null, revision, t, id);
  })();
  return { venue: venueSummary(getVenueRow(db, id)), doc };
}

// ------------------------------------------------------------------ tracks
export interface TrackRow {
  id: string;
  name: string;
  author_forum_id: number;
  author_username: string;
  status: TrackStatus;
  venue_template_id: string | null;
  derived_from_id: string | null;
  current_revision: number;
  approved_revision: number | null;
  lap_length: number;
  corners: number;
  area_length: number;
  area_width: number;
  footprint_w: number;
  footprint_h: number;
  created_at: string;
  updated_at: string;
}

const TRACK_SELECT = "SELECT t.*, u.username AS author_username FROM tracks t JOIN users u ON u.forum_id = t.author_forum_id";

export function trackSummary(r: TrackRow) {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    author: { id: r.author_forum_id, username: r.author_username },
    revision: r.current_revision,
    approvedRevision: r.approved_revision,
    lapLength: r.lap_length,
    corners: r.corners,
    area: { length: r.area_length, width: r.area_width },
    footprint: { width: r.footprint_w, height: r.footprint_h },
    venueTemplateId: r.venue_template_id,
    derivedFromId: r.derived_from_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    url: `/t/${r.id}`,
    previewUrl: `/p/${r.id}/${r.current_revision}.png`,
  };
}

export function getTrackRow(db: DB, id: string): TrackRow {
  const r = db.prepare(`${TRACK_SELECT} WHERE t.id = ?`).get(id) as TrackRow | undefined;
  if (!r) throw notFound("Track");
  return r;
}

/** Status shown inside a revision's document: revisions are immutable, the track's status moves on. */
export function statusOfRevision(row: TrackRow, revision: number): TrackStatus {
  if (row.status === "archived") return "archived";
  if (revision === row.approved_revision) return "approved";
  if (revision === row.current_revision) return row.status;
  return "draft";
}

export function getTrackDoc(db: DB, row: TrackRow, revision = row.current_revision): RcTrack {
  const json = db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ? AND revision = ?").pluck().get(row.id, revision) as string | undefined;
  if (!json) throw notFound("Track revision");
  const doc = JSON.parse(json) as RcTrack;
  doc.info.status = statusOfRevision(row, revision);
  return doc;
}

export function listRevisions(db: DB, row: TrackRow) {
  const rows = db
    .prepare(
      `SELECT r.revision, r.created_at, r.note, r.created_by, u.username FROM track_revisions r JOIN users u ON u.forum_id = r.created_by
       WHERE r.track_id = ? ORDER BY r.revision DESC`,
    )
    .all(row.id) as { revision: number; created_at: string; note: string | null; created_by: number; username: string }[];
  return rows.map((r) => ({
    revision: r.revision,
    createdAt: r.created_at,
    createdBy: { id: r.created_by, username: r.username },
    note: r.note,
    status: statusOfRevision(row, r.revision),
    previewUrl: `/p/${row.id}/${r.revision}.png`,
    downloadUrl: `/api/tracks/${row.id}/r/${r.revision}.rctrack.json`,
  }));
}

export interface ListQuery {
  status?: string;
  venue?: string;
  minLap?: number;
  maxLap?: number;
  q?: string;
}

export function listTracks(db: DB, f: ListQuery): TrackRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status) {
    where.push("t.status = ?");
    args.push(f.status);
  } else where.push("t.status != 'archived'");
  if (f.venue) { where.push("t.venue_template_id = ?"); args.push(f.venue); }
  if (f.minLap !== undefined) { where.push("t.lap_length >= ?"); args.push(f.minLap); }
  if (f.maxLap !== undefined) { where.push("t.lap_length <= ?"); args.push(f.maxLap); }
  if (f.q) { where.push("t.name LIKE ? ESCAPE '\\'"); args.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
  return db.prepare(`${TRACK_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC`).all(...args) as TrackRow[];
}

/** Accepts {track: <rctrack>, fromVenue?, note?} or a bare rctrack document. */
function trackBody(body: unknown): { src: Record<string, unknown>; fromVenue?: string; note?: string } {
  const env = isObject(body) && isObject(body.track) ? body : { track: body };
  if (!isObject(env.track)) throw badRequest("invalid-track", "Body must be an rctrack document or {track: …, fromVenue?, note?}");
  const note = typeof env.note === "string" ? env.note.slice(0, 500) : undefined;
  const fromVenue = typeof env.fromVenue === "string" ? env.fromVenue : undefined;
  return { src: env.track, fromVenue, note };
}

interface SaveOptions {
  status: TrackStatus;
  approve?: boolean;
  note?: string;
}

/** Validate, re-bake (any client `built` is discarded) and insert a new track or a new revision. */
function saveRevision(db: DB, user: User, input: RcTrack, opts: SaveOptions, existing?: TrackRow): RcTrack {
  const { built: _ignored, ...unbaked } = input;
  assertValidTrack(unbaked);
  let doc: RcTrack;
  try {
    doc = bake(unbaked);
  } catch (e) {
    throw badRequest("invalid-track", `The design could not be built: ${(e as Error).message}`);
  }
  const b = doc.built!;
  const t = now();
  const fpW = Math.round((b.footprint.bbox[2] - b.footprint.bbox[0]) * 1000) / 1000;
  const fpH = Math.round((b.footprint.bbox[3] - b.footprint.bbox[1]) * 1000) / 1000;
  const cols = {
    id: doc.id,
    name: doc.info.name,
    status: opts.status,
    venue: doc.basedOn?.venueTemplate ?? null,
    derived: doc.info.derivedFrom?.id ?? null,
    revision: doc.revision,
    lap: b.lapLength,
    corners: b.stats.corners,
    al: doc.area.length,
    aw: doc.area.width,
    fpW,
    fpH,
    t,
  };
  db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE tracks SET name = @name, status = @status, venue_template_id = @venue, derived_from_id = @derived, current_revision = @revision,
           lap_length = @lap, corners = @corners, area_length = @al, area_width = @aw, footprint_w = @fpW, footprint_h = @fpH, updated_at = @t
         WHERE id = @id`,
      ).run(cols);
    } else {
      db.prepare(
        `INSERT INTO tracks (id, name, author_forum_id, status, venue_template_id, derived_from_id, current_revision, approved_revision,
           lap_length, corners, area_length, area_width, footprint_w, footprint_h, created_at, updated_at)
         VALUES (@id, @name, @author, @status, @venue, @derived, @revision, @approved, @lap, @corners, @al, @aw, @fpW, @fpH, @t, @t)`,
      ).run({ ...cols, author: user.id, approved: opts.approve ? doc.revision : null });
    }
    db.prepare("INSERT INTO track_revisions (track_id, revision, rctrack_json, created_at, created_by, note) VALUES (?, ?, ?, ?, ?, ?)").run(
      doc.id,
      doc.revision,
      JSON.stringify(doc),
      t,
      user.id,
      opts.note ?? null,
    );
  })();
  return doc;
}

const TRACK_KEYS = ["area", "obstacles", "design"] as const;

/** New draft track from the client's document. Server-owned fields (id, revision, author, dates, status) are set here. */
export function createTrack(db: DB, user: User, body: unknown, opts: { keepId?: boolean; status?: TrackStatus; approve?: boolean } = {}) {
  const { src, fromVenue, note } = trackBody(body);
  const t = now();
  const info = isObject(src.info) ? src.info : {};
  const status = opts.status ?? "draft";
  const doc: Record<string, unknown> = {
    format: "rctrack",
    version: 1,
    id: opts.keepId && typeof src.id === "string" ? src.id : randomUUID(),
    revision: 1,
    info: { ...info, name: typeof info.name === "string" && info.name.trim() ? info.name : "Untitled track", author: user.username, created: t, modified: t, status },
    basedOn: null,
    obstacles: [],
  };
  for (const k of TRACK_KEYS) if (src[k] !== undefined) doc[k] = src[k];
  if (opts.keepId) {
    // imports (seed) keep their provenance
    doc.basedOn = src.basedOn ?? null;
    if (isObject(info) && info.created) (doc.info as Record<string, unknown>).created = info.created;
  } else {
    delete (doc.info as Record<string, unknown>).derivedFrom;
  }
  if (fromVenue) {
    const venue = getVenueDoc(db, fromVenue);
    doc.area = { ...venue.area };
    doc.obstacles = structuredClone(venue.obstacles ?? []);
    doc.basedOn = { venueTemplate: venue.id, revision: venue.revision };
    (doc.info as Record<string, unknown>).venue = venue.info.venue ?? null;
    if (isObject(doc.design)) doc.design = { ...doc.design, rostrum: { ...(venue.rostrum ?? { side: "south" }) } };
  }
  if (db.prepare("SELECT 1 FROM tracks WHERE id = ?").get(doc.id)) throw conflict("track-exists", `Track ${String(doc.id)} already exists`);
  const saved = saveRevision(db, user, doc as unknown as RcTrack, { status, approve: opts.approve, note });
  return { track: trackSummary(getTrackRow(db, saved.id)), doc: getTrackDoc(db, getTrackRow(db, saved.id)) };
}

const canEdit = (user: User, row: TrackRow) => user.id === row.author_forum_id || user.organiser;

/** New revision. Author, provenance and creation date are kept; a changed track goes back to draft. */
export function updateTrack(db: DB, user: User, id: string, body: unknown) {
  const row = getTrackRow(db, id);
  if (!canEdit(user, row)) throw forbidden("Only the author or an organiser can change this track");
  if (row.status === "archived") throw conflict("archived", "Archived tracks can't be changed");
  const prev = getTrackDoc(db, row);
  const { src, note } = trackBody(body);
  const info = isObject(src.info) ? src.info : {};
  const doc: Record<string, unknown> = {
    format: "rctrack",
    version: 1,
    id: row.id,
    revision: row.current_revision + 1,
    info: {
      ...info,
      name: typeof info.name === "string" && info.name.trim() ? info.name : prev.info.name,
      author: prev.info.author,
      created: prev.info.created,
      modified: now(),
      status: "draft",
      ...(prev.info.derivedFrom ? { derivedFrom: prev.info.derivedFrom } : {}),
    },
    basedOn: prev.basedOn ?? null,
    obstacles: prev.obstacles ?? [],
    area: prev.area,
  };
  if (!prev.info.derivedFrom) delete (doc.info as Record<string, unknown>).derivedFrom;
  for (const k of TRACK_KEYS) if (src[k] !== undefined) doc[k] = src[k];
  saveRevision(db, user, doc as unknown as RcTrack, { status: "draft", note }, row);
  const updated = getTrackRow(db, id);
  return { track: trackSummary(updated), doc: getTrackDoc(db, updated) };
}

export type StatusAction = "submit" | "approve" | "archive";

export function changeStatus(db: DB, user: User, id: string, action: StatusAction) {
  const row = getTrackRow(db, id);
  if (row.status === "archived") throw conflict("archived", "This track is archived");
  if (action === "submit") {
    if (user.id !== row.author_forum_id) throw forbidden("Only the author can submit this track");
    if (row.status !== "draft") throw conflict("bad-status", `Only drafts can be submitted (this track is ${row.status})`);
    db.prepare("UPDATE tracks SET status = 'submitted', updated_at = ? WHERE id = ?").run(now(), id);
  } else {
    if (!user.organiser) throw forbidden("Only organisers can do that");
    if (action === "approve") {
      if (row.status === "approved" && row.approved_revision === row.current_revision) throw conflict("bad-status", "Already approved");
      db.prepare("UPDATE tracks SET status = 'approved', approved_revision = current_revision, updated_at = ? WHERE id = ?").run(now(), id);
    } else {
      db.prepare("UPDATE tracks SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    }
  }
  return trackSummary(getTrackRow(db, id));
}

// ------------------------------------------------------------------ fit + adapt
export interface FitAnswer {
  track: { id: string; revision: number };
  venue: { id: string; revision: number };
  results: FitResult[];
}

/** Fit search for one track revision in a venue's current revision, cached (revisions never change). */
export function fitTrack(db: DB, row: TrackRow, venueId: string, revision = row.current_revision): FitAnswer {
  const vrow = getVenueRow(db, venueId);
  const key = [row.id, revision, venueId, vrow.current_revision];
  const cached = db
    .prepare("SELECT results_json FROM fit_cache WHERE track_id = ? AND track_revision = ? AND venue_id = ? AND venue_revision = ?")
    .pluck()
    .get(...key) as string | undefined;
  let results: FitResult[];
  if (cached) results = JSON.parse(cached) as FitResult[];
  else {
    results = fits(getTrackDoc(db, row, revision), getVenueDoc(db, venueId, vrow.current_revision));
    db.prepare("INSERT OR REPLACE INTO fit_cache (track_id, track_revision, venue_id, venue_revision, results_json) VALUES (?, ?, ?, ?, ?)").run(...key, JSON.stringify(results));
  }
  return { track: { id: row.id, revision }, venue: { id: venueId, revision: vrow.current_revision }, results };
}

/** Approved tracks (their pinned revision) that fit the venue. */
export function tracksFitting(db: DB, venueId: string, f: Omit<ListQuery, "status">) {
  getVenueRow(db, venueId);
  const rows = listTracks(db, f).filter((r) => r.approved_revision !== null);
  const out = [];
  for (const row of rows) {
    const fit = fitTrack(db, row, venueId, row.approved_revision!);
    if (fit.results.length) out.push({ ...trackSummary(row), fit: { revision: fit.track.revision, results: fit.results } });
  }
  return out;
}

export function adaptTrack(db: DB, user: User, id: string, venueId: string, orientation?: string) {
  const row = getTrackRow(db, id);
  const answer = fitTrack(db, row, venueId);
  if (!answer.results.length) throw new HttpError(422, "does-not-fit", "This track doesn't fit that venue in any orientation");
  const fit = orientation ? answer.results.find((r) => r.orientation === orientation) : answer.results[0];
  if (!fit) throw badRequest("bad-orientation", `It doesn't fit as "${orientation}"; options: ${answer.results.map((r) => r.orientation).join(", ")}`);
  const adapted = adapt(getTrackDoc(db, row), getVenueDoc(db, venueId), fit);
  const t = now();
  adapted.info = { ...adapted.info, author: user.username, created: t, modified: t, status: "draft" };
  const saved = saveRevision(db, user, adapted, { status: "draft", note: `Adapted from ${row.name} r${row.current_revision} (${fit.orientation})` });
  const newRow = getTrackRow(db, saved.id);
  return { track: trackSummary(newRow), doc: getTrackDoc(db, newRow), fit };
}
