// The member's theme (#135): data-theme on <html> from the member's choice, then the club's, then none (the brand's
// CSS gives Pit Lane, or Pit Lane light when the device asks for light). The plan and the 3D view take their colours
// from the theme, and must read in every theme.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, generateTheme, themeIds, themes } from "@rcmisfits/brand";
import { PLAN_PALETTE } from "@track-studio/engine";
import { describe, expect, it } from "vitest";
import { applyTheme, chooseTheme, GENERATED_STYLE_ID, GENERATED_THEME_ID, memberThemePick, mix, planPalette, shownTheme, themeColours } from "../src/lib/theme.js";
import { buildScene, partColours, rostrumMeshes } from "../src/viewer3d/scene.js";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The forum's body for a member (#141, plugin #457). */
const forum = (theme: string | null, mode = "auto", more: { dark_theme?: string | null; colours?: string[] } = {}) => ({
  theme,
  dark_theme: null,
  mode,
  colours: [],
  brand_version: "0.5.0",
  ...more,
});
const WB = { dark_theme: "works-blue" };

describe("memberThemePick: the forum's answer (#141)", () => {
  it("no answer, not that object, or theme: null: no choice of their own (the club's applies)", () => {
    for (const v of [undefined, null, "synthwave", [], {}, forum(null), forum("")]) expect(memberThemePick(v)).toEqual({ chosen: false });
  });

  it("a brand palette held to light or dark; dark uses dark_theme", () => {
    expect(memberThemePick(forum("works-blue-light", "light", WB))).toEqual({ chosen: true, choice: "works-blue-light" });
    expect(memberThemePick(forum("works-blue-light", "dark", WB))).toEqual({ chosen: true, choice: "works-blue" });
  });

  it("auto follows the device between theme (light) and dark_theme (dark)", () => {
    expect(memberThemePick(forum("works-blue-light", "auto", WB))).toEqual({ chosen: true, choice: { light: "works-blue-light", dark: "works-blue" } });
    // no mode (an older body) is auto
    expect(memberThemePick({ theme: "works-blue-light", dark_theme: "works-blue" })).toEqual({ chosen: true, choice: { light: "works-blue-light", dark: "works-blue" } });
  });

  it("dark_theme null: theme in both modes", () => {
    expect(memberThemePick(forum("synthwave", "dark"))).toEqual({ chosen: true, choice: "synthwave" });
    expect(memberThemePick(forum("synthwave", "light"))).toEqual({ chosen: true, choice: "synthwave" });
    expect(memberThemePick(forum("synthwave", "auto"))).toEqual({ chosen: true, choice: "synthwave" });
  });

  it("an id Track Studio doesn't know is Pit Lane in that mode", () => {
    expect(memberThemePick(forum("a-newer-palette", "light"))).toEqual({ chosen: true, choice: "pit-lane-light" });
    expect(memberThemePick(forum("a-newer-palette", "dark"))).toEqual({ chosen: true, choice: "pit-lane" });
    expect(memberThemePick(forum("synthwave-light", "auto", { dark_theme: "a-newer-palette" }))).toEqual({ chosen: true, choice: { light: "synthwave-light", dark: "pit-lane" } });
    expect(memberThemePick(forum("a-newer-palette", "auto", { dark_theme: "garage" }))).toEqual({ chosen: true, choice: { light: "pit-lane-light", dark: "garage" } });
    // both unknown under auto: Pit Lane by device
    expect(memberThemePick(forum("__proto__", "auto"))).toEqual({ chosen: true, choice: undefined });
  });

  it("Match my car: the member's colours, held to the mode (auto follows the device)", () => {
    const colours = ["#E6FF00", "#111111"];
    expect(memberThemePick(forum("match-my-car", "dark", { colours }))).toEqual({ chosen: true, choice: { colours, mode: "dark" } });
    expect(memberThemePick(forum("match-my-car", "light", { colours }))).toEqual({ chosen: true, choice: { colours, mode: "light" } });
    expect(memberThemePick(forum("match-my-car", "auto", { colours }))).toEqual({ chosen: true, choice: { colours } });
    // race colour keys are taken too; only the first three count
    expect(memberThemePick(forum("match-my-car", "dark", { colours: ["black", "#ff0000", "#00ff00", "#0000ff"] }))).toEqual({
      chosen: true,
      choice: { colours: ["#111111", "#ff0000", "#00ff00"], mode: "dark" },
    });
    // no usable colours: Pit Lane in that mode
    expect(memberThemePick(forum("match-my-car", "light", { colours: [] }))).toEqual({ chosen: true, choice: "pit-lane-light" });
    expect(memberThemePick(forum("match-my-car", "dark", { colours: ["burnt-sienna"] }))).toEqual({ chosen: true, choice: "pit-lane" });
  });
});

