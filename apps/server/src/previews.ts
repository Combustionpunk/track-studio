// PNG previews (the engine's plan renderer -> resvg) cached in DATA_DIR: the plan picture, fit thumbnails and the
// link-preview card. URLs carry ?v=<hash of the drawing>, so they can be cached for a year and still refresh as soon
// as a drawing changes. The pages that show them are in web.ts.
import { Resvg } from "@resvg/resvg-js";
import { fittedScene, ORIENTS, planHeight, planSvg, type RcTrack } from "@track-studio/engine";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { cardSvg } from "./card.js";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { drawPreview, PREVIEW_PIXEL_RATIO, PREVIEW_WIDTH } from "./drawing.js";
import { notFound } from "./errors.js";
import { fontsKey, previewFontFiles } from "./fonts.js";
import { fitTrack, getTrackDoc, getTrackRow, getVenueDoc, type TrackRow } from "./store.js";
import type { ThemeSync } from "./theme.js";

export { PREVIEW_WIDTH } from "./drawing.js";
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300";

/** Same proportions as the plan picture: area plus a 2.5 m margin on every side. */
export const previewHeight = (area: { length: number; width: number }) => planHeight(area, PREVIEW_WIDTH);

/** SVG -> PNG at the SVG's own size, with Inter and Oswald (and DejaVu Sans as the fallback). */
export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    font: { fontFiles: previewFontFiles(), loadSystemFonts: false, defaultFontFamily: "DejaVu Sans", sansSerifFamily: "DejaVu Sans" },
  });
  return resvg.render().asPng();
}

const hash12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/** The link-preview card of a revision, as SVG, with its URL (?v= is a hash of the card itself). */
export function trackCard(db: DB, theme: ThemeSync, row: TrackRow, revision: number): { svg: string; url: string } {
  const doc = getTrackDoc(db, row, revision);
  const svg = cardSvg(doc, doc.info.status ?? "draft", theme.current().colors);
  return { svg, url: `/p/${row.id}/${revision}/card.png?v=${hash12(`${svg}\n${fontsKey()}`)}` };
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

export function registerPreviews(app: FastifyInstance, config: Config, db: DB, theme: ThemeSync): void {
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
    return sendPng(reply, join(cacheDir, id, `${revision}-${hash}.png`), hash, (req.query as { v?: string }).v, () => drawPreview(getTrackDoc(db, row, revision)));
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
      return planSvg(fittedScene(track, getVenueDoc(db, venueId, answer.venue.revision), fit), { width: PREVIEW_WIDTH, pixelRatio: PREVIEW_PIXEL_RATIO });
    });
  });

  // /p/:id/:rev/card.png?v=<hash of the card> — the Open Graph image: 1200 × 630, name, status, figures and plan
  app.get("/p/:id/:rev/card.png", async (req, reply) => {
    const { id, rev } = req.params as { id: string; rev: string };
    if (!/^\d{1,9}$/.test(rev) || !/^[\w-]{1,64}$/.test(id)) throw notFound("Preview");
    const row = getTrackRow(db, id);
    const revision = Number(rev);
    revisionHash(row, revision); // 404 for a revision that doesn't exist
    const card = trackCard(db, theme, row, revision);
    const version = card.url.split("?v=")[1];
    const file = join(cacheDir, id, `card-${revision}-${version}.png`);
    const fresh = !existsSync(file);
    const res = sendPng(reply, file, version, (req.query as { v?: string }).v, () => card.svg);
    // a new card (status, name or theme changed): drop this revision's older ones
    if (fresh) for (const f of readdirSync(dirname(file))) if (f.startsWith(`card-${revision}-`) && f !== `card-${revision}-${version}.png`) rmSync(join(dirname(file), f), { force: true });
    return res;
  });
}
