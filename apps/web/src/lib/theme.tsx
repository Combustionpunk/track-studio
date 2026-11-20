// The member's theme (#135, #141). The brand package (@rcmisfits/brand) gives every colour as --rm-* variables for the
// theme named by data-theme on <html>; with none, its CSS is Pit Lane, or Pit Lane light when the device asks for light.
// The order every RC Misfits site uses: the signed-in member's own theme, then the club's, then Pit Lane.
//
// The member's theme is what the forum sends (plugin #457), read by our server and handed over in /api/me as `theme`
// (#141); memberThemePick reads it with the same rules as the timing site (club-timing #166). A generated theme (Match
// my car) is written as CSS under its own data-theme.
//
// The plan and the 3D view are drawn with colours rather than CSS, so they take a palette made here from the theme's
// colours (planPalette); the same palette is written to the --plan-* variables for what the app draws over the plan.
import { contrast, defaultTheme, generateTheme, raceColours, themeIds, themes, themeToCss, type ThemeColours, type ThemeMode } from "@rcmisfits/brand";
import { PLAN_PALETTE, type PlanPalette } from "@track-studio/engine";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KNOWN: ReadonlySet<string> = new Set<string>(themeIds);
const LIGHT_QUERY = "(prefers-color-scheme: light)";
const HEX = /^#[0-9a-f]{6}$/i;
const RACE_HEX: ReadonlyMap<string, string> = new Map(raceColours.map((c) => [c.key, c.hex]));

/**
 * A theme to show: a built-in id; two built-in ids that follow the device (a member's light and dark palettes under
 * `mode: auto`); or up to three colours for the brand's generator (Match my car), held to one mode or following the device.
 */
export type ThemeChoice = string | { light: string; dark: string } | { colours: string[]; mode?: ThemeMode };

/** What a member's theme comes to: no choice of their own (the club's applies), or their choice (`undefined`: Pit Lane by device). */
export type MemberThemePick = { chosen: false } | { chosen: true; choice: ThemeChoice | undefined };

/**
 * The member's theme from the forum's body (`{ theme, dark_theme, mode, colours, brand_version }`):
 * - missing, not that object, or `theme: null`: no choice of their own, so the club's theme applies;
 * - `"match-my-car"`: their `colours` (hex, or the brand's race colour keys) through the generator, held to `mode`;
 *   no usable colours is Pit Lane in that mode;
 * - a theme id: the light palette, and `dark_theme` (or the same id, when null) the dark one. `mode` light or dark
 *   holds that palette; auto (or none, or one we don't know) follows the device between the two.
 * An id we don't know (a newer brand's) is Pit Lane in its mode; both unknown under auto is Pit Lane by device.
 */
export function memberThemePick(v: unknown): MemberThemePick {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { chosen: false };
  const { theme, dark_theme: darkTheme, mode: rawMode, colours } = v as Record<string, unknown>;
  if (typeof theme !== "string" || theme === "") return { chosen: false };
  const mode = rawMode === "light" || rawMode === "dark" ? rawMode : "auto";
  const pitLane = mode === "light" ? "pit-lane-light" : mode === "dark" ? "pit-lane" : undefined;
  if (theme === "match-my-car") {
    const hex = Array.isArray(colours) ? colours.slice(0, 3).map((c) => (typeof c === "string" ? (RACE_HEX.get(c) ?? c) : c)) : [];
    if (hex.length === 0 || !hex.every((c): c is string => typeof c === "string" && HEX.test(c))) return { chosen: true, choice: pitLane };
    return { chosen: true, choice: mode === "auto" ? { colours: hex } : { colours: hex, mode } };
  }
  const light = KNOWN.has(theme) ? theme : undefined;
  const darkId = typeof darkTheme === "string" && darkTheme !== "" ? darkTheme : theme;
  const dark = KNOWN.has(darkId) ? darkId : undefined;
  if (mode === "light") return { chosen: true, choice: light ?? "pit-lane-light" };
  if (mode === "dark") return { chosen: true, choice: dark ?? "pit-lane" };
  if (light === undefined && dark === undefined) return { chosen: true, choice: undefined };
  const l = light ?? "pit-lane-light";
  const d = dark ?? "pit-lane";
  return { chosen: true, choice: l === d ? l : { light: l, dark: d } };
}

/** The theme to show: the member's own (as the forum sent it), else the club's (a brand id), else undefined (Pit Lane by device). */
export function chooseTheme(member: unknown, club: string | null | undefined): ThemeChoice | undefined {
  const pick = memberThemePick(member);
  if (pick.chosen) return pick.choice;
  return typeof club === "string" && KNOWN.has(club) ? club : undefined;
}

/** A choice made concrete for the device: a built-in theme, generated colours, or the brand's default (Pit Lane by device). */
export type ShownTheme = { kind: "builtin"; id: string } | { kind: "generated"; colours: ThemeColours } | { kind: "default" };

/** What `choice` shows on a device that does (`prefersLight`) or doesn't ask for light. Never throws: colours the generator refuses are Pit Lane. */
export function shownTheme(choice: ThemeChoice | undefined, prefersLight: boolean): ShownTheme {
  if (choice === undefined) return { kind: "default" };
  if (typeof choice === "string") return KNOWN.has(choice) ? { kind: "builtin", id: choice } : { kind: "default" };
  if ("light" in choice) return shownTheme(prefersLight ? choice.light : choice.dark, prefersLight);
  try {
    return { kind: "generated", colours: generateTheme(choice.colours, choice.mode ?? (prefersLight ? "light" : "dark")) };
  } catch {
    return { kind: "default" };
  }
}