describe("chooseTheme", () => {
  it("the member's own theme first, then the club's, then none (Pit Lane)", () => {
    expect(chooseTheme(forum("synthwave", "dark"), "ice")).toBe("synthwave");
    expect(chooseTheme(forum(null), "ice")).toBe("ice");
    expect(chooseTheme(undefined, "ice")).toBe("ice");
    expect(chooseTheme(undefined, undefined)).toBeUndefined();
    expect(chooseTheme(forum(null), undefined)).toBeUndefined();
  });

  it("skips a club value that isn't one of the brand's themes", () => {
    expect(chooseTheme(null, "no-such-theme")).toBeUndefined();
    expect(chooseTheme(null, "")).toBeUndefined();
    expect(chooseTheme(null, "toString")).toBeUndefined();
  });

  it("knows every brand theme", () => {
    for (const id of themeIds) expect(chooseTheme(forum(id, "dark"), null)).toBe(id);
  });
});

describe("shownTheme and themeColours", () => {
  it("a built-in id is that theme, whatever the device", () => {
    expect(shownTheme("synthwave", true)).toEqual({ kind: "builtin", id: "synthwave" });
    expect(themeColours(shownTheme("ice", false))).toEqual(themes.ice.colours);
    expect(themeColours(shownTheme("garage", true))).toEqual(themes.garage.colours);
  });

  it("a light and dark pair follows the device", () => {
    const pair = { light: "works-blue-light", dark: "works-blue" };
    expect(shownTheme(pair, true)).toEqual({ kind: "builtin", id: "works-blue-light" });
    expect(shownTheme(pair, false)).toEqual({ kind: "builtin", id: "works-blue" });
  });

  it("Match my car is the brand package's own generator, held to its mode or following the device", () => {
    const colours = ["#E6FF00", "#111111"];
    expect(shownTheme({ colours, mode: "dark" }, true)).toEqual({ kind: "generated", colours: generateTheme(colours, "dark") });
    expect(shownTheme({ colours, mode: "light" }, false)).toEqual({ kind: "generated", colours: generateTheme(colours, "light") });
    expect(shownTheme({ colours }, true)).toEqual({ kind: "generated", colours: generateTheme(colours, "light") });
    expect(shownTheme({ colours }, false)).toEqual({ kind: "generated", colours: generateTheme(colours, "dark") });
    expect(themeColours(shownTheme({ colours, mode: "dark" }, true))).toEqual(generateTheme(colours, "dark"));
  });

  it("colours the generator refuses: Pit Lane by device", () => {
    expect(shownTheme({ colours: ["not-a-colour"] }, false)).toEqual({ kind: "default" });
  });

  it("with no theme: Pit Lane, or Pit Lane light when the device asks for light", () => {
    expect(shownTheme(undefined, true)).toEqual({ kind: "default" });
    expect(themeColours(shownTheme(undefined, false))).toEqual(themes["pit-lane"].colours);
    expect(themeColours(shownTheme(undefined, true), true)).toEqual(themes["pit-lane-light"].colours);
  });
});

describe("applyTheme", () => {
  function fakeDoc() {
    const styles = new Map<string, { id: string; textContent: string | null; remove(): void }>();
    return {
      styles,
      documentElement: { dataset: {} as Record<string, string | undefined> },
      getElementById: (id: string) => styles.get(id) ?? null,
      createElement: () => {
        const el = { id: "", textContent: null as string | null, remove: () => styles.delete(el.id) };
        return el;
      },
      head: { appendChild: (el: { id: string; textContent: string | null; remove(): void }) => styles.set(el.id, el) },
    };
  }

  it("sets data-theme for a built-in theme, and removes it for none so the CSS default (and the device's light or dark) applies", () => {
    const doc = fakeDoc();
    applyTheme({ kind: "builtin", id: "ice" }, doc);
    expect(doc.documentElement.dataset.theme).toBe("ice");
    applyTheme({ kind: "default" }, doc);
    expect("theme" in doc.documentElement.dataset).toBe(false);
  });

  it("a generated theme goes in its own style element, under its own data-theme; taken out again after", () => {
    const doc = fakeDoc();
    const colours = generateTheme(["#E6FF00"], "dark");
    applyTheme({ kind: "generated", colours }, doc);
    expect(doc.documentElement.dataset.theme).toBe(GENERATED_THEME_ID);
    const css = doc.getElementById(GENERATED_STYLE_ID)!.textContent!;
    expect(css).toContain(`[data-theme="${GENERATED_THEME_ID}"]`);
    expect(css).toContain(`--rm-accent: ${colours.accent}`);
    expect(css).toContain("color-scheme: dark");
    applyTheme({ kind: "builtin", id: "garage" }, doc);
    expect(doc.getElementById(GENERATED_STYLE_ID)).toBeNull();
    expect(doc.documentElement.dataset.theme).toBe("garage");
  });
});

