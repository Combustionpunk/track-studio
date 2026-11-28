// The forum's venue list (FORUM_URL/des/venues, public), for the venue editor's picker. Cached for 10 minutes; when the
// forum doesn't answer, the last copy is served marked stale, and with nothing cached the caller gets a 503.
import type { VenueSurface } from "@track-studio/engine";
import { HttpError } from "./errors.js";

export interface ForumTrack {
  id: number;
  name: string;
  /** the forum's word for it (DesVenueTrack::SURFACES: carpet, astroturf, grass, tarmac, dirt, mixed; clay with plugin #537) */
  surface: string | null;
  /** #190: the same in the format's words (templateSurface); null when the forum gives none or the format has no match */
  templateSurface: VenueSurface | null;
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

/** a UK postcode, e.g. "LS1 4AB" or "LS21 3AF" */
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const COUNTRY = /^(uk|u\.k\.|united kingdom|great britain|gb|england|scotland|wales|northern ireland)$/i;

/**
 * The town in a forum venue's address: the last part before the postcode ("Unit 4, Mill Lane, Leeds, LS1 4AB" → "Leeds").
 * The forum's venue list has an address but no town (only the single-venue answer has one). Without a postcode, the
 * last part that isn't a country; null when the address is a single part (that's the street, or only the postcode).
 */
export function townFromAddress(address: unknown): string | null {
  if (typeof address !== "string") return null;
  const parts = address.split(/[,\n]/).map((p) => p.trim()).filter((p) => p && !COUNTRY.test(p));
  const at = parts.findIndex((p) => POSTCODE.test(p));
  if (at === -1) return parts.length > 1 ? parts[parts.length - 1] : null;
  const before = parts[at].replace(POSTCODE, "").trim();
  return before || (at > 0 ? parts[at - 1] : null);
}

/**
 * #190: the forum's track surfaces in the format's words. The forum is the source of a linked template's surface.
 * #197: grass is in the format since rctrack 1.14 / rcvenue 1.3; clay is the format's already and maps as soon as the
 * forum offers it (plugin #537). A word the format doesn't have gives the template (and layouts drawn on it) no surface.
 */
const FORUM_SURFACES: Record<string, VenueSurface> = { carpet: "carpet", astroturf: "astro", grass: "grass", tarmac: "tarmac", dirt: "dirt", clay: "clay", mixed: "mixed" };

/** A forum surface → the format's, or null (none given, or a word the format doesn't have). */
export function templateSurface(forum: unknown): VenueSurface | null {
  if (typeof forum !== "string") return null;
  const key = forum.trim().toLowerCase();
  return Object.hasOwn(FORUM_SURFACES, key) ? FORUM_SURFACES[key] : null;
}

/** The forum's answer → venues with id, name, town and tracks only. Throws if it isn't a venue list. */
export function parseForumVenues(body: unknown): ForumVenue[] {
  const list = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.venues) ? body.venues : null;
  if (!list) throw new Error("not a venue list");
  return list.filter((v): v is Record<string, unknown> => isObject(v) && Number.isInteger(v.id) && typeof v.name === "string").map((v) => ({
    id: v.id as number,
    name: v.name as string,
    town: str(v.town) ?? townFromAddress(v.address),
    tracks: (Array.isArray(v.tracks) ? v.tracks : [])
      .filter((t): t is Record<string, unknown> => isObject(t) && Number.isInteger(t.id))
      .map((t) => ({
        id: t.id as number,
        name: str(t.name) ?? `Track ${t.id}`,
        surface: str(t.surface),
        templateSurface: templateSurface(t.surface),
        environment: str(t.environment),
        width_m: metres(t.width_m),
        length_m: metres(t.length_m),
      })),
  }));
}

/** Venues whose name, town or a track's name contains `q` (case and accents ignored). */
export function searchForumVenues(venues: ForumVenue[], q: string | undefined): ForumVenue[] {
  const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = fold(q?.trim() ?? "");
  if (!needle) return venues;
  return venues.filter((v) => [v.name, v.town ?? "", ...v.tracks.map((t) => t.name)].some((s) => fold(s).includes(needle)));
}

