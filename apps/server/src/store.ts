// Tracks, venues and their revisions. Every save validates, re-bakes with the engine and adds a revision row.
import { createHash, randomUUID } from "node:crypto";
import {
  adapt,
  bake,
  fits,
  ORIENTS,
  previewSvg,
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
// A track has a latest revision (current_revision) and, once approved, a pinned approved revision. What the public
// sees — library, links, embeds, fit searches, meetings — is the approved revision if there is one, else the latest.
// Editing an approved track adds a newer draft; the approved revision stays public until the new one is approved.
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
  footprint_w: number;
  footprint_h: number;
  venue_name: string | null;
  created_at: string;
  updated_at: string;
  // the public revision (approved ?? latest)
  d_revision: number;
  d_name: string;
  d_lap: number;
  d_corners: number;
  d_size_l: number | null;
  d_size_w: number | null;
  d_area_l: number;
  d_area_w: number;
  d_hash: string;
  // the latest revision
  l_errors: number;
  l_hash: string;
  derived_name: string | null;
  derived_author: string | null;
}

const TRACK_SELECT = `SELECT t.*, u.username AS author_username, v.name AS venue_name,
    r.revision AS d_revision, r.name AS d_name, r.lap_length AS d_lap, r.corners AS d_corners, r.size_length AS d_size_l,
    r.size_width AS d_size_w, r.area_length AS d_area_l, r.area_width AS d_area_w, r.preview_hash AS d_hash,
    l.errors AS l_errors, l.preview_hash AS l_hash, d.name AS derived_name, du.username AS derived_author
  FROM tracks t
  JOIN users u ON u.forum_id = t.author_forum_id
  LEFT JOIN venues v ON v.id = t.venue_template_id
  JOIN track_revisions r ON r.track_id = t.id AND r.revision = COALESCE(t.approved_revision, t.current_revision)
  JOIN track_revisions l ON l.track_id = t.id AND l.revision = t.current_revision
  LEFT JOIN tracks d ON d.id = t.derived_from_id
  LEFT JOIN users du ON du.forum_id = d.author_forum_id`;

/** The revision the public sees. */
export const publicRevision = (row: Pick<TrackRow, "approved_revision" | "current_revision">) => row.approved_revision ?? row.current_revision;

export const previewUrl = (id: string, revision: number, hash: string) => `/p/${id}/${revision}.png?v=${hash}`;

