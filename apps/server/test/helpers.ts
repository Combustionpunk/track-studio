import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import { decodePayload, encodePayload, signPayload } from "../src/auth.js";
import { ROOT_DIR, type Config } from "../src/config.js";
import { seed } from "../src/seed.js";

export const SECRET = "test-discourse-connect-secret";
export const BASE_URL = "http://tracks.test";
export const FORUM_URL = "http://forum.test";

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    baseUrl: BASE_URL,
    forumUrl: FORUM_URL,
    discourseConnectSecret: SECRET,
    sessionSecret: "s".repeat(40),
    dataDir: mkdtempSync(join(tmpdir(), "track-studio-test-")),
    organiserGroup: "track-admins",
    devLogin: false,
    production: false,
    ...over,
  };
}

const open: { app: FastifyInstance; dir: string }[] = [];
afterEach(async () => {
  for (const { app, dir } of open.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh app on an empty temp DATA_DIR (closed and deleted after each test). */
export async function makeApp(opts: { seeded?: boolean; config?: Partial<Config> } = {}) {
  const config = testConfig(opts.config);
  const app = await buildApp(config);
  open.push({ app, dir: config.dataDir });
  if (opts.seeded) seed(app.db, config, join(ROOT_DIR, "reference"), () => {});
  return { app, config };
}

export interface ForumUser {
  id: number;
  username: string;
  name?: string;
  groups?: string[];
  admin?: boolean;
  moderator?: boolean;
}

/** Start a login and return the nonce + return URL the server sent to the forum. */
export async function startLogin(app: FastifyInstance, returnPath = "/") {
  const res = await app.inject({ method: "GET", url: `/auth/login?return=${encodeURIComponent(returnPath)}` });
  const loc = new URL(res.headers.location as string);
  const sso = loc.searchParams.get("sso")!;
  const p = decodePayload(sso);
  return { res, loc, sso, sig: loc.searchParams.get("sig")!, nonce: p.get("nonce")!, returnSsoUrl: p.get("return_sso_url")! };
}

/** What the forum sends back: a signed payload for this nonce and user. */
export function forumResponse(nonce: string, u: ForumUser, secret = SECRET) {
  const sso = encodePayload({
    nonce,
    external_id: String(u.id),
    username: u.username,
    name: u.name ?? u.username,
    email: `${u.username}@example.test`,
    avatar_url: `${FORUM_URL}/avatar/${u.username}.png`,
    groups: (u.groups ?? []).join(","),
    admin: String(Boolean(u.admin)),
    moderator: String(Boolean(u.moderator)),
    return_sso_url: `${BASE_URL}/auth/callback`,
  });
  return { sso, sig: signPayload(sso, secret) };
}

export const callbackUrl = (r: { sso: string; sig: string }) => `/auth/callback?sso=${encodeURIComponent(r.sso)}&sig=${r.sig}`;

/** Full DiscourseConnect round trip; returns the Cookie header value for the session. */
export async function login(app: FastifyInstance, u: ForumUser): Promise<string> {
  const { nonce } = await startLogin(app);
  const res = await app.inject({ method: "GET", url: callbackUrl(forumResponse(nonce, u)) });
  if (res.statusCode !== 302) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((c) => c.name === "ts_session")!;
  return `ts_session=${c.value}`;
}

export const ALICE: ForumUser = { id: 101, username: "alice" };
export const BOB: ForumUser = { id: 102, username: "bob" };
export const ORGANISER: ForumUser = { id: 103, username: "olive", groups: ["trust_level_1", "track-admins"] };
export const ADMIN: ForumUser = { id: 1, username: "root", admin: true };

export const referenceJson = <T = Record<string, unknown>>(rel: string): T => JSON.parse(readFileSync(join(ROOT_DIR, "reference", rel), "utf8")) as T;
