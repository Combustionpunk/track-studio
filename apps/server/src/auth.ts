// Login with the forum as identity provider (DiscourseConnect provider), signed session cookie, dev login.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { badRequest, forbidden, HttpError, notFound, unauthorized } from "./errors.js";

export const SESSION_COOKIE = "ts_session";
export const SESSION_DAYS = 30;
export const NONCE_TTL_MS = 10 * 60 * 1000;

export interface User {
  id: number; // forum user id (0 = system, < 0 = dev login)
  username: string;
  name: string | null;
  avatarUrl: string | null;
  groups: string[];
  admin: boolean;
  moderator: boolean;
  organiser: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

// ------------------------------------------------------------------ DiscourseConnect payloads
export const signPayload = (payload: string, secret: string): string => createHmac("sha256", secret).update(payload).digest("hex");

export function verifySignature(payload: string, sig: string, secret: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = Buffer.from(signPayload(payload, secret), "hex");
  return timingSafeEqual(expected, Buffer.from(sig, "hex"));
}

export const encodePayload = (params: Record<string, string>): string => Buffer.from(new URLSearchParams(params).toString(), "utf8").toString("base64");

export const decodePayload = (sso: string): URLSearchParams => new URLSearchParams(Buffer.from(sso, "base64").toString("utf8"));

/** Only same-site absolute paths; anything else (//evil, http://…, junk) becomes "/". */
export function safeReturnPath(p: unknown): string {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || p.length > 500) return "/";
  return /[\u0000-\u001f]/.test(p) ? "/" : p;
}

// ------------------------------------------------------------------ users
interface UserRow {
  forum_id: number;
  username: string;
  name: string | null;
  avatar_url: string | null;
  groups: string;
  admin: number;
  moderator: number;
}

export function rowToUser(r: UserRow, organiserGroup: string): User {
  const groups = JSON.parse(r.groups) as string[];
  const admin = r.admin === 1;
  return {
    id: r.forum_id,
    username: r.username,
    name: r.name,
    avatarUrl: r.avatar_url,
    groups,
    admin,
    moderator: r.moderator === 1,
    organiser: admin || groups.includes(organiserGroup),
  };
}

export interface UpsertUser {
  id: number;
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
  groups?: string[];
  admin?: boolean;
  moderator?: boolean;
}

export function upsertUser(db: DB, u: UpsertUser): void {
  db.prepare(
    `INSERT INTO users (forum_id, username, name, avatar_url, groups, admin, moderator, last_seen)
     VALUES (@id, @username, @name, @avatarUrl, @groups, @admin, @moderator, @now)
     ON CONFLICT(forum_id) DO UPDATE SET username = excluded.username, name = excluded.name, avatar_url = excluded.avatar_url,
       groups = excluded.groups, admin = excluded.admin, moderator = excluded.moderator, last_seen = excluded.last_seen`,
  ).run({
    id: u.id,
    username: u.username,
    name: u.name ?? null,
    avatarUrl: u.avatarUrl ?? null,
    groups: JSON.stringify(u.groups ?? []),
    admin: u.admin ? 1 : 0,
    moderator: u.moderator ? 1 : 0,
    now: new Date().toISOString(),
  });
}

export function getUser(db: DB, id: number, organiserGroup: string): User | null {
  const r = db.prepare("SELECT * FROM users WHERE forum_id = ?").get(id) as UserRow | undefined;
  return r ? rowToUser(r, organiserGroup) : null;
}

export function publicUser(u: User) {
  return { id: u.id, username: u.username, name: u.name, avatarUrl: u.avatarUrl, organiser: u.organiser, admin: u.admin, moderator: u.moderator };
}

// ------------------------------------------------------------------ guards
export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireOrganiser(req: FastifyRequest): User {
  const u = requireUser(req);
  if (!u.organiser) throw forbidden("Only organisers can do that");
  return u;
}

