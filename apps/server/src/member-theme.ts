// The signed-in member's theme, read from the forum server to server (#141; the forum side is the event-system plugin's
// #457, and this is the same reader as the timing site's #166, so both sites behave the same):
// `GET <forum>/des/members/:user_id/theme.json`, where `user_id` is the forum user id DiscourseConnect sends as
// `external_id`. The request carries FORUM_THEME_API_KEY as the `Api-Key` header: an admin's single-user key whose only
// scope is `discourse_event_system: read_member_themes`. The key is never logged and never sent to a page.
//
// The body is passed on checked (`theme`, `dark_theme`, `mode`, `colours`, `brand_version`); the web app decides what it
// shows (apps/web/src/lib/theme.tsx, memberThemePick).
//
// Offline first: no key, a 401, 403 or 404, a timeout (2 s) or a forum that is down all come to null, so a page shows
// the club's theme and then Pit Lane as before. Answers are kept 10 minutes per member and read afresh at every sign-in
// (`refresh`). While the forum fails, a member's last good answer stands in for up to an hour, and after a failure the
// forum isn't asked again (for anyone) for a minute.

export interface ForumMemberTheme {
  theme: string | null;
  dark_theme?: string | null;
  mode?: string;
  colours?: string[] | null;
  brand_version?: string;
}

export const MEMBER_THEME_TTL_MS = 10 * 60_000;
/** After a failure, how long before the forum is asked again. */
export const MEMBER_THEME_FAIL_MS = 60_000;
/** How long a member's last good answer stands in while the forum fails. */
export const MEMBER_THEME_STALE_MS = 60 * 60_000;
export const MEMBER_THEME_TIMEOUT_MS = 2000;
/** Members held in the cache at most (the oldest go first). */
const MAX_MEMBERS = 5000;
/** The longest id or colour passed on; anything longer is dropped. */
const MAX_STRING = 64;
const MAX_COLOURS = 8;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const shortString = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_STRING;

/** The forum's body, checked: only the contract's fields, each of the right type (a wrong one is left out). Undefined when it isn't a theme body. */
export function parseMemberTheme(v: unknown): ForumMemberTheme | undefined {
  if (!isObject(v)) return undefined;
  if (!(v.theme === null || shortString(v.theme))) return undefined;
  const out: ForumMemberTheme = { theme: v.theme };
  if (v.dark_theme === null || shortString(v.dark_theme)) out.dark_theme = v.dark_theme;
  if (shortString(v.mode)) out.mode = v.mode;
  if (v.colours === null) out.colours = null;
  else if (Array.isArray(v.colours)) out.colours = v.colours.filter(shortString).slice(0, MAX_COLOURS);
  if (shortString(v.brand_version)) out.brand_version = v.brand_version;
  return out;
}

/** What the reader needs of `fetch`. */
export type ThemeFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; redirect: "manual" },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface MemberThemesOptions {
  /** the forum, no trailing slash needed */
  forumUrl: string;
  /** the themes-only key; none: the forum is never asked */
  apiKey?: string;
  fetch?: ThemeFetch;
  now?: () => number;
  timeoutMs?: number;
  /** where the reader says the forum started failing, or answers again (never with the key) */
  print?: (line: string) => void;
}

export class MemberThemes {
  private readonly cache = new Map<number, { value: ForumMemberTheme | null; at: number }>();
  private readonly inflight = new Map<number, Promise<ForumMemberTheme | null>>();
  /** the forum failed: not asked again until then */
  private quietUntil = -Infinity;
  private failing: string | null = null;
  private readonly base: string;
  private readonly key: string | undefined;
  private readonly doFetch: ThemeFetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly print: (line: string) => void;

  constructor(opts: MemberThemesOptions) {
    this.base = opts.forumUrl.replace(/\/+$/, "");
    this.key = opts.apiKey?.trim() || undefined;
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs ?? MEMBER_THEME_TIMEOUT_MS;
    this.print = opts.print ?? (() => {});
  }

  /** Whether there is a key, so the forum is asked at all. */
  get enabled(): boolean {
    return this.key !== undefined;
  }

  private askable(userId: number): boolean {
    return this.key !== undefined && Number.isInteger(userId) && userId > 0; // dev logins (< 0) aren't forum members
  }

  /** The member's theme: from the cache while it's fresh, else from the forum. Null for none. Never rejects. */
  get(userId: number): Promise<ForumMemberTheme | null> {
    if (!this.askable(userId)) return Promise.resolve(null);
    const pending = this.inflight.get(userId);
    if (pending) return pending;
    const e = this.cache.get(userId);
    if (e && this.now() - e.at < MEMBER_THEME_TTL_MS) return Promise.resolve(e.value);
    if (this.now() < this.quietUntil) return Promise.resolve(this.lastKnown(userId));
    return this.read(userId);
  }

  /** At sign-in: ask the forum now, whatever the cache holds (unless it failed within the minute). Never rejects. */
  refresh(userId: number): Promise<ForumMemberTheme | null> {
    if (!this.askable(userId)) return Promise.resolve(null);
    const pending = this.inflight.get(userId);
    if (pending) return pending;
    if (this.now() < this.quietUntil) return Promise.resolve(this.lastKnown(userId));
    return this.read(userId);
  }

  /** The member's last answer, if recent enough to stand in while the forum fails. */
  private lastKnown(userId: number): ForumMemberTheme | null {
    const e = this.cache.get(userId);
    return e && this.now() - e.at < MEMBER_THEME_STALE_MS ? e.value : null;
  }

  private read(userId: number): Promise<ForumMemberTheme | null> {
    const p = this.ask(userId)
      .catch(() => this.lastKnown(userId))
      .finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, p);
    return p;
  }

  private async ask(userId: number): Promise<ForumMemberTheme | null> {
    const path = `/des/members/${userId}/theme.json`;
    let why: string;
    try {
      const r = await this.doFetch(`${this.base}${path}`, {
        headers: { accept: "application/json", "api-key": this.key!, "user-agent": "track-studio (member theme)" },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
      });
      if (r.status === 200) {
        const v = parseMemberTheme(await r.json());
        if (v !== undefined) return this.answered(userId, v);
        why = `${path} didn't send a theme`;
      } else if (r.status === 404) {
        return this.answered(userId, null); // a member the forum doesn't know: an answer, not a failure
      } else if (r.status === 401 || r.status === 403) {
        why = `the forum refused the theme key (${r.status}): it needs an admin's single-user key with the scope discourse_event_system: read_member_themes`;
      } else {
        why = `${path} answered ${r.status}`;
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      why =
        name === "TimeoutError" || name === "AbortError"
          ? `no answer within ${this.timeoutMs} ms`
          : name === "SyntaxError"
            ? `${path} didn't send JSON`
            : e instanceof Error
              ? e.cause instanceof Error
                ? e.cause.message
                : e.message
              : String(e);
    }
    this.quietUntil = this.now() + MEMBER_THEME_FAIL_MS;
    if (this.failing === null) this.print(`members' own themes: can't read from the forum (${why}); pages show the club's theme or Pit Lane until it answers`);
    this.failing = why;
    return this.lastKnown(userId);
  }

  private answered(userId: number, value: ForumMemberTheme | null): ForumMemberTheme | null {
    if (this.failing !== null) this.print("members' own themes: the forum is answering again");
    this.failing = null;
    this.cache.delete(userId);
    this.cache.set(userId, { value, at: this.now() });
    if (this.cache.size > MAX_MEMBERS) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}
