// Builds the Fastify app (used by main.ts and the tests).
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { registerAuth } from "./auth.js";
import type { Config } from "./config.js";
import { openDb, type DB } from "./db.js";
import { HttpError } from "./errors.js";
import { registerPreviews } from "./previews.js";
import { registerRoutes } from "./routes.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DB;
    config: Config;
  }
}

export interface BuildOptions {
  logger?: FastifyServerOptions["logger"];
  db?: DB;
}

/** Log the path only: query strings can carry login payloads (/auth/callback?sso=…). */
const reqSerializer = (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: req.url.split("?")[0], ip: req.ip });

export async function buildApp(config: Config, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === undefined ? false : opts.logger,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    ...(opts.logger ? { serializers: { req: reqSerializer } } : {}),
  });
  const db = opts.db ?? openDb(config.dataDir);
  app.decorate("db", db);
  app.decorate("config", config);
  app.addHook("onClose", async () => {
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
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: "not-found", message: `No route for ${req.method} ${req.url.split("?")[0]}` }));

  registerAuth(app, config, db);
  registerRoutes(app, db);
  registerPreviews(app, config, db);
  app.get("/healthz", async () => ({ ok: true }));
  return app;
}