// ------------------------------------------------------------------ plugin
export function registerAuth(app: FastifyInstance, config: Config, db: DB): void {
  const secure = config.baseUrl.startsWith("https:");

  function startSession(reply: FastifyReply, userId: number) {
    const exp = Date.now() + SESSION_DAYS * 86400_000;
    reply.setCookie(SESSION_COOKIE, `${userId}.${exp}`, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    });
  }

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const un = req.unsignCookie(raw);
    if (!un.valid || !un.value) return;
    const m = /^(-?\d+)\.(\d+)$/.exec(un.value);
    if (!m || Number(m[2]) < Date.now()) return;
    req.user = getUser(db, Number(m[1]), config.organiserGroup);
  });

  // Same-site POSTs from other origins (e.g. a page on the forum's site) would carry the Lax cookie; refuse them.
  const ownOrigin = new URL(config.baseUrl).origin;
  app.addHook("onRequest", async (req) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== ownOrigin) throw forbidden("Cross-origin request refused");
  });

  app.get("/auth/login", async (req, reply) => {
    if (!config.discourseConnectSecret) throw new HttpError(503, "forum-login-disabled", "Forum login is not configured (DISCOURSE_CONNECT_SECRET)");
    const { return: ret } = req.query as { return?: string };
    const nonce = randomBytes(16).toString("hex");
    const now = Date.now();
    db.prepare("DELETE FROM auth_nonces WHERE expires_at < ?").run(now);
    db.prepare("INSERT INTO auth_nonces (nonce, return_path, expires_at) VALUES (?, ?, ?)").run(nonce, safeReturnPath(ret), now + NONCE_TTL_MS);
    const sso = encodePayload({ nonce, return_sso_url: `${config.baseUrl}/auth/callback` });
    const sig = signPayload(sso, config.discourseConnectSecret);
    return reply.redirect(`${config.forumUrl}/session/sso_provider?sso=${encodeURIComponent(sso)}&sig=${sig}`);
  });

  app.get("/auth/callback", async (req, reply) => {
    if (!config.discourseConnectSecret) throw new HttpError(503, "forum-login-disabled", "Forum login is not configured (DISCOURSE_CONNECT_SECRET)");
    const { sso, sig } = req.query as { sso?: string; sig?: string };
    if (typeof sso !== "string" || typeof sig !== "string" || !sso || !sig) throw badRequest("bad-login", "Missing sso or sig");
    if (!verifySignature(sso, sig, config.discourseConnectSecret)) throw forbidden("Login response signature is invalid");
    const p = decodePayload(sso);
    const nonce = p.get("nonce") ?? "";
    // consume the nonce whatever happens next: each login response is usable once
    const row = db
      .prepare("DELETE FROM auth_nonces WHERE nonce = ? RETURNING return_path, expires_at")
      .get(nonce) as { return_path: string; expires_at: number } | undefined;
    if (!row) throw badRequest("bad-login", "Login request unknown or already used — please log in again");
    if (row.expires_at < Date.now()) throw badRequest("bad-login", "Login request expired — please log in again");
    const id = Number(p.get("external_id"));
    const username = p.get("username");
    if (!Number.isInteger(id) || id <= 0 || !username) throw badRequest("bad-login", "Login response has no user");
    upsertUser(db, {
      id,
      username,
      name: p.get("name") || null,
      avatarUrl: p.get("avatar_url") || null,
      groups: (p.get("groups") ?? "").split(",").map((g) => g.trim()).filter(Boolean),
      admin: p.get("admin") === "true",
      moderator: p.get("moderator") === "true",
    });
    startSession(reply, id);
    return reply.redirect(row.return_path);
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    // literally `null` when logged out
    return reply.type("application/json").send(JSON.stringify(req.user ? publicUser(req.user) : null));
  });

  if (config.devLogin) {
    app.get("/auth/dev-login", async (req, reply) => {
      const q = req.query as { user?: string; organiser?: string; admin?: string; return?: string };
      const username = q.user?.trim();
      if (!username || !/^[\w.-]{1,40}$/.test(username)) throw badRequest("bad-request", "?user=<name> (letters, digits, _ . -)");
      const existing = db.prepare("SELECT forum_id FROM users WHERE forum_id < 0 AND username = ?").pluck().get(username) as number | undefined;
      const id = existing ?? Math.min(-1, ((db.prepare("SELECT MIN(forum_id) FROM users").pluck().get() as number | null) ?? 0) - 1);
      upsertUser(db, { id, username, name: username, groups: q.organiser === "1" ? [config.organiserGroup] : [], admin: q.admin === "1" });
      startSession(reply, id);
      return reply.redirect(safeReturnPath(q.return));
    });
  } else {
    app.get("/auth/dev-login", async () => {
      throw notFound("Route");
    });
  }
}
