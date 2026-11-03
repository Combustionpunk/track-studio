// Builds the Fastify app (used by main.ts and the tests).
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { join } from "node:path";
import { registerAuth, requireOrganiser } from "./auth.js";
import type { Config } from "./config.js";
import { openDb, type DB } from "./db.js";
import { HttpError } from "./errors.js";
import { previewFontFiles, SERVER_FONTS_DIR } from "./fonts.js";
import { registerPreviews } from "./previews.js";
import { registerRoutes } from "./routes.js";
import { backfillRevisions, refreshPreviewHashes } from "./store.js";
import { ThemeSync, themeCss } from "./theme.js";
import { registerWeb, type WebOptions } from "./web.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DB;
    config: Config;
    theme: ThemeSync;
  }
}

export interface BuildOptions {
  logger?: FastifyServerOptions["logger"];
  db?: DB;
  /** how to serve the web app; default "off" (fallback pages, no web build needed) */
  web?: WebOptions;
  /** how the forum's colour scheme is fetched (tests stub it); sync starts with `app.theme.start()` */
  themeFetch?: typeof fetch;
}

/** Log the path only: query strings can carry login payloads (/auth/callback?sso=…). */
export const reqSerializer = (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: req.url.split("?")[0], ip: req.ip });

export async function buildApp(config: Config, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { ...(opts.logger === true ? {} : opts.logger), serializers: { req: reqSerializer } } : false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  const db = opts.db ?? openDb(config.dataDir);
  app.decorate("db", db);
  app.decorate("config", config);
  const theme = new ThemeSync({ forumUrl: config.forumUrl, fetch: opts.themeFetch, log: app.log, cacheFile: join(config.dataDir, "theme-cache.json") });
  app.decorate("theme", theme);
  // Inter and Oswald for the PNG previews (DejaVu Sans if they're missing)
  if (previewFontFiles().length === 1) app.log.warn({ dir: SERVER_FONTS_DIR }, "preview fonts missing; using DejaVu Sans");
  backfillRevisions(db); // summary columns for revisions saved before migration 003
  const refreshed = refreshPreviewHashes(db); // the drawing or fonts changed: new picture URLs
  if (refreshed) app.log.info({ revisions: refreshed }, "preview hashes refreshed");
  app.addHook("onClose", async () => {
    theme.stop();
    if (!opts.db) db.close();
  });

  await app.register(cookie, { secret: config.sessionSecret });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    const e = err as { statusCode?: number; code?: string; message: string; validation?: unknown };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
    if (status === 500) req.log.error(err);
    const code = status === 500 ? "internal" : status === 413 ? "too-large" : status === 415 ? "unsupported-media-type" : "bad-request";
    return reply.code(status).send({ error: code, message: status === 500 ? "Something went wrong" : e.message });
  });
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    // browsers get the app's own 404 page; API clients get JSON
    const api = /^\/(api|auth|p)(\/|$)/.test(path);
    if (!api && req.method === "GET" && (req.headers.accept ?? "").includes("text/html") && app.servePage) return app.servePage(req, reply);
    return reply.code(404).send({ error: "not-found", message: `No route for ${req.method} ${path}` });
  });

  registerAuth(app, config, db);
  registerRoutes(app, db);
  registerPreviews(app, config, db, theme);
  await registerWeb(app, config, db, opts.web ?? { mode: "off", root: "", dist: "" });
  // compose's health check: the process is up and the database answers
  app.get("/healthz", async (_req, reply) => {
    try {
      db.prepare("SELECT count(*) FROM schema_migrations").get(); // reads a page of the file
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, error: "database" });
    }
  });
  // what the web app needs to know about this server
  app.get("/api/config", async () => ({ devLogin: config.devLogin, forumUrl: config.forumUrl, baseUrl: config.baseUrl, organiserGroup: config.organiserGroup }));
  // the forum's colours as design tokens, for the sim and other tools
  app.get("/api/theme.json", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*").header("cache-control", "public, max-age=300");
    return theme.current();
  });
  app.post("/api/theme/refresh", async (req) => {
    requireOrganiser(req);
    const res = await theme.refresh();
    return { ...res, css: themeCss(res.theme) };
  });
  return app;
}
