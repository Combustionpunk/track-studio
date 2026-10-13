// PNG previews (engine SVG -> resvg) cached in DATA_DIR. The pages that show them are in web.ts.
import { Resvg } from "@resvg/resvg-js";
import { previewSvg } from "@track-studio/engine";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { notFound } from "./errors.js";
import { getTrackDoc, getTrackRow, type TrackRow } from "./store.js";

export const PREVIEW_WIDTH = 1200;
const IMMUTABLE = "public, max-age=31536000, immutable";

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

export function describeTrack(db: DB, row: TrackRow): string {
  const venue = row.venue_template_id
    ? (db.prepare("SELECT name FROM venues WHERE id = ?").pluck().get(row.venue_template_id) as string | undefined)
    : undefined;
  const size = row.size_length !== null && row.size_width !== null ? `${Math.round(row.size_length)} × ${Math.round(row.size_width)} m` : null;
  return [`${Math.round(row.lap_length)} m lap`, `${row.corners} corners`, size, venue ?? "no venue", row.status].filter(Boolean).join(" · ");
}

export function registerPreviews(app: FastifyInstance, config: Config, db: DB): void {
  const cacheDir = join(config.dataDir, "previews");

  app.get("/p/:id/:file", async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const m = /^(\d{1,9})\.png$/.exec(file);
    if (!m || !/^[\w-]{1,64}$/.test(id)) throw notFound("Preview");
    const revision = Number(m[1]);
    const row = getTrackRow(db, id);
    const rel = join("previews", id, `${revision}.png`);
    const abs = join(config.dataDir, rel);
    let png: Buffer;
    if (existsSync(abs)) {
      png = readFileSync(abs);
      reply.header("x-preview-cache", "hit");
    } else {
      png = renderPng(previewSvg(getTrackDoc(db, row, revision)));
      mkdirSync(join(cacheDir, id), { recursive: true });
      const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, png);
      renameSync(tmp, abs); // atomic: concurrent renders of the same revision are harmless
      db.prepare("UPDATE track_revisions SET png_path = ? WHERE track_id = ? AND revision = ?").run(rel, id, revision);
      reply.header("x-preview-cache", "miss");
    }
    return reply.type("image/png").header("cache-control", IMMUTABLE).send(png);
  });
}