/** The `data-theme` a generated theme is written under, and the `<style>` element it goes in. */
export const GENERATED_THEME_ID = "ts-generated";
export const GENERATED_STYLE_ID = "ts-generated-theme";

/** The little of a document `applyTheme` needs (tests hand it a fake). */
export interface ThemeDocument {
  documentElement: { dataset: DOMStringMap | Record<string, string | undefined> };
  getElementById(id: string): { textContent: string | null; remove(): void } | null;
  createElement(tag: "style"): { id: string; textContent: string | null };
  head: { appendChild(node: never): unknown };
}

/** Puts the theme on <html>: data-theme (and a generated theme's CSS); the default removes both, so the brand's CSS applies. */
export function applyTheme(shown: ShownTheme, doc: ThemeDocument = document as unknown as ThemeDocument): void {
  const html = doc.documentElement.dataset;
  const existing = doc.getElementById(GENERATED_STYLE_ID);
  if (shown.kind === "generated") {
    const css = themeToCss(shown.colours, `[data-theme="${GENERATED_THEME_ID}"]`);
    if (existing) existing.textContent = css;
    else {
      const style = doc.createElement("style");
      style.id = GENERATED_STYLE_ID;
      style.textContent = css;
      doc.head.appendChild(style as never);
    }
    html.theme = GENERATED_THEME_ID;
    return;
  }
  existing?.remove();
  if (shown.kind === "builtin") html.theme = shown.id;
  else delete html.theme;
}

/** The colours `shown` puts on the page: with none, Pit Lane or its light pair. */
export function themeColours(shown: ShownTheme, prefersLight = false): ThemeColours {
  if (shown.kind === "generated") return shown.colours;
  const id = shown.kind === "builtin" ? shown.id : prefersLight ? themes[defaultTheme].pair! : defaultTheme;
  return themes[id as keyof typeof themes].colours;
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** `a` over `b` at weight `w` (0 to 1), in sRGB as CSS color-mix(in srgb) does; lower-case #rrggbb. */
export function mix(a: string, b: string, w: number): string {
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((v, i) => Math.round(v * w + y[i] * (1 - w)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The plan's colours in a theme. The page's own colours where there is one (floor, area, pipes, racing line,
 * problems); the rest are blends, so they follow the theme: the carpet a little of the personal-best green over the
 * raised surface, jumps the warning colour, obstacles the danger colour. Keep plan-palette.css's defaults in step.
 */
export function planPalette(c: ThemeColours): PlanPalette {
  const h = (v: string) => v.toLowerCase();
  const carpet = mix(c.pb, c.surface, 0.18);
  const jump = mix(c.warning, c.surface2, 0.7);
  // the jump's edges: the page's text or background, whichever stands out on the jump, tinted towards it
  const edge = mix(contrast(c.text, jump) > contrast(c.bg, jump) ? c.text : c.bg, jump, 0.85);
  return {
    "plan-floor": h(c.bg),
    "plan-area": h(c.surface),
    "plan-carpet": carpet,
    "plan-pipe": h(c.text),
    "plan-pipe-shared": h(c.muted),
    "plan-line": h(c.accent),
    "plan-jump": jump,
    "plan-jump-edge": edge,
    // traffic-cone orange in every theme, with a dark edge and number (#157)
    "plan-cone": PLAN_PALETTE["plan-cone"],
    "plan-cone-edge": PLAN_PALETTE["plan-cone-edge"],
    "plan-rostrum": mix(c.muted, c.surface, 0.45),
    "plan-obstacle": mix(c.danger, c.surface, 0.5),
    "plan-grid": `${h(c.text)}1a`,
    "plan-grid-major": `${h(c.text)}33`,
    "plan-error": h(c.danger),
    "plan-warning": h(c.warning),
  };
}

const PaletteCtx = createContext<PlanPalette | null>(null);

/** The plan palette for the theme on show; outside a ThemeProvider (tests), Pit Lane's. */
export function usePlanPalette(): PlanPalette {
  return useContext(PaletteCtx) ?? DEFAULT_PALETTE;
}
const DEFAULT_PALETTE = planPalette(themes[defaultTheme].colours);

function usePrefersLight(): boolean {
  const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(LIGHT_QUERY) : null;
  const [light, setLight] = useState(() => !!query?.matches);
  useEffect(() => {
    if (!query) return;
    const on = () => setLight(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query?.media]); // eslint-disable-line react-hooks/exhaustive-deps
  return light;
}

/** Shows `theme` (see chooseTheme): data-theme on <html>, the --plan-* variables, and the palette for the plan and 3D. */
export function ThemeProvider({ theme, children }: { theme: ThemeChoice | undefined; children: ReactNode }) {
  const light = usePrefersLight();
  const key = JSON.stringify(theme ?? null); // a new /api/me object with the same choice changes nothing
  const shown = useMemo(() => shownTheme(theme, light), [key, light]); // eslint-disable-line react-hooks/exhaustive-deps
  const palette = useMemo(() => planPalette(themeColours(shown, light)), [shown, light]);
  useEffect(() => applyTheme(shown), [shown]);
  useEffect(() => {
    const style = document.documentElement.style;
    for (const [k, v] of Object.entries(palette)) style.setProperty(`--${k}`, v);
  }, [palette]);
  return <PaletteCtx.Provider value={palette}>{children}</PaletteCtx.Provider>;
}
