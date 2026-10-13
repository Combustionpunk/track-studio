// PNG previews (engine SVG -> resvg) cached in DATA_DIR. URLs carry ?v=<hash of the drawing>, so they can be cached
// for a year and still refresh as soon as a track's drawing changes. The pages that show them are in web.ts.
import { Resvg } from "@resvg/resvg-js";
import { fittedPreviewDoc, ORIENTS, previewSvg, type RcTrack } from "@track-studio/engine";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { notFound } from "./errors.js";
import { fitTrack, getTrackDoc, getTrackRow, getVenueDoc, type TrackRow } from "./store.js";

export const PREVIEW_WIDTH = 1200;
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300";

/** Same proportions as the engine's SVG: area plus a 2.5 m margin on every side. */
export function previewHeight(area: { length: number; width: number }): number {
  return Math.round((PREVIEW_WIDTH * (area.width + 5)) / (area.length + 5));
}

// Bundled font, so previews look the same on every host (slim containers have no fonts at all)
const FONT_FILE = join(dirname(createRequire(import.meta.url).resolve("dejavu-fonts-ttf/package.json")), "ttf", "DejaVuSans.ttf");

export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: PREVIEW_WIDTH },
    font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans", sansSerifFamily: "DejaVu Sans" },
  });
  return resvg.render().asPng();
}

/** "94 m lap · 9 corners · 22 × 12 m · Sports hall B · approved" — of the public revision. */
export function describeTrack(row: TrackRow): string {
  const size = row.d_size_l !== null && row.d_size_w !== null ? `${Math.round(row.d_size_l)} × ${Math.round(row.d_size_w)} m` : null;
  const status = row.approved_revision !== null && row.status !== "archived" ? "approved" : row.status;
  return [`${Math.round(row.d_lap)} m lap`, `${row.d_corners} corners`, size, row.venue_name ?? "no venue", status].filter(Boolean).join(" · ");
}

/** Serve a cached PNG (rendering it on first use). Exact version → cache for a year; anything else → briefly. */
function sendPng(reply: FastifyReply, file: string, version: string, requested: unknown, render: () => string): FastifyReply {
  let png: Buffer;
  if (existsSync(file)) {
    png = readFileSync(file);
    reply.header("x-preview-cache", "hit");
  } else {
    png = renderPng(render());
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, png);
    renameSync(tmp, file); // atomic: concurrent renders of the same picture are harmless
    reply.header("x-preview-cache", "miss");
  }
  reply.header("etag", `"${version}"`);
  return reply.type("image/png").header("cache-control", requested === version ? IMMUTABLE : SHORT).send(png);
}

/** Drop cached pictures of a track that no current revision hash refers to (after a re-bake). */
export function sweepPreviews(db: DB, dataDir: string, trackId: string): number {
  const dir = join(dataDir, "previews", trackId);
  if (!existsSync(dir)) return 0;
  const hashes = new Set(db.prepare("SELECT preview_hash FROM track_revisions WHERE track_id = ?").pluck().all(trackId) as string[]);
  let removed = 0;
  for (const f of readdirSync(dir)) {
    const m = /-([0-9a-f]{12})(?:\.\d+)?\.png$/.exec(f);
    if (!m || !hashes.has(m[1])) {
      rmSync(join(dir, f), { force: true });
      removed++;
    }
  }
  return removed;
}

export function registerPreviews(app: FastifyInstance, config: Config, db: DB): void {
  const cacheDir = join(config.dataDir, "previews");
  const revisionHash = (row: TrackRow, revision: number) => {
    const h = db.prepare("SELECT preview_hash FROM track_revisions WHERE track_id = ? AND revision = ?").pluck().get(row.id, revision) as string | undefined;
    if (!h) throw notFound("Preview");
    return h;
  };

  // /p/:id/:rev.png?v=<hash>
  app.get("/p/:id/:file", async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const m = /^(\d{1,9})\.png$/.exec(file);
    if (!m || !/^[\w-]{1,64}$/.test(id)) throw notFound("Preview");
    const revision = Number(m[1]);
    const row = getTrackRow(db, id);
    const hash = revisionHash(row, revision);
    return sendPng(reply, join(cacheDir, id, `${revision}-${hash}.png`), hash, (req.query as { v?: string }).v, () => previewSvg(getTrackDoc(db, row, revision)));
  });

  // /p/:id/:rev/fit/:venueId/:k.png?v=<hash>.<venue revision> — the track placed as it fits the venue
  app.get("/p/:id/:rev/fit/:venueId/:file", async (req, reply) => {
    const { id, rev, venueId, file } = req.params as { id: string; rev: string; venueId: string; file: string };
    const m = /^(\d)\.png$/.exec(file);
    if (!m || !/^\d{1,9}$/.test(rev) || !/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(venueId)) throw notFound("Preview");
    const k = Number(m[1]);
    const row = getTrackRow(db, id);
    const revision = Number(rev);
    const hash = revisionHash(row, revision);
    const answer = fitTrack(db, row, venueId, revision);
    const fit = answer.results.find((r) => r.orientation === ORIENTS[k]?.[0]);
    if (!fit) throw notFound("Fit");
    const version = `${hash}.${answer.venue.revision}`;
    const out = join(cacheDir, id, `fit-${revision}-${venueId}-${answer.venue.revision}-${k}-${hash}.png`);
    return sendPng(reply, out, version, (req.query as { v?: string }).v, () => {
      const track: RcTrack = getTrackDoc(db, row, revision);
      return previewSvg(fittedPreviewDoc(track, getVenueDoc(db, venueId, answer.venue.revision), fit));
    });
  });
}