/**
 * Refuse a forum link whose track isn't one of that forum venue's tracks, checked against the forum's (cached) list.
 * While the forum is down with nothing cached it can't be checked, and the save goes ahead.
 */
export async function assertTrackAtVenue(forumVenues: ForumVenues, link: { id?: unknown; trackId?: unknown }): Promise<void> {
  let venues: ForumVenue[];
  try {
    venues = (await forumVenues.list()).venues;
  } catch (e) {
    if (e instanceof HttpError && e.code === "forum-unavailable") return;
    throw e;
  }
  const venue = venues.find((v) => v.id === link.id);
  if (!venue) throw new HttpError(400, "invalid-venue", `Forum venue ${String(link.id)} isn't on the forum's venue list.`);
  if (!venue.tracks.some((t) => t.id === link.trackId)) throw new HttpError(400, "invalid-venue", `Forum track ${String(link.trackId)} isn't one of ${venue.name}'s tracks.`);
}

/** The managing club's short code in the forum's single-venue answer (GET /des/venues/:id), or null when it has none. */
export function parseManagingClub(body: unknown): string | null {
  const venue = isObject(body) && isObject(body.venue) ? body.venue : null;
  if (!venue) throw new Error("not a venue");
  const club = venue.managing_organisation;
  return isObject(club) && typeof club.short_code === "string" && club.short_code.trim() ? club.short_code.trim().toLowerCase() : null;
}

export class ForumVenues {
  private cache: { venues: ForumVenue[]; at: number; fetchedAt: string } | null = null;
  /** forum venue id -> the club that manages it (#173), as the forum said at `at` */
  private clubs = new Map<number, { club: string | null; at: number }>();
  /** forum venue id -> when asking the forum about it last failed (wait RETRY_MS before asking again) */
  private clubsFailedAt = new Map<number, number>();
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

  /**
   * #173: the short code of the club that manages a forum venue (its committee may edit the venue's templates), or null
   * when no club does or the forum doesn't know the venue. Cached for 10 minutes per venue; when the forum doesn't answer
   * the last answer is used, and with none the caller gets a 503.
   */
  async managingClub(venueId: number): Promise<string | null> {
    const cached = this.clubs.get(venueId);
    if (cached && this.now() - cached.at < FORUM_VENUES_TTL_MS) return cached.club;
    const failed = this.clubsFailedAt.get(venueId);
    if (failed !== undefined && this.now() - failed < RETRY_MS) {
      if (cached) return cached.club;
      throw new HttpError(503, "forum-unavailable", "Forum unavailable: it didn't answer, so which club runs this venue can't be checked right now. Try again in a minute.");
    }
    try {
      const res = await this.fetch(`${this.opts.forumUrl}/des/venues/${venueId}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000) });
      if (!res.ok && res.status !== 404) throw new Error(`forum answered HTTP ${res.status}`);
      const club = res.status === 404 ? null : parseManagingClub(await res.json());
      if (this.clubs.size >= 2000) this.clubs.clear(); // venue ids come from request bodies: keep the map bounded
      this.clubs.set(venueId, { club, at: this.now() });
      this.clubsFailedAt.delete(venueId);
      return club;
    } catch (e) {
      if (this.clubsFailedAt.size >= 2000) this.clubsFailedAt.clear();
      this.clubsFailedAt.set(venueId, this.now());
      this.opts.log.warn(`forum venues: can't read ${this.opts.forumUrl}/des/venues/${venueId} (${e instanceof Error ? e.message : String(e)})${cached ? "; using the last answer" : ""}`);
      if (cached) return cached.club;
      throw new HttpError(503, "forum-unavailable", "Forum unavailable: it didn't answer, so which club runs this venue can't be checked right now. Try again in a minute.");
    }
  }

  private async fetchNow(): Promise<void> {
    try {
      const res = await this.fetch(`${this.opts.forumUrl}/des/venues`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000) });
      if (!res.ok) throw new Error(`forum answered HTTP ${res.status}`);
      const venues = parseForumVenues(await res.json());
      const at = this.now();
      this.cache = { venues, at, fetchedAt: new Date(at).toISOString() };
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