export function trackSummary(r: TrackRow) {
  return {
    id: r.id,
    /** name of the public revision */
    name: r.d_name,
    /** workflow state of the latest revision */
    status: r.status,
    author: { id: r.author_forum_id, username: r.author_username },
    /** latest revision */
    revision: r.current_revision,
    approvedRevision: r.approved_revision,
    /** the revision shown publicly: approved if there is one, else the latest */
    publicRevision: r.d_revision,
    /** an approved track with a newer draft/submitted revision in progress */
    newerRevision: r.approved_revision !== null && r.current_revision > r.approved_revision ? { revision: r.current_revision, status: r.status } : null,
    /** error-level checks on the latest revision (submitting is blocked while > 0) */
    errors: r.l_errors,
    lapLength: r.d_lap,
    corners: r.d_corners,
    area: { length: r.d_area_l, width: r.d_area_w },
    /** real size from the lane edges; null until re-baked with engine 1.2 */
    size: r.d_size_l === null || r.d_size_w === null ? null : { length: r.d_size_l, width: r.d_size_w },
    footprint: { width: r.footprint_w, height: r.footprint_h },
    venue: r.venue_template_id ? { id: r.venue_template_id, name: r.venue_name } : null,
    venueTemplateId: r.venue_template_id,
    derivedFromId: r.derived_from_id,
    derivedFrom: r.derived_from_id ? { id: r.derived_from_id, name: r.derived_name, author: r.derived_author } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    url: `/t/${r.id}`,
    previewUrl: previewUrl(r.id, r.d_revision, r.d_hash),
    latestPreviewUrl: previewUrl(r.id, r.current_revision, r.l_hash),
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

export function getTrackDoc(db: DB, row: TrackRow, revision: number): RcTrack {
  const json = db.prepare("SELECT rctrack_json FROM track_revisions WHERE track_id = ? AND revision = ?").pluck().get(row.id, revision) as string | undefined;
  if (!json) throw notFound("Track revision");
  const doc = JSON.parse(json) as RcTrack;
  doc.info.status = statusOfRevision(row, revision);
  return doc;
}

/** Per-revision summary columns, computed from the baked document. */
export function revisionColumns(doc: RcTrack) {
  const b = doc.built!;
  return {
    name: doc.info.name,
    lap: b.lapLength,
    corners: b.stats.corners,
    sizeL: b.size?.length ?? null,
    sizeW: b.size?.width ?? null,
    al: doc.area.length,
    aw: doc.area.width,
    errors: b.checks.filter((c) => c.level === "error").length,
    hash: previewHash(doc),
  };
}

/** Changes whenever the drawn preview changes; goes into preview URLs so year-long caching is safe. */
export function previewHash(doc: RcTrack): string {
  return createHash("sha256").update(previewSvg(doc)).digest("hex").slice(0, 12);
}

const SET_REVISION_COLUMNS = `UPDATE track_revisions SET name = @name, lap_length = @lap, corners = @corners, size_length = @sizeL,
  size_width = @sizeW, area_length = @al, area_width = @aw, errors = @errors, preview_hash = @hash WHERE track_id = @id AND revision = @revision`;

export function setRevisionColumns(db: DB, id: string, revision: number, doc: RcTrack) {
  db.prepare(SET_REVISION_COLUMNS).run({ id, revision, ...revisionColumns(doc) });
}

/** Fill in summary columns for revisions saved before they existed (migration 003). */
export function backfillRevisions(db: DB): number {
  const rows = db.prepare("SELECT track_id, revision, rctrack_json FROM track_revisions WHERE preview_hash IS NULL").all() as {
    track_id: string;
    revision: number;
    rctrack_json: string;
  }[];
  db.transaction(() => {
    for (const r of rows) setRevisionColumns(db, r.track_id, r.revision, JSON.parse(r.rctrack_json) as RcTrack);
  })();
  return rows.length;
}

export function listRevisions(db: DB, row: TrackRow) {
  const rows = db
    .prepare(
      `SELECT r.revision, r.created_at, r.note, r.created_by, r.preview_hash, r.errors, u.username FROM track_revisions r
       JOIN users u ON u.forum_id = r.created_by WHERE r.track_id = ? ORDER BY r.revision DESC`,
    )
    .all(row.id) as { revision: number; created_at: string; note: string | null; created_by: number; username: string; preview_hash: string; errors: number }[];
  return rows.map((r) => ({
    revision: r.revision,
    createdAt: r.created_at,
    createdBy: { id: r.created_by, username: r.username },
    note: r.note,
    status: statusOfRevision(row, r.revision),
    errors: r.errors,
    previewUrl: previewUrl(row.id, r.revision, r.preview_hash),
    downloadUrl: `/api/tracks/${row.id}/r/${r.revision}.rctrack.json`,
  }));
}

export interface ListQuery {
  status?: string;
  venue?: string;
  minLap?: number;
  maxLap?: number;
  minCorners?: number;
  maxCorners?: number;
  q?: string;
}

/** Filters apply to what the public sees (the approved revision when there is one). */
export function listTracks(db: DB, f: ListQuery): TrackRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status === "approved") where.push("t.approved_revision IS NOT NULL AND t.status != 'archived'");
  else if (f.status) {
    where.push("t.status = ?");
    args.push(f.status);
  } else where.push("t.status != 'archived'");
  if (f.venue) { where.push("t.venue_template_id = ?"); args.push(f.venue); }
  if (f.minLap !== undefined) { where.push("r.lap_length >= ?"); args.push(f.minLap); }
  if (f.maxLap !== undefined) { where.push("r.lap_length <= ?"); args.push(f.maxLap); }
  if (f.minCorners !== undefined) { where.push("r.corners >= ?"); args.push(f.minCorners); }
  if (f.maxCorners !== undefined) { where.push("r.corners <= ?"); args.push(f.maxCorners); }
  if (f.q) { where.push("r.name LIKE ? ESCAPE '\\'"); args.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
  return db.prepare(`${TRACK_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC`).all(...args) as TrackRow[];
}

/** Accepts {track: <rctrack>, fromVenue?, note?, baseRevision?} or a bare rctrack document. */
function trackBody(body: unknown): { src: Record<string, unknown>; fromVenue?: string; note?: string; baseRevision?: number } {
  const env = isObject(body) && isObject(body.track) ? body : { track: body };
  if (!isObject(env.track)) throw badRequest("invalid-track", "Body must be an rctrack document or {track: …, fromVenue?, note?}");
  const note = typeof env.note === "string" && env.note.trim() ? env.note.trim().slice(0, 500) : undefined;
  const fromVenue = typeof env.fromVenue === "string" ? env.fromVenue : undefined;
  const baseRevision = typeof env.baseRevision === "number" ? env.baseRevision : undefined;
  return { src: env.track, fromVenue, note, baseRevision };
}

interface SaveOptions {
  status: TrackStatus;
  approve?: boolean;
  note?: string;
}

/** The `tracks` summary columns that come from the latest baked document. */
export function builtColumns(doc: RcTrack) {
  const b = doc.built!;
  const m3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    lap: b.lapLength,
    corners: b.stats.corners,
    al: doc.area.length,
    aw: doc.area.width,
    fpW: m3(b.footprint.bbox[2] - b.footprint.bbox[0]),
    fpH: m3(b.footprint.bbox[3] - b.footprint.bbox[1]),
    sizeL: b.size?.length ?? null,
    sizeW: b.size?.width ?? null,
  };
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
  const t = now();
  const cols = { id: doc.id, name: doc.info.name, status: opts.status, venue: doc.basedOn?.venueTemplate ?? null, derived: doc.info.derivedFrom?.id ?? null, revision: doc.revision, ...builtColumns(doc), t };
  db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE tracks SET name = @name, status = @status, venue_template_id = @venue, derived_from_id = @derived, current_revision = @revision,
           lap_length = @lap, corners = @corners, area_length = @al, area_width = @aw, footprint_w = @fpW, footprint_h = @fpH,
           size_length = @sizeL, size_width = @sizeW, updated_at = @t
         WHERE id = @id`,
      ).run(cols);
    } else {
      db.prepare(
        `INSERT INTO tracks (id, name, author_forum_id, status, venue_template_id, derived_from_id, current_revision, approved_revision,
           lap_length, corners, area_length, area_width, footprint_w, footprint_h, size_length, size_width, created_at, updated_at)
         VALUES (@id, @name, @author, @status, @venue, @derived, @revision, @approved, @lap, @corners, @al, @aw, @fpW, @fpH, @sizeL, @sizeW, @t, @t)`,
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
    setRevisionColumns(db, doc.id, doc.revision, doc);
  })();
  return doc;
}

const TRACK_KEYS = ["area", "obstacles", "design"] as const;

function trackResult(db: DB, id: string, user: User | null) {
  const row = getTrackRow(db, id);
  return { track: trackSummary(row), doc: getTrackDoc(db, row, row.current_revision), can: permissions(user, row) };
}

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
  return trackResult(db, saved.id, user);
}

const canEdit = (user: User, row: TrackRow) => user.id === row.author_forum_id || user.organiser;

/** What the current user may do with the track — mirrors the checks in updateTrack/changeStatus/copy/adapt. */
export function permissions(user: User | null, row: TrackRow) {
  const live = row.status !== "archived";
  const latestApproved = row.approved_revision === row.current_revision;
  return {
    edit: !!user && live && canEdit(user, row),
    /** allowed to submit (the button may still be blocked by `errors`) */
    submit: !!user && live && user.id === row.author_forum_id && row.status === "draft",
    approve: !!user && live && user.organiser && !latestApproved,
    archive: !!user && live && user.organiser,
    adapt: !!user,
    copy: !!user,
  };
}

/**
 * New revision. Author, provenance and creation date are kept; the new revision is a draft. If the track was
 * approved, the approved revision stays pinned (and public) until a newer one is approved.
 */
export function updateTrack(db: DB, user: User, id: string, body: unknown) {
  const row = getTrackRow(db, id);
  if (!canEdit(user, row)) throw forbidden("Only the author or an organiser can change this track");
  if (row.status === "archived") throw conflict("archived", "Archived tracks can't be changed");
  const { src, note, baseRevision } = trackBody(body);
  if (baseRevision !== undefined && baseRevision !== row.current_revision) {
    throw conflict("stale", `Revision ${row.current_revision} was saved since you started editing revision ${baseRevision}. Reload to see it.`);
  }
  const prev = getTrackDoc(db, row, row.current_revision);
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
  // a track started from a venue template keeps the template's area, obstacles and rostrum
  if (prev.basedOn) {
    doc.area = prev.area;
    doc.obstacles = prev.obstacles ?? [];
    if (isObject(doc.design)) doc.design = { ...doc.design, rostrum: prev.design.rostrum };
  }
  saveRevision(db, user, doc as unknown as RcTrack, { status: "draft", note }, row);
  return trackResult(db, id, user);
}

export type StatusAction = "submit" | "approve" | "archive";

function assertNoErrors(db: DB, row: TrackRow, what: string) {
  if (row.l_errors === 0) return;
  const doc = getTrackDoc(db, row, row.current_revision);
  const errors = doc.built!.checks.filter((c) => c.level === "error");
  throw new HttpError(409, "has-errors", `Fix the errors before ${what}: ${errors.map((c) => c.message).join("; ")}`, errors);
}

export function changeStatus(db: DB, user: User, id: string, action: StatusAction) {
  const row = getTrackRow(db, id);
  if (row.status === "archived") throw conflict("archived", "This track is archived");
  if (action === "submit") {
    if (user.id !== row.author_forum_id) throw forbidden("Only the author can submit this track");
    if (row.status !== "draft") throw conflict("bad-status", `Only drafts can be submitted (this track is ${row.status})`);
    assertNoErrors(db, row, "submitting");
    db.prepare("UPDATE tracks SET status = 'submitted', updated_at = ? WHERE id = ?").run(now(), id);
  } else {
    if (!user.organiser) throw forbidden("Only organisers can do that");
    if (action === "approve") {
      if (row.approved_revision === row.current_revision) throw conflict("bad-status", "Already approved");
      assertNoErrors(db, row, "approving");
      db.prepare("UPDATE tracks SET status = 'approved', approved_revision = current_revision, updated_at = ? WHERE id = ?").run(now(), id);
    } else {
      db.prepare("UPDATE tracks SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    }
  }
  return trackSummary(getTrackRow(db, id));
}

/** "Make my own copy": a new draft for the user, credited to the original (info.derivedFrom). */
export function copyTrack(db: DB, user: User, id: string, revision?: number) {
  const row = getTrackRow(db, id);
  const rev = revision ?? publicRevision(row);
  const src = getTrackDoc(db, row, rev);
  const t = now();
  const doc: RcTrack = {
    ...structuredClone(src),
    id: randomUUID(),
    revision: 1,
    info: {
      ...src.info,
      name: `${src.info.name} (copy)`.slice(0, 80),
      author: user.username,
      created: t,
      modified: t,
      status: "draft",
      derivedFrom: { id: row.id, revision: rev, author: row.author_username },
    },
  };
  const saved = saveRevision(db, user, doc, { status: "draft", note: `Copy of ${row.d_name} r${rev} by ${row.author_username}` });
  return trackResult(db, saved.id, user);
}

// ------------------------------------------------------------------ fit + adapt
export type FitResultWithThumb = FitResult & { thumbUrl: string };

export interface FitAnswer {
  track: { id: string; revision: number };
  venue: { id: string; revision: number };
  results: FitResultWithThumb[];
}

/** Picture of the track placed as `fit` in the venue: /p/:id/:rev/fit/:venueId/:k.png, k = index in ORIENTS. */
export function fitThumbUrl(trackId: string, revision: number, trackHash: string, venueId: string, venueRevision: number, fit: FitResult) {
  const k = ORIENTS.findIndex(([label]) => label === fit.orientation);
  return `/p/${trackId}/${revision}/fit/${venueId}/${k}.png?v=${trackHash}.${venueRevision}`;
}

/** Fit search for one track revision (default: the public one) in a venue's current revision, cached. */
export function fitTrack(db: DB, row: TrackRow, venueId: string, revision = publicRevision(row)): FitAnswer {
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
  const hash = db.prepare("SELECT preview_hash FROM track_revisions WHERE track_id = ? AND revision = ?").pluck().get(row.id, revision) as string;
  return {
    track: { id: row.id, revision },
    venue: { id: venueId, revision: vrow.current_revision },
    results: results.map((r) => ({ ...r, thumbUrl: fitThumbUrl(row.id, revision, hash, venueId, vrow.current_revision, r) })),
  };
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

export function adaptTrack(db: DB, user: User, id: string, venueId: string, orientation?: string, revision?: number) {
  const row = getTrackRow(db, id);
  const rev = revision ?? publicRevision(row);
  const answer = fitTrack(db, row, venueId, rev);
  if (!answer.results.length) throw new HttpError(422, "does-not-fit", "This track doesn't fit that venue in any orientation");
  const fit = orientation ? answer.results.find((r) => r.orientation === orientation) : answer.results[0];
  if (!fit) throw badRequest("bad-orientation", `It doesn't fit as "${orientation}"; options: ${answer.results.map((r) => r.orientation).join(", ")}`);
  const { thumbUrl: _t, ...plainFit } = fit;
  const adapted = adapt(getTrackDoc(db, row, rev), getVenueDoc(db, venueId), plainFit);
  const t = now();
  adapted.info = { ...adapted.info, author: user.username, created: t, modified: t, status: "draft" };
  const saved = saveRevision(db, user, adapted, { status: "draft", note: `Adapted from ${row.d_name} r${rev} (${fit.orientation})` });
  return { ...trackResult(db, saved.id, user), fit: plainFit };
}
