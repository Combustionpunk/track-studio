// The site theme follows the forum: its public colour scheme (site.json) is fetched at start and hourly, mapped to
// Track Studio's design tokens and served to the web app (as CSS variables in every page) and to other tools
// (GET /api/theme.json). Grey Amber, the forum's scheme when this was written, is the built-in fallback.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The Discourse colour roles Track Studio uses. */
export interface Roles {
  primary: string;
  secondary: string;
  tertiary: string;
  header_background: string;
  header_primary: string;
  highlight: string;
  success: string;
  danger: string;
  hover: string;
  selected: string;
}

export const GREY_AMBER: Roles = {
  primary: "#d9d9d9",
  secondary: "#3d4147",
  tertiary: "#fdd459",
  header_background: "#36393e",
  header_primary: "#d9d9d9",
  highlight: "#fdd459",
  success: "#fdd459",
  danger: "#e45735",
  hover: "#2f2f30",
  selected: "#272727",
};

export const FONTS = { body: "Inter", headings: "Oswald" } as const;

/** Colour tokens; the CSS variable is the kebab-case name (surface2 → --surface-2). Keep in step with tokens.css. */
export interface Tokens {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  link: string;
  focus: string;
  headerBg: string;
  headerText: string;
  highlight: string;
  success: string;
  successText: string;
  danger: string;
  dangerText: string;
  hover: string;
  selected: string;
}

export interface Theme {
  /** forum = fetched this run; cache = from the last run's fetch; fallback = built-in Grey Amber */
  source: "forum" | "cache" | "fallback";
  /** when the colours were last fetched from the forum (null: never) */
  syncedAt: string | null;
  scheme: { name: string; dark: boolean };
  /** the default (dark when the forum has both) */
  colors: Tokens;
  /** only when the forum has a separate light scheme: used when the device prefers light */
  light: { name: string; colors: Tokens } | null;
  fonts: typeof FONTS;
}

