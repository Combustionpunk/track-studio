// Quick mode jump palette (#15): which jumps each mode offers, place / move / delete as one undo step each, and the
// corner warning on the jump.
import { bakeBuilt, type CheckLevel, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { draftFromDoc, SelectionPanel } from "../src/designer/Designer.js";
import { liveGeometry } from "../src/designer/geometry.js";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import { JumpPalette } from "../src/designer/JumpPalette.js";
import { addJump, checkCounts, deleteJump, FEATURE_TYPES, jumpsInCorner, moveJump, paletteJumps, QUICK_JUMPS } from "../src/designer/mode.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;

describe("which jumps each mode offers", () => {
  it("Quick: tabletop, double, kicker, whoops and crossover (#51: the usual way to bridge a crossing)", () => {
    expect(paletteJumps("quick")).toEqual(["tabletop", "double", "kicker", "whoops", "crossover"]);
    expect(QUICK_JUMPS).toEqual(paletteJumps("quick"));
  });
  it("step-up, step-down and bump only in Advanced, which has all eight", () => {
    for (const t of ["stepup", "stepdown", "bump"] as const) {
      expect(paletteJumps("quick")).not.toContain(t);
      expect(paletteJumps("advanced")).toContain(t);
    }
    expect(paletteJumps("advanced")).toEqual(FEATURE_TYPES);
  });
});

describe("the palette", () => {
  const html = (mode: "quick" | "advanced", armed: string | null = null) =>
    renderToStaticMarkup(<JumpPalette jumps={paletteJumps(mode)} armed={armed as never} onPick={() => {}} />);

  it("one button per jump, each with its plan symbol and a plain label", () => {
    const h = html("quick");
    expect(h.match(/<button/g)).toHaveLength(5);
    expect(h.match(/<svg[^>]*class="jump-symbol"/g)).toHaveLength(5);
    expect(h.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(5);
    for (const l of ["Tabletop", "Double", "Kicker", "Whoops", "Crossover"]) expect(h).toContain(`${l}</button>`);
    expect(h).not.toContain("Step-up");
  });
  it("Advanced lists all eight", () => {
    for (const l of ["Step-up", "Step-down", "Bump"]) expect(html("advanced")).toContain(`${l}</button>`);
  });
  it("the armed jump is pressed, the others are not", () => {
    const h = html("quick", "kicker");
    expect(h.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(h).toMatch(/aria-pressed="true"[^>]*>.*?Kicker<\/button>/);
  });
  it("symbols are drawn in the plan palette, not literal colours", () => {
    expect(html("advanced")).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe("place, move and delete", () => {
  it("a placed jump has type and distance only: no length or height", () => {
    const { features, index } = addJump([{ type: "double", distance: 3, length: 3 }], "tabletop", 12.5);
    expect(index).toBe(1);
    expect(features[1]).toEqual({ type: "tabletop", distance: 12.5 });
    expect(Object.keys(features[1]).sort()).toEqual(["distance", "type"]);
    expect(features[0]).toEqual({ type: "double", distance: 3, length: 3 });
  });
  it("moving changes only the distance; deleting removes only that jump", () => {
    const f = [{ type: "kicker" as const, distance: 1 }, { type: "whoops" as const, distance: 9, height: 0.06 }];
    expect(moveJump(f, 1, 4)).toEqual([f[0], { type: "whoops", distance: 4, height: 0.06 }]);
    expect(deleteJump(f, 0)).toEqual([f[1]]);
    expect(f).toHaveLength(2); // untouched
  });

  it("each is one undo step, including a whole drag", () => {
    type Doc = { features: ReturnType<typeof addJump>["features"] };
    let h: HistoryState<Doc> = { past: [], present: { features: [] }, future: [], group: null, at: 0, travels: 0 };
    const set = (next: Doc, group?: string, now = 1000) => (h = historyReducer(h, { type: "set", next, group, now }));
    set({ features: addJump(h.present.features, "tabletop", 5).features });
    expect(h.past).toHaveLength(1);
    // a drag: many moves in one group
    for (let k = 1; k <= 20; k++) set({ features: moveJump(h.present.features, 0, 5 + k * 0.1) }, "drag:feature:1", 1000 + k * 500);
    expect(h.past).toHaveLength(2);
    expect(h.present.features[0].distance).toBeCloseTo(7);
    set({ features: deleteJump(h.present.features, 0) });
    expect(h.past).toHaveLength(3);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.features[0].distance).toBeCloseTo(7);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.features[0].distance).toBe(5);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.features).toEqual([]);
  });
});

describe("the corner warning on the jump", () => {
  const t = ref<RcTrack>("examples/club-a.rctrack.json");
  const bake = (features: RcTrack["design"]["features"]) => bakeBuilt({ ...t, design: { ...t.design, features } });
  // Known places round club-a's lap, each well inside a run of the same result for tabletops and kickers
  // (found by trying every 1.5 m). A handful keeps this fast on one slow core: each bake is a full bake.
  const CORNERS = [19.5, 75, 103.5];
  const STRAIGHTS = [64.5, 94.5, 115];
  it("a jump dropped into a corner is flagged; one on a straight is not", () => {
    for (const d of [...CORNERS, ...STRAIGHTS]) {
      const b = bake([{ type: "tabletop", distance: d }]);
      const inCorner = b.checks.some((c) => c.code === "feature-in-corner");
      expect(jumpsInCorner(b.checks, b.features).has(0)).toBe(inCorner);
      expect(inCorner, `tabletop at ${d} m`).toBe(CORNERS.includes(d));
    }
  });
  it("with several jumps, only the one in the corner is flagged", () => {
    const b = bake([{ type: "kicker", distance: STRAIGHTS[1] }, { type: "kicker", distance: CORNERS[0] }]);
    expect([...jumpsInCorner(b.checks, b.features).keys()]).toEqual([1]);
  });
  it("a jump in a corner is info (a technical section); a crossover's ramps in one are a warning (rctrack 1.8)", () => {
    const jump = bake([{ type: "tabletop", distance: CORNERS[0] }]);
    expect(jumpsInCorner(jump.checks, jump.features).get(0)).toBe("info");
    const bridge = bake([{ type: "crossover", distance: CORNERS[0] }]);
    expect(jumpsInCorner(bridge.checks, bridge.features).get(0)).toBe("warning");
  });
  it("a jump in a corner adds no warning or error, so submit and the library's counts ignore it", () => {
    const b = bake([{ type: "tabletop", distance: CORNERS[0] }]);
    expect(b.checks.filter((c) => c.level !== "info")).toEqual(bake([]).checks.filter((c) => c.level !== "info"));
    expect(checkCounts(b.checks)).toEqual(checkCounts(bake([]).checks));
  });
  it("a warning on a jump wins over a note just as close", () => {
    const at = (level: "info" | "warning") => ({ level, code: "feature-in-corner" as const, x: 0, z: 0, message: "" });
    expect(jumpsInCorner([at("warning"), at("info")], [{ x: 0, z: 0 }]).get(0)).toBe("warning");
    expect(jumpsInCorner([at("info"), at("warning")], [{ x: 0, z: 0 }]).get(0)).toBe("warning");
  });
  it("other warnings near a jump don't count", () => {
    expect(jumpsInCorner([{ level: "warning", code: "tight-corner", x: 0, z: 0, message: "" }], [{ x: 0, z: 0 }]).size).toBe(0);
  });
});

describe("the selected jump's panel", () => {
  const t = ref<RcTrack>("examples/club-a.rctrack.json");
  const doc = (type: "kicker" | "crossover") => draftFromDoc({ ...t, design: { ...t.design, features: [{ type, distance: 4 }] } });
  const draft = doc("kicker");
  const panel = (view: "quick" | "advanced", inCorner: [number, CheckLevel][], d = draft) =>
    renderToStaticMarkup(
      <SelectionPanel sel={{ kind: "feature", i: 0 }} view={view} draft={d} live={liveGeometry(d.design)} update={() => {}} onDelete={() => {}} inCorner={new Map(inCorner)} />,
    );

  it("notes a jump on or landing into a corner as a technical section, in both modes, after the Delete button", () => {
    for (const view of ["quick", "advanced"] as const) {
      const h = panel(view, [[0, "info"]]);
      expect(h).toContain("This kicker is on or lands into a corner: a technical section.");
      expect(h).toContain("sel-note");
      expect(h).not.toContain("sel-warning");
      expect(h).not.toContain("Slide it onto a straight");
      expect(h.indexOf("Delete kicker")).toBeLessThan(h.indexOf("sel-note"));
    }
  });
  it("warns when a crossover's ramps are on or land into a corner", () => {
    const h = panel("quick", [[0, "warning"]], doc("crossover"));
    expect(h).toContain("sel-warning");
    expect(h).toContain("This crossover is on or lands into a corner. Slide it onto a straight.");
  });
  it("says nothing otherwise, but keeps the status region so the note is announced when it appears", () => {
    const h = panel("quick", []);
    expect(h).not.toContain("corner");
    expect(h).toContain('role="status"');
  });
  it("Quick: a Delete button and no sizing; Advanced: length and height", () => {
    expect(panel("quick", [])).toContain("Delete kicker");
    expect(panel("quick", [])).not.toMatch(/Length|Height/);
    expect(panel("advanced", [])).toMatch(/Length[\s\S]*Height/);
  });
});
