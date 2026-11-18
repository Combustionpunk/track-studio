// The member's theme (#135). The brand package (@rcmisfits/brand) gives every colour as --rm-* variables for the theme
// named by data-theme on <html>; with none, its CSS is Pit Lane, or Pit Lane light when the device asks for light.
// The order every RC Misfits site uses: the signed-in member's own theme, then the club's, then Pit Lane.
//
// The plan and the 3D view are drawn with colours rather than CSS, so they take a palette made here from the theme's
// colours (planPalette); the same palette is written to the --plan-* variables for what the app draws over the plan.
import { contrast, defaultTheme, themeIds, themes, type ThemeColours } from "@rcmisfits/brand";
import { PLAN_PALETTE, type PlanPalette } from "@track-studio/engine";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KNOWN = new Set<string>(themeIds);
const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** The theme to show: the member's, else the club's, else undefined (Pit Lane, following the device's light or dark). */
export function chooseTheme(member: string | null | undefined, club: string | null | undefined): string | undefined {
  return [member, club].find((t): t is string => typeof t === "string" && KNOWN.has(t));
}

/** Puts the theme on <html> (or `root`); none removes it, so the brand's default applies. */
export function applyTheme(theme: string | undefined, root: { dataset: DOMStringMap | Record<string, string | undefined> } = document.documentElement): void {
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** The colours shown for `theme` (as chooseTheme gives it): with none, Pit Lane or its light pair. */
export function themeColours(theme: string | undefined, prefersLight: boolean): ThemeColours {
  const id = theme && KNOWN.has(theme) ? theme : prefersLight ? themes[defaultTheme].pair! : defaultTheme;
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
    "plan-cone": PLAN_PALETTE["plan-cone"], // traffic-cone orange in every theme (#157)
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
export function ThemeProvider({ theme, children }: { theme: string | undefined; children: ReactNode }) {
  const light = usePrefersLight();
  const palette = useMemo(() => planPalette(themeColours(theme, light)), [theme, light]);
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const style = document.documentElement.style;
    for (const [k, v] of Object.entries(palette)) style.setProperty(`--${k}`, v);
  }, [palette]);
  return <PaletteCtx.Provider value={palette}>{children}</PaletteCtx.Provider>;
}