// ------------------------------------------------------------------ colour maths (sRGB, like Sass/Discourse)
type RGB = [number, number, number];
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgb(hex: string): RGB {
  let h = HEX.exec(hex)![1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
export const normHex = (hex: string) => toHex(rgb(hex));

/** `amount` of `fg` over `bg` (0 = bg, 1 = fg). */
export function mix(fg: string, bg: string, amount: number): string {
  const a = rgb(fg);
  const b = rgb(bg);
  return toHex([0, 1, 2].map((i) => a[i] * amount + b[i] * (1 - amount)) as RGB);
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg`, moved towards `towards` just far enough to reach `ratio` against every background. */
function readable(fg: string, bgs: string[], towards: string, ratio = 4.5): string {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(towards, fg, t);
    if (bgs.every((bg) => contrast(c, bg) >= ratio)) return c;
  }
  return towards;
}

/** Text on a coloured fill: whichever of the scheme's own text colours, black or white reads best. */
function inkOn(fill: string, candidates: string[]): string {
  const ok = candidates.find((c) => contrast(c, fill) >= 4.5);
  return ok ?? [...candidates, "#000000", "#ffffff"].sort((x, y) => contrast(y, fill) - contrast(x, fill))[0];
}

/**
 * Discourse roles → tokens. Surfaces, borders and muted text are blends of primary over secondary, the way Discourse
 * builds primary-very-low / -low / -low-mid / -high; text colours are nudged lighter/darker until they meet WCAG AA.
 */
export function deriveTokens(roles: Roles): Tokens {
  const r = Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, normHex(v)])) as unknown as Roles;
  const p = r.primary;
  const s = r.secondary;
  const surface = mix(p, s, 0.04);
  const surface2 = mix(p, s, 0.1);
  const onSurfaces = [s, surface, surface2];
  // coloured text is lightened (dark schemes) or darkened (light schemes) to keep its hue while reaching AA
  const away = luminance(s) < 0.2 ? "#ffffff" : "#000000";
  return {
    bg: s,
    surface,
    surface2,
    border: mix(p, s, 0.2),
    text: p,
    muted: readable(mix(p, s, 0.7), onSurfaces, p),
    accent: r.tertiary,
    accentInk: inkOn(r.tertiary, [s, p]),
    accentSoft: mix(r.tertiary, s, 0.15),
    link: readable(r.tertiary, onSurfaces, away),
    focus: readable(r.tertiary, [s, surface], away, 3),
    headerBg: r.header_background,
    headerText: readable(r.header_primary, [r.header_background], p),
    highlight: r.highlight,
    success: r.success,
    successText: readable(r.success, onSurfaces, away),
    danger: r.danger,
    dangerText: readable(r.danger, onSurfaces, away),
    hover: r.hover,
    selected: r.selected,
  };
}

// ------------------------------------------------------------------ site.json
interface Scheme {
  id: unknown;
  name: string;
  dark: boolean;
  roles: Roles;
}

/** A Discourse colour scheme, or why it's unusable. Missing optional roles come from Grey Amber. */
function readScheme(raw: unknown): Scheme | string {
  if (!raw || typeof raw !== "object") return "no colour scheme";
  const o = raw as { id?: unknown; name?: unknown; is_dark?: unknown; colors?: unknown };
  if (!Array.isArray(o.colors)) return "colour scheme has no colours";
  const found: Record<string, string> = {};
  for (const c of o.colors as { name?: unknown; hex?: unknown }[]) {
    if (typeof c?.name !== "string" || !(c.name in GREY_AMBER)) continue;
    if (typeof c.hex !== "string" || !HEX.test(c.hex)) return `colour "${c.name}" is not a hex colour`;
    found[c.name] = normHex(c.hex);
  }
  if (!found.primary || !found.secondary) return "colour scheme has no primary/secondary";
  if (contrast(found.primary, found.secondary) < 4.5) return "colour scheme's text and background are too close to read";
  return { id: o.id, name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 80) : "Forum", dark: o.is_dark === true, roles: { ...GREY_AMBER, ...found } };
}

/** site.json → the theme's colours. Throws with a short reason if it's unusable. */
export function themeFromSite(site: unknown): Pick<Theme, "scheme" | "colors" | "light"> {
  if (!site || typeof site !== "object") throw new Error("site.json is not an object");
  const s = site as { default_light_color_scheme?: unknown; default_dark_color_scheme?: unknown };
  const main = readScheme(s.default_light_color_scheme);
  if (typeof main === "string") throw new Error(main);
  // a separate dark scheme: dark is the default, the light one follows the device
  const dark = s.default_dark_color_scheme ? readScheme(s.default_dark_color_scheme) : null;
  if (dark && typeof dark !== "string" && dark.id !== main.id) {
    return { scheme: { name: dark.name, dark: true }, colors: deriveTokens(dark.roles), light: { name: main.name, colors: deriveTokens(main.roles) } };
  }
  return { scheme: { name: main.name, dark: main.dark }, colors: deriveTokens(main.roles), light: null };
}

export const fallbackTheme = (): Theme => ({ source: "fallback", syncedAt: null, scheme: { name: "Grey Amber", dark: true }, colors: deriveTokens(GREY_AMBER), light: null, fonts: FONTS });

// ------------------------------------------------------------------ CSS
const cssVar = (k: string) => "--" + k.replace(/[A-Z0-9]/g, (ch) => `-${ch.toLowerCase()}`);
const block = (colors: Tokens, dark: boolean) => `html:root{color-scheme:${dark ? "dark" : "light"};${Object.entries(colors).map(([k, v]) => `${cssVar(k)}:${normHex(v)};`).join("")}}`;

/** The theme as CSS variables (overrides the defaults in the web app's tokens.css). Values are normalised hex only. */
export function themeCss(t: Theme): string {
  const main = block(t.colors, t.scheme.dark);
  return t.light ? `${main}@media (prefers-color-scheme: light){${block(t.light.colors, false)}}` : main;
}

/** What goes in every page's <head>. */
export const themeHead = (t: Theme) => `<style id="theme">${themeCss(t)}</style>\n<meta name="color-scheme" content="${t.light ? "dark light" : t.scheme.dark ? "dark" : "light"}">\n<meta name="theme-color" content="${normHex(t.colors.headerBg)}">`;

// ------------------------------------------------------------------ sync
export interface ThemeLog {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface ThemeSyncOptions {
  forumUrl: string;
  fetch?: typeof fetch;
  log: ThemeLog;
  /** where the last good scheme is kept between runs */
  cacheFile?: string;
  timeoutMs?: number;
}

export const SYNC_INTERVAL_MS = 60 * 60 * 1000;

export class ThemeSync {
  private theme: Theme;
  private timer: ReturnType<typeof setInterval> | null = null;
  private failing = false;
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: ThemeSyncOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.theme = this.readCache() ?? fallbackTheme();
  }

  current(): Theme {
    return this.theme;
  }

  /** Fetch now. Never throws; on failure the current theme stays (Grey Amber until the forum has answered once). */
  async refresh(): Promise<{ ok: boolean; error?: string; theme: Theme }> {
    try {
      const res = await this.fetch(`${this.opts.forumUrl}/site.json`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000) });
      if (!res.ok) throw new Error(`forum answered HTTP ${res.status}`);
      let site: unknown;
      try {
        site = await res.json();
      } catch {
        throw new Error("site.json is not JSON");
      }
      this.theme = { ...themeFromSite(site), source: "forum", syncedAt: new Date().toISOString(), fonts: FONTS };
      this.writeCache(site as Record<string, unknown>);
      if (this.failing) this.opts.log.info("theme: forum colour scheme reachable again");
      this.failing = false;
      return { ok: true, theme: this.theme };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (!this.failing) this.opts.log.warn(`theme: can't use the forum's colour scheme (${error}); using ${this.theme.source === "fallback" ? "Grey Amber" : "the last synced scheme"}`);
      this.failing = true;
      return { ok: false, error, theme: this.theme };
    }
  }

  /** Fetch now, then hourly. */
  async start(intervalMs = SYNC_INTERVAL_MS): Promise<void> {
    this.stop();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref?.();
    await this.refresh();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private readCache(): Theme | null {
    if (!this.opts.cacheFile) return null;
    try {
      const c = JSON.parse(readFileSync(this.opts.cacheFile, "utf8")) as { forumUrl?: string; site?: unknown; syncedAt?: string };
      if (c.forumUrl !== this.opts.forumUrl || typeof c.syncedAt !== "string") return null;
      return { ...themeFromSite(c.site), source: "cache", syncedAt: c.syncedAt, fonts: FONTS };
    } catch {
      return null;
    }
  }

  private writeCache(site: Record<string, unknown>): void {
    if (!this.opts.cacheFile) return;
    try {
      // only the two schemes, not the rest of site.json
      const schemes = { default_light_color_scheme: site.default_light_color_scheme, default_dark_color_scheme: site.default_dark_color_scheme ?? null };
      mkdirSync(dirname(this.opts.cacheFile), { recursive: true });
      const tmp = `${this.opts.cacheFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ forumUrl: this.opts.forumUrl, syncedAt: this.theme.syncedAt, site: schemes }));
      renameSync(tmp, this.opts.cacheFile);
    } catch (e) {
      this.opts.log.warn(`theme: couldn't write the cache (${e instanceof Error ? e.message : e})`);
    }
  }
}
