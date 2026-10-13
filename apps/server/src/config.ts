// Server configuration from the environment. Fails fast with a clear message; never prints secret values.
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (apps/server/src -> ../../..; the bundled apps/server/dist is at the same depth). */
export const ROOT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

export interface Config {
  port: number;
  host: string;
  /** public URL of this server, no trailing slash, e.g. http://192.168.0.6:3000 */
  baseUrl: string;
  /** forum URL, no trailing slash */
  forumUrl: string;
  discourseConnectSecret: string;
  sessionSecret: string;
  /** absolute; holds the SQLite file and the preview cache */
  dataDir: string;
  organiserGroup: string;
  devLogin: boolean;
  production: boolean;
}

export class ConfigError extends Error {}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

function url(name: string, v: string, problems: string[]): string {
  if (!v) return v; // already reported as missing
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
  } catch {
    problems.push(`${name} must be an http(s) URL (got "${v}")`);
  }
  return trimSlash(v);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];
  const devLogin = env.DEV_LOGIN === "1";
  const production = env.NODE_ENV === "production";
  const required = (name: string): string => {
    const v = env[name]?.trim();
    if (!v) problems.push(`${name} is required`);
    return v ?? "";
  };

  const baseUrl = url("BASE_URL", required("BASE_URL"), problems);
  const forumUrl = url("FORUM_URL", required("FORUM_URL"), problems);
  // without the forum secret, forum login is off; that's only allowed with DEV_LOGIN
  const discourseConnectSecret = devLogin ? env.DISCOURSE_CONNECT_SECRET?.trim() ?? "" : required("DISCOURSE_CONNECT_SECRET");
  if (discourseConnectSecret && discourseConnectSecret.length < 10) problems.push("DISCOURSE_CONNECT_SECRET must be at least 10 characters (Discourse's minimum)");
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret && sessionSecret.length < 32) problems.push("SESSION_SECRET must be at least 32 characters (e.g. `openssl rand -hex 32`)");
  const dataDirRaw = required("DATA_DIR");
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push(`PORT must be a port number (got "${env.PORT}")`);
  if (devLogin && production) problems.push("DEV_LOGIN=1 is not allowed when NODE_ENV=production");

  if (problems.length) {
    throw new ConfigError(`Invalid configuration:\n  - ${problems.join("\n  - ")}\nSee .env.example.`);
  }
  return {
    port,
    host: env.HOST?.trim() || "0.0.0.0",
    baseUrl,
    forumUrl,
    discourseConnectSecret,
    sessionSecret,
    dataDir: isAbsolute(dataDirRaw) ? dataDirRaw : resolve(ROOT_DIR, dataDirRaw),
    organiserGroup: env.ORGANISER_GROUP?.trim() || "track-admins",
    devLogin,
    production,
  };
}
