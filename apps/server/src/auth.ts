// Login with the forum as identity provider (DiscourseConnect provider), signed session cookie, dev login.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { badRequest, forbidden, HttpError, notFound, unauthorized } from "./errors.js";
import type { ForumReachable } from "./forum-reachable.js";

export const SESSION_COOKIE = "ts_session";
export const SESSION_DAYS = 30;
export const NONCE_TTL_MS = 10 * 60 * 1000;
/** How long an expired or used nonce row is kept, so a late or repeated answer to a silent check is still known as one. */
export const NONCE_KEEP_MS = 60 * 60 * 1000;
/** Set when the forum was asked silently (prompt=none) whether the visitor is signed in there; no new check while it lasts. */
export const SSO_CHECKED_COOKIE = "ts_sso_checked";
export const SSO_CHECK_MINUTES = 30;
/** The nonces of this browser's logins in flight, so a forum answer only counts in the browser that asked (#132). */
export const NONCE_COOKIE = "ts_sso";
/** Tabs opened at once, each checked silently: this many logins in flight per browser. */
export const MAX_NONCES_PER_BROWSER = 4;
/** On the page address when a browser came back from a silent check without its cookie (it keeps none): not sent round again. */
export const NO_SIGNIN_PARAM = "nosignin";

/** Crawlers and link-preview fetchers: never sent to the forum. */
const BOT_UA = /bot|crawl|spider|slurp|onebox|facebookexternalhit|embedly|preview|lighthouse|headless/i;

