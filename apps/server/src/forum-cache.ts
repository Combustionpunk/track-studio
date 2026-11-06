// A cached, per-layout read of a forum plugin endpoint (events #66, stats #76). Nothing is stored here; answers are
// cached for 10 minutes. If the forum is down the answer is the last good one, else "unknown" (null), never an error.

export interface ForumCacheOptions {
  forumUrl: string;
  fetch?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  log?: { warn: (obj: object, msg: string) => void };
}

const TTL_MS = 10 * 60_000;
/** after a failure, wait this long before asking the forum again (about any layout: a slow forum isn't asked N times) */
const RETRY_MS = 60_000;

interface Entry<T> {
  at: number;
  /** the last good answer (kept when a later fetch fails) */
  value: T | null;
  /** when the last fetch failed (null: the answer is good for the TTL) */
  failedAt: number | null;
  pending: Promise<T | null> | null;
}

export abstract class ForumLayoutCache<T> {
  private readonly cache = new Map<string, Entry<T>>();
  private readonly fetch: typeof fetch;
  private readonly ttl: number;
  private readonly timeout: number;
  private readonly now: () => number;
  /** the forum last failed at this time */
  private downAt: number | null = null;

  constructor(protected readonly opts: ForumCacheOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.ttl = opts.ttlMs ?? TTL_MS;
    this.timeout = opts.timeoutMs ?? 5000;
    this.now = opts.now ?? Date.now;
  }

  /** the endpoint for a layout, below the forum URL */
  protected abstract path(layoutId: string): string;
  /** the answer, or null if the body isn't what the endpoint sends */
  protected abstract parse(body: unknown): T | null;
  /** for the log: "forum events unavailable" */
  protected abstract readonly what: string;

  /**
   * The forum's answer for this layout; null when the forum can't say and there's no earlier answer.
   * `fresh`: ask the forum even if the cached answer is recent.
   */
  async forLayout(layoutId: string, opts: { fresh?: boolean } = {}): Promise<T | null> {
    const t = this.now();
    const entry = this.cache.get(layoutId);
    if (entry?.pending) return entry.pending;
    // the forum failed a moment ago: don't wait on it again yet
    if (this.downAt !== null && t - this.downAt <= RETRY_MS) return entry?.value ?? null;
    if (entry && !opts.fresh && entry.failedAt === null && t - entry.at <= this.ttl) return entry.value;
    const e: Entry<T> = entry ?? { at: 0, value: null, failedAt: null, pending: null };
    this.cache.set(layoutId, e);
    e.pending = this.load(layoutId).then((value) => {
      e.pending = null;
      if (value) {
        Object.assign(e, { at: this.now(), value, failedAt: null });
        this.downAt = null;
      } else e.failedAt = this.downAt = this.now();
      return e.value;
    });
    return e.pending;
  }

  /** Answers for several layouts, a few requests at a time. */
  async forLayouts(ids: string[], concurrency = 6): Promise<Map<string, T | null>> {
    const out = new Map<string, T | null>();
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

  private async load(layoutId: string): Promise<T | null> {
    const url = `${this.opts.forumUrl}${this.path(encodeURIComponent(layoutId))}`;
    try {
      const res = await this.fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = this.parse(await res.json());
      if (!value) throw new Error("unexpected answer");
      return value;
    } catch (err) {
      this.opts.log?.warn({ layoutId, err: (err as Error).message }, this.what);
      return null;
    }
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An http(s) link, relative ones resolved on the forum; null for anything else. */
export function forumLink(v: unknown, forumUrl: string): string | null {
  try {
    const u = new URL(String(v), `${forumUrl}/`);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    // no link
  }
  return null;
}
