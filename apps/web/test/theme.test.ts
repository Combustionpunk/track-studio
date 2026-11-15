// The member's theme (#135): data-theme on <html> from the member's choice, then the club's, then none (the brand's
// CSS gives Pit Lane, or Pit Lane light when the device asks for light). The plan and the 3D view take their colours
// from the theme, and must read in every theme.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, themeIds, themes } from "@rcmisfits/brand";
import { PLAN_PALETTE } from "@track-studio/engine";
import { describe, expect, it } from "vitest";
import { applyTheme, chooseTheme, mix, planPalette, themeColours } from "../src/lib/theme.js";
import { buildScene, partColours, rostrumMeshes } from "../src/viewer3d/scene.js";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("chooseTheme", () => {
  it("the member's own theme first, then the club's, then none (Pit Lane)", () => {
    expect(chooseTheme("synthwave", "ice")).toBe("synthwave");
    expect(chooseTheme(null, "ice")).toBe("ice");
    expect(chooseTheme(undefined, undefined)).toBeUndefined();
  });

  it("skips a value that isn't one of the brand's themes (an older or newer list, 'auto', a typo)", () => {
    expect(chooseTheme("auto", "garage")).toBe("garage");
    expect(chooseTheme("no-such-theme", null)).toBeUndefined();
    expect(chooseTheme("", "")).toBeUndefined();
    expect(chooseTheme("__proto__", "toString")).toBeUndefined();
  });

  it("knows every brand theme", () => {
    for (const id of themeIds) expect(chooseTheme(id, null)).toBe(id);
  });
});

describe("applyTheme", () => {
  const el = () => ({ dataset: {} as Record<string, string | undefined> });

  it("sets data-theme for a theme, and removes it for none so the CSS default (and the device's light or dark) applies", () => {
    const root = el();
    applyTheme("ice", root);
    expect(root.dataset.theme).toBe("ice");
    applyTheme(undefined, root);
    expect("theme" in root.dataset).toBe(false);
  });
});

describe("themeColours", () => {
  it("is the chosen theme's colours", () => {
    expect(themeColours("synthwave", false)).toEqual(themes.synthwave.colours);
    expect(themeColours("ice", false)).toEqual(themes.ice.colours);
  });

  it("with no theme: Pit Lane, or Pit Lane light when the device asks for light", () => {
    expect(themeColours(undefined, false)).toEqual(themes["pit-lane"].colours);
    expect(themeColours(undefined, true)).toEqual(themes["pit-lane-light"].colours);
    // a chosen theme wins whatever the device asks for
    expect(themeColours("garage", true)).toEqual(themes.garage.colours);
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

describe("plan-palette.css", () => {
  const css = readFileSync(join(WEB, "src/theme/plan-palette.css"), "utf8");

  it("has a default for every plan colour the app sets from the theme", () => {
    for (const k of Object.keys(PLAN_PALETTE)) expect(css).toMatch(new RegExp(`--${k}:\\s*[^;]*var\\(--rm-`));
  });
});
