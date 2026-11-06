// Where a layout has been used: the forum owns events, and each event stores the layout's id. The forum plugin's
// GET /des/layouts/:layoutId/events lists the published, sold-out and completed ones (#66). Nothing is stored here;
// answers are cached for 10 minutes. If the forum is down the answer is "unknown" (null), never an error.

export interface ForumEvent {
  id: number;
  title: string;
  /** as the forum sends it (ISO date or date-time) */
  startDate: string;
  /** the event on the forum; null if the forum sent something that isn't an http(s) link */
  url: string | null;
  venue: { id: number; name: string } | null;
  venueTrack: { id: number; name: string } | null;
}

export interface UsedAt {
  /** newest first */
  events: ForumEvent[];
  /** distinct venues, most recently used first */
  venues: { id: number; name: string }[];
}

export interface ForumEventsOptions {
  forumUrl: string;
  fetch?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  log?: { warn: (obj: object, msg: string) => void };
}

const TTL_MS = 10 * 60_000;
/** after a failure, wait this long before asking the forum again */
const RETRY_MS = 60_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const ref = (v: unknown) => (isObject(v) && typeof v.id === "number" && typeof v.name === "string" ? { id: v.id, name: v.name } : null);

function parse(body: unknown, forumUrl: string): ForumEvent[] | null {
  if (!isObject(body) || !Array.isArray(body.events)) return null;
  const events: ForumEvent[] = [];
  for (const e of body.events) {
    if (!isObject(e) || typeof e.id !== "number" || typeof e.title !== "string") continue;
    let url: string | null = null;
    try {
      const u = new URL(String(e.url), `${forumUrl}/`);
      if (u.protocol === "http:" || u.protocol === "https:") url = u.href;
    } catch {
      // no link
    }
    events.push({ id: e.id, title: e.title, startDate: typeof e.start_date === "string" ? e.start_date : "", url, venue: ref(e.venue), venueTrack: ref(e.venue_track) });
  }
  // the forum sends newest first; don't rely on it
  return events.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : b.id - a.id));
}

export function usedAt(events: ForumEvent[]): UsedAt {
  const venues = new Map<number, { id: number; name: string }>();
  for (const e of events) if (e.venue && !venues.has(e.venue.id)) venues.set(e.venue.id, e.venue);
  return { events, venues: [...venues.values()] };
}

interface Entry {
  at: number;
  /** the last good answer (kept when a later fetch fails) */
  events: ForumEvent[] | null;
  /** when the last fetch failed; retry after RETRY_MS */
  failedAt: number | null;
  pending: Promise<ForumEvent[] | null> | null;
}

export class ForumEvents {
  private readonly cache = new Map<string, Entry>();
  private readonly fetch: typeof fetch;
  private readonly ttl: number;
  private readonly timeout: number;
  private readonly now: () => number;

  constructor(private readonly opts: ForumEventsOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.ttl = opts.ttlMs ?? TTL_MS;
    this.timeout = opts.timeoutMs ?? 5000;
    this.now = opts.now ?? Date.now;
  }

  /** The events using this layout, newest first; null when the forum can't say and there's no earlier answer. */
  async forLayout(layoutId: string): Promise<ForumEvent[] | null> {
    const t = this.now();
    const entry = this.cache.get(layoutId);
    if (entry?.pending) return entry.pending;
    if (entry) {
      const fresh = entry.failedAt === null ? t - entry.at <= this.ttl : t - entry.failedAt <= RETRY_MS;
      if (fresh) return entry.events;
    }
    const e: Entry = entry ?? { at: 0, events: null, failedAt: null, pending: null };
    this.cache.set(layoutId, e);
    e.pending = this.load(layoutId).then((events) => {
      e.pending = null;
      if (events) Object.assign(e, { at: this.now(), events, failedAt: null });
      else e.failedAt = this.now();
      return e.events;
    });
    return e.pending;
  }

  /** Events for several layouts, a few requests at a time. */
  async forLayouts(ids: string[], concurrency = 6): Promise<Map<string, ForumEvent[] | null>> {
    const out = new Map<string, ForumEvent[] | null>();
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        out.set(id, await this.forLayout(id));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return out;
  }

  private async load(layoutId: string): Promise<ForumEvent[] | null> {
    const url = `${this.opts.forumUrl}/des/layouts/${encodeURIComponent(layoutId)}/events`;
    try {
      const res = await this.fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const events = parse(await res.json(), this.opts.forumUrl);
      if (!events) throw new Error("not an events list");
      return events;
    } catch (err) {
      this.opts.log?.warn({ layoutId, err: (err as Error).message }, "forum events unavailable");
      return null;
    }
  }
}
