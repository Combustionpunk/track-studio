// Is the forum up? Asked before sending a browser there for a silent sign-in or a sign-out (#132): if it isn't, the
// visitor must never land on the forum's error page. One short probe of its status page, cached for a minute either way.
import type { FastifyBaseLogger } from "fastify";

// The probe is the same as club-timing's (#111 there), so the two sites agree on when the forum is up: the same page,
// timeout and cache time, and only a 2xx from the status page itself counts (a redirect isn't followed).

/** Discourse's liveness page: plain "ok" with a 200 when the app is up. */
export const FORUM_STATUS_PATH = "/srv/status";
export const PROBE_TIMEOUT_MS = 1_500;
export const PROBE_TTL_MS = 60_000;

export interface ForumReachableOptions {
  forumUrl: string;
  fetch?: typeof fetch;
  log?: Pick<FastifyBaseLogger, "info" | "warn">;
  /** how long one probe may take; a page waits at most this long */
  timeoutMs?: number;
  /** how long an answer (up or down) is believed */
  ttlMs?: number;
  now?: () => number;
}

export class ForumReachable {
  private last: { ok: boolean; at: number } | undefined;
  private inFlight: Promise<boolean> | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: ForumReachableOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
    this.ttlMs = opts.ttlMs ?? PROBE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** True when the forum answered its status page with a 2xx within the timeout, as of the last probe (at most `ttlMs` ago). Never throws or rejects. */
  check(): Promise<boolean> {
    if (this.last && this.now() - this.last.at < this.ttlMs) return Promise.resolve(this.last.ok);
    if (!this.inFlight) {
      this.inFlight = this.probe()
        .then((ok) => {
          const changed = this.last?.ok !== ok;
          // the answer is stored before anything that could throw, so a probe is never left in flight for good
          this.last = { ok, at: this.now() };
          this.inFlight = undefined;
          if (changed) {
            if (ok) this.opts.log?.info({ forumUrl: this.opts.forumUrl }, "forum reachable: silent sign-in on");
            else this.opts.log?.warn({ forumUrl: this.opts.forumUrl, timeoutMs: this.timeoutMs }, "forum unreachable: silent sign-in paused");
          }
          return ok;
        })
        // a logger that throws must not turn into an error page on every visit: the answer just stored still stands
        .catch(() => {
          this.inFlight = undefined;
          return this.last?.ok ?? false;
        });
    }
    return this.inFlight;
  }

  private async probe(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.opts.forumUrl}${FORUM_STATUS_PATH}`, {
        headers: { accept: "text/plain" },
        // a redirect (to a login wall, a maintenance page, another host) isn't the forum saying it's up
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }
}
