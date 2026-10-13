// Serves the web app (apps/web): Vite middleware in dev, the built files in production, or a plain fallback page.
// Every HTML page gets its <head> filled in here (title, Open Graph tags) so forum link previews keep working, plus
// a frame policy: only /embed/* may be framed, and only by the forum.
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { HttpError } from "./errors.js";
import { describeTrack, PREVIEW_WIDTH, previewHeight } from "./previews.js";
import { getTrackDoc, getTrackRow, getVenueDoc, getVenueRow, type TrackRow } from "./store.js";

export type WebMode = "dev" | "static" | "off";

export interface WebOptions {
  mode: WebMode;
  /** apps/web (dev: index.html + vite.config.ts) */
  root: string;
  /** apps/web/dist (static) */
  dist: string;
}

const HEAD = "<!--app-head-->";
const BODY = "<!--app-body-->";

/** Used when the web app isn't built (tests, server-only runs): same head, a minimal static body. */
export const FALLBACK_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Track Studio</title>
${HEAD}
<style>body{margin:0;background:#1e2a22;color:#eee;font:16px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:0 auto;padding:16px}img{width:100%;height:auto;display:block}a{color:#ff9fd4}</style>
</head>
<body>
<main>${BODY}</main>
</body>
</html>`;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface Page {
  title: string;
  head: string;
  body: string;
  status: number;
  embed?: boolean;
}

function trackPage(db: DB, config: Config, row: TrackRow, path: string, revision?: number): Page {
  const rev = revision ?? row.current_revision;
  const doc = getTrackDoc(db, row, rev);
  const pageUrl = `${config.baseUrl}/t/${row.id}`;
  const image = `${config.baseUrl}/p/${row.id}/${rev}.png`;
  const title = row.name;
  const description = describeTrack(db, row);
  const height = previewHeight(doc.area);
  const alt = `Plan of ${title}`;
  const head = [
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="RC Misfits Track Studio">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(pageUrl)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:width" content="${PREVIEW_WIDTH}">`,
    `<meta property="og:image:height" content="${height}">`,
    `<meta property="og:image:alt" content="${esc(alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<link rel="canonical" href="${esc(pageUrl)}">`,
  ].join("\n");
  // shown until the app starts (and to anything that doesn't run scripts)
  const body = `<h1>${esc(title)}</h1>
<p>${esc(description)} · by ${esc(row.author_username)} · revision ${rev}</p>
<img src="${esc(image)}" width="${PREVIEW_WIDTH}" height="${height}" alt="${esc(alt)}">
<p><a href="/api/tracks/${esc(row.id)}/r/${rev}.rctrack.json">Download .rctrack.json</a></p>`;
  return { title: `${title} · Track Studio`, head, body, status: 200, embed: path.startsWith("/embed/") };
}

function venuePage(db: DB, config: Config, id: string): Page {
  const row = getVenueRow(db, id);
  const doc = getVenueDoc(db, id);
  const description = `${doc.area.length} × ${doc.area.width} m track area · rostrum ${doc.rostrum?.side ?? "south"} · ${doc.obstacles?.length ?? 0} obstacles`;
  const head = [
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="RC Misfits Track Studio">`,
    `<meta property="og:title" content="${esc(row.name)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(`${config.baseUrl}/v/${row.id}`)}">`,
  ].join("\n");
  return { title: `${row.name} · Track Studio`, head, body: `<h1>${esc(row.name)}</h1><p>${esc(description)}</p>`, status: 200 };
}

const plain = (title: string, status = 200): Page => ({ title, head: "", body: "", status });

/** Which page a path is, with its head. Unknown ids give the app's page with a 404 status. */
function pageFor(db: DB, config: Config, path: string, query: Record<string, string | undefined>): Page {
  const notFound = (): Page => ({ ...plain("Not found · Track Studio", 404), body: "<h1>Not found</h1>" });
  try {
    let m: RegExpExecArray | null;
    if (path === "/" ) return plain("Track Studio");
    if (path === "/v" || path === "/v/") return plain("Venues · Track Studio");
    if ((m = /^\/(t|embed)\/([\w-]{1,64})\/?$/.exec(path))) {
      const rev = query.r && /^\d{1,9}$/.test(query.r) ? Number(query.r) : undefined;
      return trackPage(db, config, getTrackRow(db, m[2]), path, rev);
    }
    if ((m = /^\/v\/([\w-]{1,64})\/?$/.exec(path))) return venuePage(db, config, m[1]);
    return notFound();
  } catch (e) {
    if (e instanceof HttpError && e.statusCode === 404) return { ...notFound(), embed: path.startsWith("/embed/") };
    throw e;
  }
}

export function fillTemplate(template: string, page: Page): string {
  let html = template;
  if (page.title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`);
  return html.replace(HEAD, page.head).replace(BODY, page.body);
}

