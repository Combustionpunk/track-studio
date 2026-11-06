// The forum's venue list (FORUM_URL/des/venues, public), for the venue editor's picker. Cached for 10 minutes; when the
// forum doesn't answer, the last copy is served marked stale, and with nothing cached the caller gets a 503.
import { HttpError } from "./errors.js";

export interface ForumTrack {
  id: number;
  name: string;
  surface: string | null;
  environment: string | null;
  width_m: number | null;
  length_m: number | null;
}

export interface ForumVenue {
  id: number;
  name: string;
  town: string | null;
  tracks: ForumTrack[];
}

export interface ForumVenueList {
  venues: ForumVenue[];
  /** when the forum gave us this list */
  fetchedAt: string;
  /** the forum didn't answer just now; this is the last copy */
  stale: boolean;
}

export const FORUM_VENUES_TTL_MS = 10 * 60 * 1000;
/** after a failed fetch, wait this long before asking the forum again */
const RETRY_MS = 30 * 1000;

export interface ForumVenuesOptions {
  forumUrl: string;
  fetch?: typeof fetch;
  log: { info(msg: string): void; warn(msg: string): void };
  timeoutMs?: number;
  now?: () => number;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const metres = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The forum's answer → venues with id, name, town and tracks only. Throws if it isn't a venue list. */
export function parseForumVenues(body: unknown): ForumVenue[] {
  const list = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.venues) ? body.venues : null;
  if (!list) throw new Error("not a venue list");
  return list.filter((v): v is Record<string, unknown> => isObject(v) && Number.isInteger(v.id) && typeof v.name === "string").map((v) => ({
    id: v.id as number,
    name: v.name as string,
    town: str(v.town),
    tracks: (Array.isArray(v.tracks) ? v.tracks : [])
      .filter((t): t is Record<string, unknown> => isObject(t) && Number.isInteger(t.id))
      .map((t) => ({
        id: t.id as number,
        name: str(t.name) ?? `Track ${t.id}`,
        surface: str(t.surface),
        environment: str(t.environment),
        width_m: metres(t.width_m),
        length_m: metres(t.length_m),
      })),
  }));
}

/** Venues whose name, town or a track's name contains `q` (case and accents ignored). */
export function searchForumVenues(venues: ForumVenue[], q: string | undefined): ForumVenue[] {
  const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = fold(q?.trim() ?? "");
  if (!needle) return venues;
  return venues.filter((v) => [v.name, v.town ?? "", ...v.tracks.map((t) => t.name)].some((s) => fold(s).includes(needle)));
}

export class ForumVenues {
  private cache: { venues: ForumVenue[]; at: number; fetchedAt: string } | null = null;
  private failedAt: number | null = null;
  private failing = false;
  private inflight: Promise<void> | null = null;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: ForumVenuesOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.now = opts.now ?? Date.now;
  }

  async list(): Promise<ForumVenueList> {
    const t = this.now();
    const fresh = this.cache && t - this.cache.at < FORUM_VENUES_TTL_MS;
    const waiting = this.failedAt !== null && t - this.failedAt < RETRY_MS;
    if (!fresh && !waiting) {
      this.inflight ??= this.fetchNow().finally(() => (this.inflight = null));
      await this.inflight;
    }
    if (!this.cache) throw new HttpError(503, "forum-unavailable", "Forum unavailable: it didn't answer, so its venues can't be listed right now.");
    return { venues: this.cache.venues, fetchedAt: this.cache.fetchedAt, stale: this.now() - this.cache.at >= FORUM_VENUES_TTL_MS };
  }

  private async fetchNow(): Promise<void> {
    try {
      const res = await this.fetch(`${this.opts.forumUrl}/des/venues`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000) });
      if (!res.ok) throw new Error(`forum answered HTTP ${res.status}`);
      const venues = parseForumVenues(await res.json());
      this.cache = { venues, at: this.now(), fetchedAt: new Date().toISOString() };
      this.failedAt = null;
      if (this.failing) this.opts.log.info("forum venues: the forum answers again");
      this.failing = false;
    } catch (e) {
      this.failedAt = this.now();
      if (!this.failing) this.opts.log.warn(`forum venues: can't read ${this.opts.forumUrl}/des/venues (${e instanceof Error ? e.message : String(e)}); ${this.cache ? "serving the last copy" : "nothing cached"}`);
      this.failing = true;
    }
  }
}
