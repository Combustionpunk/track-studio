// JSON API. Reads are public, except drafts (visibility.ts, #175); writes need a session (see auth.ts guards).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { rctrackFileName, rcvenueFileName, type RcTrack, type RcVenue } from "@track-studio/engine";
import type { DB } from "./db.js";
import { requireOrganiser, requireUser } from "./auth.js";
import { badRequest, notFound } from "./errors.js";
import { usedAt, type ForumEvents } from "./forum-events.js";
import type { ForumStats } from "./forum-stats.js";
import { assertTrackAtVenue, searchForumVenues, type ForumVenues } from "./forum-venues.js";
import { dropLinkedSurface, withForumSurface } from "./venue-surface.js";
import { assertMayEditVenue, canEditVenue } from "./venue-access.js";
import { getClassSpeeds, setClassSpeeds, speedFor, typicalLap } from "./lap-times.js";
import {
  adaptTrack,
  assertCanChange,
  changeStatus,
  copyTrack,
  createTrack,
  createVenue,
  fitTrack,
  getTrackDoc,
  getVenueDoc,
  getVenueRow,
  getVenueRowByForumTrack,
  listRevisions,
  listTracks,
  listVenueRevisions,
  listVenues,
  lockReason,
  permissions,
  publicRevision,
  tracksFitting,
  trackSummary,
  updateTrack,
  updateVenue,
  venueFromBody,
  venueSummary,
  type ListQuery,
  type StatusAction,
  type TrackRow,
} from "./store.js";
import { cacheControl, changeableTrackRow, visibleRows, visibleTrackRow } from "./visibility.js";

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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function registerRoutes(app: FastifyInstance, db: DB, forumEvents: ForumEvents, forumStats: ForumStats, forumVenues: ForumVenues): void {
  /**
   * A forum event uses the layout (#66), so it's locked (#64). Asked fresh: an event may have picked it since the page
   * loaded. Unknown while the forum is down (the last answer, else not locked: events only pick library layouts, which
   * are locked anyway).
   */
  const usedByEvent = async (id: string) => ((await forumEvents.forLayout(id, { fresh: true }))?.length ?? 0) > 0;
  /** the track for this reader; someone else's draft is a 404, like an id that isn't there (#175) */
  const trackFor = (req: FastifyRequest, id: string) => visibleTrackRow(db, forumEvents, req.user, id);
  // ---------------------------------------------------------------- tracks
  app.get("/api/tracks", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    // author=me is the only author filter: lists aren't searchable by other members' ids (a repeated param is an array)
    const author: unknown = q.author;
    if (author !== undefined && author !== "" && author !== "me") throw badRequest("bad-request", "author must be me");
    const authorId = author === "me" ? requireUser(req).id : undefined;
    if (q.status && !STATUSES.includes(q.status)) throw badRequest("bad-request", `status must be one of ${STATUSES.join(", ")}`);
    if (q.racedAt && !/^[1-9]\d{0,9}$/.test(q.racedAt)) throw badRequest("bad-request", "racedAt must be a forum venue id");
    const racedAt = q.racedAt ? Number(q.racedAt) : undefined;
    // "Typical lap for <class> between X and Y s", sort by typical lap (#76)
    const rawClass: unknown = q.lapClass;
    if (rawClass !== undefined && typeof rawClass !== "string") throw badRequest("bad-request", "lapClass must be one class");
    const lapClass = rawClass?.trim() || undefined;
    const minTypical = num(q.minTypical, "minTypical");
    const maxTypical = num(q.maxTypical, "maxTypical");
    if (q.sort && q.sort !== "typical") throw badRequest("bad-request", "sort must be typical");
    if (!lapClass && (q.sort || minTypical !== undefined || maxTypical !== undefined)) throw badRequest("bad-request", "sort=typical, minTypical and maxTypical need lapClass");
    const filter: ListQuery = {
      status: q.status,
      venue: q.venue || undefined,
      minLap: num(q.minLap, "minLap"),
      maxLap: num(q.maxLap, "maxLap"),
      minCorners: num(q.minCorners, "minCorners"),
      maxCorners: num(q.maxCorners, "maxCorners"),
      q: q.q || undefined,
      authorId,
    };
    // approved layouts fit a venue; the plain list leaves out other members' drafts (#175)
    const tracks = q.fits
      ? tracksFitting(db, q.fits, (({ status: _ignored, ...rest }) => rest)(filter))
      : (await visibleRows(forumEvents, req.user, listTracks(db, filter))).map(trackSummary);
    // both asked at once (each cached; a slow forum costs one timeout, not two)
    const ids = tracks.map((t) => t.id);
    const [events, stats] = await Promise.all([racedAt !== undefined ? forumEvents.forLayouts(ids) : null, lapClass ? forumStats.forLayouts(ids) : null]);
    // "Raced at <venue>": the forum's events for each listed layout; forum down -> none match
    const listed = events ? tracks.filter((t) => events.get(t.id)?.some((e) => e.venue?.id === racedAt)) : tracks;
    if (!lapClass || !stats) return { tracks: listed };
    // the forum's typical lap for the class, else the estimate from the lap length; forum down -> estimates
    const speed = speedFor(getClassSpeeds(db), lapClass);
    let withLap = listed.map((t) => ({ ...t, typicalLap: typicalLap(stats.get(t.id) ?? null, lapClass, t.lapLength, speed) }));
    if (minTypical !== undefined || maxTypical !== undefined)
      withLap = withLap.filter((t) => t.typicalLap && t.typicalLap.seconds >= (minTypical ?? 0) && t.typicalLap.seconds <= (maxTypical ?? Infinity));
    // fastest first, unknowns last; otherwise the list's own order
    if (q.sort === "typical") withLap.sort((a, b) => (a.typicalLap?.seconds ?? Infinity) - (b.typicalLap?.seconds ?? Infinity));
    return { tracks: withLap };
  });

  app.post("/api/tracks", async (req, reply) => {
    const user = requireUser(req);
    return reply.code(201).send(createTrack(db, user, req.body));
  });

  // the public revision (approved ?? latest); editors load the latest with /r/:revision
  // usedAt: where the forum says the layout was raced (#66); lapStats: its lap times per class (#76); each null when
  // the forum can't be reached
  app.get("/api/tracks/:id", async (req) => {
    const row = await trackFor(req, (req.params as { id: string }).id);
    const [events, lapStats] = await Promise.all([forumEvents.forLayout(row.id), forumStats.forLayout(row.id)]);
    const used = !!events?.length;
    return {
      track: { ...trackSummary(row), locked: lockReason(row, used) },
      doc: getTrackDoc(db, row, publicRevision(row)),
      can: permissions(req.user, row, used),
      usedAt: events && usedAt(events),
      lapStats,
    };
  });

  app.put("/api/tracks/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    // 404, 403 and archived before asking the forum: only someone who may edit it triggers a forum call
    const row = changeableTrackRow(db, user, id);
    assertCanChange(user, row);
    return updateTrack(db, user, id, req.body, await usedByEvent(id));
  });

  app.get("/api/tracks/:id/revisions", async (req) => {
    const row = await trackFor(req, (req.params as { id: string }).id);
    return { revisions: listRevisions(db, row) };
  });

  const sendTrackFile = (reply: FastifyReply, row: TrackRow, doc: RcTrack, maxAge: number) =>
    reply
      .header("content-disposition", `attachment; filename="${rctrackFileName(doc.info.name, doc.revision)}"`)
      .header("cache-control", cacheControl(row, `max-age=${maxAge}`))
      .type("application/json; charset=utf-8")
      .send(JSON.stringify(doc, null, 1));

  // download: /api/tracks/:id/r/3.rctrack.json (or /r/3 for plain JSON); meetings pin a revision this way
  app.get("/api/tracks/:id/r/:file", async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const m = /^(\d+)(\.rctrack\.json)?$/.exec(file);
    if (!m) throw notFound("Track revision");
    const row = await trackFor(req, id);
    const doc = getTrackDoc(db, row, revisionParam(m[1]));
    if (m[2]) return sendTrackFile(reply, row, doc, 300);
    return reply.type("application/json; charset=utf-8").send(JSON.stringify(doc, null, 1));
  });

  // the public revision (approved ?? latest) as a download, for links that shouldn't know revision numbers: the forum's
  // "practise in the sim" link, the sim's library (#155). Follows approval, so it is cached briefly.
  app.get("/api/tracks/:id/latest.rctrack.json", async (req, reply) => {
    const row = await trackFor(req, (req.params as { id: string }).id);
    return sendTrackFile(reply, row, getTrackDoc(db, row, publicRevision(row)), 60);
  });

  for (const action of ["submit", "approve", "archive"] as StatusAction[]) {
    app.post(`/api/tracks/:id/${action}`, async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      changeableTrackRow(db, user, id);
      return { track: changeStatus(db, user, id, action) };
    });
  }

  // ?r=<revision>, default the public one
  app.get("/api/tracks/:id/fit/:venueId", async (req) => {
    const { id, venueId } = req.params as { id: string; venueId: string };
    const { r } = req.query as { r?: string };
    return fitTrack(db, await trackFor(req, id), venueId, r ? revisionParam(r) : undefined);
  });

  app.post("/api/tracks/:id/adapt/:venueId", async (req, reply) => {
    const user = requireUser(req);
    const { id, venueId } = req.params as { id: string; venueId: string };
    const body = (req.body ?? {}) as { orientation?: unknown; revision?: unknown };
    const orientation = typeof body.orientation === "string" ? body.orientation : undefined;
    const revision = typeof body.revision === "number" ? body.revision : undefined;
    await trackFor(req, id);
    // #190: the copy takes the template's surface as served (a linked template's is the forum's); when the forum gives
    // the track no surface the format has (grass, or none), the copy has none either, not the source layout's
    const { doc: venue, forumTrack } = await withForumSurface(getVenueDoc(db, venueId), forumVenues);
    return reply.code(201).send(adaptTrack(db, user, id, venueId, orientation, revision, { venue, dropSurface: !!forumTrack?.known && !venue.surface }));
  });

  // "Make my own copy" — body {revision?}, default the public revision
  app.post("/api/tracks/:id/copy", async (req, reply) => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as { revision?: unknown };
    await trackFor(req, (req.params as { id: string }).id);
    return reply.code(201).send(copyTrack(db, user, (req.params as { id: string }).id, typeof body.revision === "number" ? body.revision : undefined));
  });

  // the forum venues library layouts were raced at, for the library's "Raced at" filter (#66)
  app.get("/api/raced-venues", async () => {
    const ids = listTracks(db, { status: "approved" }).map((t) => t.id);
    const events = await forumEvents.forLayouts(ids);
    const venues = new Map<number, { id: number; name: string; layouts: number }>();
    let known = 0;
    for (const list of events.values()) {
      if (list) known++;
      for (const v of usedAt(list ?? []).venues) {
        const seen = venues.get(v.id) ?? { ...v, layouts: 0 };
        seen.layouts++;
        venues.set(v.id, seen);
      }
    }
    const list = [...venues.values()].sort((a, b) => b.layouts - a.layouts || a.name.localeCompare(b.name));
    return ids.length && !known ? { venues: list, unavailable: true } : { venues: list };
  });

  // ---------------------------------------------------------------- class speeds
  // per-class speed for the lap time estimate (#76): anyone reads, track-admins replace the list
  app.get("/api/class-speeds", async () => ({ classes: getClassSpeeds(db) }));
  app.put("/api/class-speeds", async (req) => {
    requireOrganiser(req);
    return { classes: setClassSpeeds(db, req.body) };
  });

  // ---------------------------------------------------------------- venues
  // ?forumTrack=<id>: the template for that forum track (the forum plugin's layout picker asks, from any origin)
  app.get("/api/venues", async (req, reply) => {
    const { forumTrack } = req.query as { forumTrack?: string };
    if (forumTrack === undefined) return { venues: listVenues(db) };
    reply.header("access-control-allow-origin", "*");
    if (!/^\d{1,9}$/.test(forumTrack)) throw notFound("Venue template for that forum track");
    const row = getVenueRowByForumTrack(db, Number(forumTrack));
    return { venue: venueSummary(row), doc: (await withForumSurface(getVenueDoc(db, row.id), forumVenues)).doc };
  });

  // the forum's venues and their tracks, for the venue editor's picker
  app.get("/api/forum-venues", async (req) => {
    const { q } = req.query as { q?: string };
    const list = await forumVenues.list();
    return { ...list, venues: searchForumVenues(list.venues, typeof q === "string" ? q : undefined) };
  });

  app.get("/api/venues/:id", async (req) => {
    const { id } = req.params as { id: string };
    // #190: a template linked to a forum track has the forum's surface; forumTrack is what the forum said (null: not linked)
    const stored = getVenueDoc(db, id);
    const [{ doc, forumTrack }, edit] = await Promise.all([withForumSurface(stored, forumVenues), canEditVenue(req.user, stored.info.venue, forumVenues)]);
    return { venue: venueSummary(getVenueRow(db, id)), doc, forumTrack, can: { edit } };
  });

  app.get("/api/venues/:id/revisions", async (req) => ({ revisions: listVenueRevisions(db, getVenueRow(db, (req.params as { id: string }).id)) }));

  // /api/venues/:id/r/3.rcvenue.json (download) or /r/3 (plain JSON)
  app.get("/api/venues/:id/r/:file", async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const m = /^(\d{1,9})(\.rcvenue\.json)?$/.exec(file);
    if (!m) throw notFound("Venue revision");
    const { doc } = await withForumSurface(getVenueDoc(db, id, Number(m[1])), forumVenues);
    if (m[2]) reply.header("content-disposition", `attachment; filename="${rcvenueFileName(doc.info.name, doc.revision)}"`);
    return reply.type("application/json; charset=utf-8").send(JSON.stringify(doc, null, 1));
  });

  // a forum link that's new or changed: its track must be one of that forum venue's tracks (a link saved earlier stays,
  // even if the forum has since dropped the track)
  const checkForumLink = async (body: unknown, before?: { id?: unknown; trackId?: unknown }) => {
    const info = venueFromBody(body).info;
    const link = typeof info === "object" && info !== null ? (info as { venue?: unknown }).venue : undefined;
    if (typeof link !== "object" || link === null) return;
    const { id, trackId } = link as { id?: unknown; trackId?: unknown };
    if (trackId === undefined || (before && before.id === id && before.trackId === trackId)) return;
    await assertTrackAtVenue(forumVenues, { id, trackId });
  };

  // the forum venue a body links to, for the permission check (a malformed body is refused later, by the schema)
  const linkOf = (body: unknown) => {
    const info = isObject(body) ? (isObject(body.venue) ? body.venue : body).info : undefined;
    const link = isObject(info) ? info.venue : undefined;
    return isObject(link) ? (link as { id: number; name?: string }) : null;
  };

  // a save's answer, with the template as GET serves it (#190: a linked one with the forum's surface)
  const served = async <T extends { doc: RcVenue }>(saved: T) => {
    const { doc, forumTrack } = await withForumSurface(saved.doc, forumVenues);
    return { ...saved, doc, forumTrack };
  };

  // organisers, or (#173) the committee of the club that runs the forum venue, before and after the edit
  app.post("/api/venues", async (req, reply) => {
    const user = requireUser(req);
    await assertMayEditVenue(user, [linkOf(req.body)], forumVenues);
    await checkForumLink(req.body);
    dropLinkedSurface(venueFromBody(req.body));
    return reply.code(201).send(await served(createVenue(db, user, req.body)));
  });

  app.put("/api/venues/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const before = getVenueDoc(db, id).info.venue;
    await assertMayEditVenue(user, [before, linkOf(req.body)], forumVenues);
    await checkForumLink(req.body, before ?? undefined);
    dropLinkedSurface(venueFromBody(req.body));
    return served(updateVenue(db, user, id, req.body));
  });
}