/** A browser opening a page itself (not a script, an iframe, a crawler or a prefetch): the only request worth a silent check. */
export function isPageNavigation(req: FastifyRequest): boolean {
  const h = req.headers;
  if (req.method !== "GET" || h["sec-fetch-mode"] !== "navigate" || h["sec-fetch-dest"] !== "document") return false;
  if (h.purpose === "prefetch" || h["sec-purpose"]) return false;
  return !BOT_UA.test(h["user-agent"] ?? "");
}

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
  interface FastifyInstance {
    /** where to send a page request for a silent forum sign-in (#132), or null to serve the page; waits for the forum probe (2 s at most) */
    silentLogin: (req: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
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

/**
 * Only same-site absolute paths; anything else (//evil, http://…, junk) becomes "/". No control characters and no
 * backslash anywhere: browsers drop tabs and newlines from a URL and read `\` as `/`, so `/<tab>/evil` would be another host.
 */
export function safeReturnPath(p: unknown): string {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || p.length > 500) return "/";
  return /[\u0000-\u001f\u007f\\]/.test(p) ? "/" : p;
}

/** The nonces a browser's cookie holds (newest last); anything that isn't a nonce is ignored. */
export const noncesOf = (value: string | undefined): string[] => (value ?? "").split(".").filter((n) => /^[0-9a-f]{32}$/.test(n));

const hasNoSigninMarker = (url: string): boolean => new URLSearchParams(url.split("?")[1] ?? "").has(NO_SIGNIN_PARAM);
const withNoSigninMarker = (path: string): string => `${path}${path.includes("?") ? "&" : "?"}${NO_SIGNIN_PARAM}=1`;

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
export function registerAuth(app: FastifyInstance, config: Config, db: DB, forum: ForumReachable): void {
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

  const checkedCookie = (reply: FastifyReply) =>
    reply.setCookie(SSO_CHECKED_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SSO_CHECK_MINUTES * 60 });

  /** The browser's logins in flight: the cookie the callback must come back with. Cleared when none are left. */
  const nonceCookie = (reply: FastifyReply, held: string[]) =>
    held.length
      ? reply.setCookie(NONCE_COOKIE, held.join("."), { httpOnly: true, sameSite: "lax", secure, path: "/auth", maxAge: NONCE_TTL_MS / 1000 })
      : reply.clearCookie(NONCE_COOKIE, { path: "/auth" });

  const signedForumUrl = (payload: Record<string, string>) => {
    const sso = encodePayload(payload);
    return `${config.forumUrl}/session/sso_provider?sso=${encodeURIComponent(sso)}&sig=${signPayload(sso, config.discourseConnectSecret)}`;
  };

  /**
   * A signed DiscourseConnect login request. The nonce is kept with the page to return to (and whether this is a
   * silent check), and goes into this browser's nonce cookie, so the forum's answer only counts here.
   */
  function startForumLogin(req: FastifyRequest, reply: FastifyReply, returnPath: string, silent: boolean): string {
    const nonce = randomBytes(16).toString("hex");
    const now = Date.now();
    db.prepare("DELETE FROM auth_nonces WHERE expires_at < ?").run(now - NONCE_KEEP_MS);
    db.prepare("INSERT INTO auth_nonces (nonce, return_path, expires_at, silent) VALUES (?, ?, ?, ?)").run(nonce, safeReturnPath(returnPath), now + NONCE_TTL_MS, silent ? 1 : 0);
    nonceCookie(reply, [...noncesOf(req.cookies[NONCE_COOKIE]).filter((n) => n !== nonce), nonce].slice(-MAX_NONCES_PER_BROWSER));
    return signedForumUrl({ nonce, return_sso_url: `${config.baseUrl}/auth/callback`, ...(silent ? { prompt: "none" } : {}) });
  }

  // Signed into the forum means signed in here (#132): the first page a visitor opens is a round trip to the forum
  // with prompt=none. Signed in there: back signed in; not: back as a visitor (failed=true). Either way the cookie
  // stops another check for SSO_CHECK_MINUTES. Signed-in members are checked again once it lapses, so signing out of
  // the forum signs them out here at the next check. Pages call this before rendering; it returns where to redirect, or null.
  // Not while the forum is down (the probe is cached a minute): then the page is served as it is, with no cookie, so the
  // next visit tries again. A visitor never lands on the forum's error page.
  app.decorate("silentLogin", async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    if (!config.discourseConnectSecret || !config.silentSignin || req.cookies[SSO_CHECKED_COOKIE] || !isPageNavigation(req)) return null;
    if (req.user && req.user.id < 0) return null; // dev login: the forum doesn't know them
    if (safeReturnPath(req.url) !== req.url) return null; // too long or odd to come back to: don't lose it
    if (req.url.startsWith("/embed/")) return null;
    if (hasNoSigninMarker(req.url)) return null; // just back from a check with no cookie kept: once is enough
    if (!(await forum.check())) return null;
    checkedCookie(reply);
    return startForumLogin(req, reply, req.url, true);
  });

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
    return reply.header("cache-control", "no-store").redirect(startForumLogin(req, reply, ret ?? "/", false));
  });

  app.get("/auth/callback", async (req, reply) => {
    if (!config.discourseConnectSecret) throw new HttpError(503, "forum-login-disabled", "Forum login is not configured (DISCOURSE_CONNECT_SECRET)");
    const { sso, sig } = req.query as { sso?: string; sig?: string };
    if (typeof sso !== "string" || !sso) throw badRequest("bad-login", "Missing sso or sig");
    // The nonce is read before the signature is checked, only to know whether this was a silent check: a silent check
    // that goes wrong lands back on the page quietly, a visitor, never on an error page. The page is the one stored
    // with the nonce, never anything from the payload. An interactive login keeps its error.
    const nonce = decodePayload(sso).get("nonce") ?? "";
    const row = db.prepare("SELECT return_path, expires_at, silent, used_at FROM auth_nonces WHERE nonce = ?").get(nonce) as
      | { return_path: string; expires_at: number; silent: number; used_at: number | null }
      | undefined;
    const silentReturn = row?.silent ? row.return_path : null;
    const held = noncesOf(req.cookies[NONCE_COOKIE]);
    // a browser that keeps no cookies came back without the check cookie: mark the page so it isn't sent round again
    const quiet = (path: string) => (req.cookies[SSO_CHECKED_COOKIE] ? path : withNoSigninMarker(path));
    const back = (path: string) => reply.header("cache-control", "no-store").redirect(path);
    const refuse = (err: HttpError): FastifyReply => {
      if (silentReturn === null) throw err;
      req.log.warn({ reason: err.message }, "silent sign-in refused; carrying on as a visitor");
      nonceCookie(reply, held.filter((n) => n !== nonce));
      return back(quiet(silentReturn));
    };
    if (typeof sig !== "string" || !sig) return refuse(badRequest("bad-login", "Missing sso or sig"));
    if (!verifySignature(sso, sig, config.discourseConnectSecret)) return refuse(forbidden("Login response signature is invalid"));
    const p = decodePayload(sso);
    if (!row) return refuse(badRequest("bad-login", "Login request unknown — please log in again"));
    // use the nonce up whatever happens next: each login response counts once (the row stays, marked, so a repeat is known)
    const taken = db.prepare("UPDATE auth_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL").run(Date.now(), nonce).changes === 1;
    if (!taken) return refuse(badRequest("bad-login", "Login request already used — please log in again"));
    nonceCookie(reply, held.filter((n) => n !== nonce)); // this login is over for this browser, whatever happens next
    if (row.expires_at < Date.now()) return refuse(badRequest("bad-login", "Login request expired — please log in again"));
    // the answer must come back to the browser that asked: a callback URL carried to another browser is worthless
    if (!held.includes(nonce)) return refuse(forbidden("This login was started in another browser — please log in again"));
    const returnTo = row.silent ? quiet(row.return_path) : row.return_path;
    // a silent check and the visitor isn't signed into the forum: carry on as a visitor, no error
    // (or a member signed out of the forum since: end the session here too)
    if (p.get("failed") === "true") {
      if (!row.silent) return refuse(badRequest("bad-login", "The forum didn't log you in — please log in again"));
      checkedCookie(reply);
      if (req.cookies[SESSION_COOKIE]) reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return back(returnTo);
    }
    const id = Number(p.get("external_id"));
    const username = p.get("username");
    if (!Number.isInteger(id) || id <= 0 || !username) return refuse(badRequest("bad-login", "Login response has no user"));
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
    checkedCookie(reply);
    return back(returnTo);
  });

  // One sign-out (#132): end the session here, then the browser goes to the forum's DiscourseConnect logout, which
  // signs it out of the forum (and so of the other sites at their next check) and comes back to our home page.
  // While the forum is down (same cached probe), the sign-out stays here: `redirect` is null and the page stays put.
  app.post("/auth/logout", async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    if (!config.discourseConnectSecret) return { ok: true, redirect: null };
    checkedCookie(reply); // coming back from the forum (or not going): don't ask it again straight away
    if (!(await forum.check())) {
      req.log.warn("forum unreachable: signed out here only");
      return { ok: true, redirect: null };
    }
    return { ok: true, redirect: signedForumUrl({ nonce: randomBytes(16).toString("hex"), return_sso_url: `${config.baseUrl}/`, logout: "true" }) };
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