describe("mix", () => {
  it("blends two hex colours in sRGB", () => {
    expect(mix("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(mix("#FF0000", "#0000FF", 1)).toBe("#ff0000");
    expect(mix("#ff0000", "#0000ff", 0)).toBe("#0000ff");
  });
});

/** An #rrggbbaa colour laid over an opaque one. */
const over = (top: string, under: string) => (top.length === 9 ? mix(top.slice(0, 7), under, parseInt(top.slice(7), 16) / 255) : top);

describe.each(themeIds)("the plan in %s", (id) => {
  const c = themes[id].colours;
  const p = planPalette(c);

  it("has every colour role, as hex the renderer can draw", () => {
    expect(Object.keys(p).sort()).toEqual(Object.keys(PLAN_PALETTE).sort());
    for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
  });

  it("the track reads: carpet on the area, pipes and the racing line on the carpet (3:1, WCAG non-text)", () => {
    expect(contrast(p["plan-carpet"], p["plan-area"])).toBeGreaterThanOrEqual(1.15);
    expect(contrast(p["plan-area"], p["plan-floor"])).toBeGreaterThanOrEqual(1.05);
    expect(contrast(p["plan-pipe"], p["plan-carpet"])).toBeGreaterThanOrEqual(3);
    expect(contrast(p["plan-pipe"], p["plan-area"])).toBeGreaterThanOrEqual(3);
    expect(contrast(p["plan-line"], p["plan-carpet"])).toBeGreaterThanOrEqual(3);
    expect(contrast(p["plan-pipe-shared"], p["plan-carpet"])).toBeGreaterThanOrEqual(1.5);
  });

  it("jumps, their edges, obstacles and the rostrum stand out", () => {
    expect(contrast(p["plan-jump"], p["plan-carpet"])).toBeGreaterThanOrEqual(1.5);
    expect(contrast(p["plan-jump-edge"], p["plan-jump"])).toBeGreaterThanOrEqual(3);
    // cones (#157): traffic-cone orange in every theme, with a dark outline and number that read on it
    expect(p["plan-cone"]).toBe(PLAN_PALETTE["plan-cone"]);
    expect(p["plan-cone-edge"]).toBe(PLAN_PALETTE["plan-cone-edge"]);
    expect(contrast(p["plan-cone-edge"], p["plan-cone"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p["plan-obstacle"], p["plan-area"])).toBeGreaterThanOrEqual(1.3);
    expect(contrast(p["plan-rostrum"], p["plan-floor"])).toBeGreaterThanOrEqual(1.5);
    expect(contrast(p["plan-pipe"], p["plan-rostrum"])).toBeGreaterThanOrEqual(1.5);
  });

  it("problems show on the carpet and the area", () => {
    for (const k of ["plan-error", "plan-warning"] as const) {
      expect(contrast(p[k], p["plan-carpet"])).toBeGreaterThanOrEqual(3);
      expect(contrast(p[k], p["plan-area"])).toBeGreaterThanOrEqual(3);
    }
  });

  it("the grid is faint but there, the major lines stronger", () => {
    const minor = contrast(over(p["plan-grid"], p["plan-area"]), p["plan-area"]);
    const major = contrast(over(p["plan-grid-major"], p["plan-area"]), p["plan-area"]);
    expect(minor).toBeGreaterThanOrEqual(1.1);
    expect(major).toBeGreaterThan(minor);
  });

  it("comes from the theme's own colours", () => {
    expect(p["plan-floor"]).toBe(c.bg.toLowerCase());
    expect(p["plan-area"]).toBe(c.surface.toLowerCase());
    expect(p["plan-pipe"]).toBe(c.text.toLowerCase());
    expect(p["plan-line"]).toBe(c.accent.toLowerCase());
  });

  it("the 3D view uses the same colours", () => {
    const parts = partColours(p);
    expect(parts.carpet).toBe(p["plan-carpet"]);
    expect(parts.pipe).toBe(p["plan-pipe"]);
    expect(parts.line).toBe(p["plan-line"]);
    expect(parts.area).toBe(p["plan-area"]);
  });
});

describe("the 3D scene in a theme", () => {
  const doc = JSON.parse(readFileSync(join(WEB, "../../reference/examples/club-a.rctrack.json"), "utf8"));
  const area = { length: doc.area.length, width: doc.area.width };

  it("paints every mesh and the background from the palette it's given (the fixed plan palette by default)", () => {
    const ice = planPalette(themes.ice.colours);
    const scene = buildScene({ area, built: doc.built, palette: ice });
    expect(scene.background).toBe(ice["plan-floor"]);
    const parts = partColours(ice);
    for (const m of scene.meshes) expect(m.colour).toBe(parts[m.part]);
    for (const m of rostrumMeshes(area, "south", ice)) expect(m.colour).toBe(parts[m.part]);
    expect(buildScene({ area, built: doc.built }).background).toBe(PLAN_PALETTE["plan-floor"]);
  });
});

describe("light and dark themes in the app's CSS", () => {
  const tokens = readFileSync(join(WEB, "src/theme/tokens.css"), "utf8");
  const planCss = readFileSync(join(WEB, "src/theme/plan-palette.css"), "utf8");
  /** a variable's light-dark(light, dark) halves */
  const halves = (css: string, name: string) => {
    const m = new RegExp(`--${name}: light-dark\\((.*)\\);`).exec(css);
    if (!m) throw new Error(`--${name} is not light-dark(…)`);
    // split at the comma outside any brackets
    let depth = 0;
    const at = [...m[1]].findIndex((ch) => ((depth += ch === "(" ? 1 : ch === ")" ? -1 : 0), ch === "," && depth === 0));
    return { light: m[1].slice(0, at).trim(), dark: m[1].slice(at + 1).trim() };
  };
  /** color-mix(in srgb, var(--rm-a) N%, var(--rm-b)) in a theme */
  const mixIn = (expr: string, c: Record<string, string>) => {
    const m = /^color-mix\(in srgb, var\(--rm-([\w-]+)\) (\d+)%, var\(--rm-([\w-]+)\)\)$/.exec(expr);
    if (!m) throw new Error(`can't read ${expr}`);
    const key = (k: string) => k.replace(/-(\w)/g, (_, ch: string) => ch.toUpperCase());
    return mix(c[key(m[1])], c[key(m[3])], Number(m[2]) / 100);
  };

  it.each(themeIds)("accent text on the accent-soft fill reaches 4.5:1 in %s", (id) => {
    const { light, dark } = halves(tokens, "accent-soft");
    const c = themes[id].colours as unknown as Record<string, string>;
    expect(contrast(c.accent, mixIn(themes[id].mode === "light" ? light : dark, c))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themeIds.filter((id) => themes[id].mode === "light"))("the designer's guides and mitre handles show on the carpet and the area in %s (3:1)", (id) => {
    const c = themes[id].colours as unknown as Record<string, string>;
    const p = planPalette(themes[id].colours);
    for (const name of ["ed-guide", "ed-mitre"]) {
      const v = /^var\(--rm-([\w-]+)\)$/.exec(halves(planCss, name).light)![1];
      for (const under of [p["plan-carpet"], p["plan-area"]]) expect(contrast(c[v], under), `${name} ${v}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("plan-palette.css", () => {
  const css = readFileSync(join(WEB, "src/theme/plan-palette.css"), "utf8");

  it("has a default for every plan colour the app sets from the theme", () => {
    // all from the theme, but the cone: traffic-cone orange in every theme (#157)
    for (const k of Object.keys(PLAN_PALETTE)) expect(css).toMatch(k.startsWith("plan-cone") ? new RegExp(`--${k}:\\s*${PLAN_PALETTE[k as keyof typeof PLAN_PALETTE]};`) : new RegExp(`--${k}:\\s*[^;]*var\\(--rm-`));
  });
});
