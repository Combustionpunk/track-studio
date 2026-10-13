// PNG previews (engine SVG -> resvg) cached in DATA_DIR, and the /t/:id page with Open Graph tags.
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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function describeTrack(db: DB, row: TrackRow): string {
  const venue = row.venue_template_id
    ? (db.prepare("SELECT name FROM venues WHERE id = ?").pluck().get(row.venue_template_id) as string | undefined)
    : undefined;
  return [`${Math.round(row.lap_length)} m lap`, `${row.corners} corners`, venue ?? "no venue", row.status].join(" · ");
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

  // Phase 3 replaces the body with the web app; the head (Open Graph tags) stays.
  app.get("/t/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getTrackRow(db, id);
    const doc = getTrackDoc(db, row);
    const pageUrl = `${config.baseUrl}/t/${row.id}`;
    const image = `${config.baseUrl}/p/${row.id}/${row.current_revision}.png`;
    const title = row.name;
    const description = describeTrack(db, row);
    const height = previewHeight(doc.area);
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Track Studio</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RC Misfits Track Studio">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="${PREVIEW_WIDTH}">
<meta property="og:image:height" content="${height}">
<meta property="og:image:alt" content="${esc(`Plan of ${title}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(pageUrl)}">
<style>body{margin:0;background:#1e2a22;color:#eee;font:16px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:0 auto;padding:16px}img{width:100%;height:auto;display:block}a{color:#ff9fd4}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p>${esc(description)} · by ${esc(row.author_username)} · revision ${row.current_revision}</p>
<img src="${esc(image)}" width="${PREVIEW_WIDTH}" height="${height}" alt="${esc(`Plan of ${title}`)}">
<p><a href="/api/tracks/${esc(row.id)}/r/${row.current_revision}.rctrack.json">Download .rctrack.json</a></p>
</main>
</body>
</html>`;
    return reply.type("text/html; charset=utf-8").send(html);
  });
}