/** Frame policy (and, for the built app, a content security policy). */
export function pageHeaders(reply: FastifyReply, config: Config, opts: { embed: boolean; strict: boolean }) {
  const forum = new URL(config.forumUrl).origin;
  const ancestors = opts.embed ? `frame-ancestors 'self' ${forum}` : "frame-ancestors 'self'";
  const csp = opts.strict
    ? [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https: http:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        ancestors,
      ].join("; ")
    : ancestors;
  reply.header("content-security-policy", csp);
  if (!opts.embed) reply.header("x-frame-options", "SAMEORIGIN");
  reply.header("x-content-type-options", "nosniff");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
}

export function webOptions(config: Config, rootDir: string, env: NodeJS.ProcessEnv = process.env): WebOptions {
  const root = join(rootDir, "apps", "web");
  const dist = join(root, "dist");
  if (env.WEB_DEV === "1" && !config.production) return { mode: "dev", root, dist };
  return { mode: existsSync(join(dist, "index.html")) ? "static" : "off", root, dist };
}

export async function registerWeb(app: FastifyInstance, config: Config, db: DB, web: WebOptions): Promise<void> {
  let template: (url: string) => Promise<string>;

  if (web.mode === "dev") {
    // Vite in middleware mode on the same server: one origin for the app, the API and the login callback.
    const middie = (await import("@fastify/middie")).default;
    const vite = await import("vite");
    await app.register(middie);
    const server = await vite.createServer({
      root: web.root,
      configFile: join(web.root, "vite.config.ts"),
      appType: "custom",
      server: { middlewareMode: true, hmr: { server: app.server } },
    });
    app.use(server.middlewares);
    app.addHook("onClose", async () => server.close());
    template = async (url) => server.transformIndexHtml(url, readFileSync(join(web.root, "index.html"), "utf8"));
  } else if (web.mode === "static") {
    // re-read when a new build replaces it, so a running server never points at deleted asset files
    const file = join(web.dist, "index.html");
    let cached = { mtime: 0, html: "" };
    template = async () => {
      const mtime = statSync(file).mtimeMs;
      if (mtime !== cached.mtime) cached = { mtime, html: readFileSync(file, "utf8") };
      return cached.html;
    };
    await app.register(fastifyStatic, {
      root: web.dist,
      prefix: "/",
      index: false,
      wildcard: true, // serve whatever the current build contains (a rebuild needs no restart)
      setHeaders: (reply, path) => {
        // hashed file names never change
        reply.header("cache-control", path.startsWith(join(web.dist, "assets")) ? "public, max-age=31536000, immutable" : "public, max-age=3600");
      },
    });
  } else {
    template = async () => FALLBACK_TEMPLATE;
  }

  const serve = async (req: FastifyRequest, reply: FastifyReply) => {
    const [path, qs] = req.url.split("?");
    const query = Object.fromEntries(new URLSearchParams(qs ?? "")) as Record<string, string | undefined>;
    const page = pageFor(db, config, path, query);
    pageHeaders(reply, config, { embed: !!page.embed, strict: web.mode === "static" });
    reply.header("cache-control", "no-cache");
    return reply.code(page.status).type("text/html; charset=utf-8").send(fillTemplate(await template(req.url), page));
  };
  for (const route of ["/", "/t/:id", "/embed/:id", "/v", "/v/:id"]) app.get(route, serve);
  app.decorate("servePage", serve);
}

declare module "fastify" {
  interface FastifyInstance {
    servePage?: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
