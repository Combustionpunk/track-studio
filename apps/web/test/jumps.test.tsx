// Quick mode jump palette (#15): which jumps each mode offers, place / move / delete as one undo step each, and the
// corner warning on the jump.
import { bakeBuilt, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import { JumpPalette } from "../src/designer/JumpPalette.js";
import { addJump, deleteJump, FEATURE_TYPES, jumpsInCorner, moveJump, paletteJumps, QUICK_JUMPS } from "../src/designer/mode.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;

describe("which jumps each mode offers", () => {
  it("Quick: tabletop, double, kicker and whoops", () => {
    expect(paletteJumps("quick")).toEqual(["tabletop", "double", "kicker", "whoops"]);
    expect(QUICK_JUMPS).toEqual(paletteJumps("quick"));
  });
  it("step-up, step-down and bump only in Advanced, which has all seven", () => {
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
    expect(h.match(/<button/g)).toHaveLength(4);
    expect(h.match(/<svg[^>]*class="jump-symbol"/g)).toHaveLength(4);
    expect(h.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(4);
    for (const l of ["Tabletop", "Double", "Kicker", "Whoops"]) expect(h).toContain(`${l}</button>`);
    expect(h).not.toContain("Step-up");
  });
  it("Advanced lists all seven", () => {
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
    let h: HistoryState<Doc> = { past: [], present: { features: [] }, future: [], group: null, at: 0 };
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
  it("a jump dropped into a corner is flagged; one on a straight is not", () => {
    const built = bake([]);
    // try every half metre for one jump: some places are in corners, some on straights
    const flagged: boolean[] = [];
    for (let d = 0; d < built.lapLength; d += 0.5) {
      const b = bake([{ type: "tabletop", distance: d }]);
      const inCorner = b.checks.some((c) => c.code === "feature-in-corner");
      expect(jumpsInCorner(b.checks, b.features).has(0)).toBe(inCorner);
      flagged.push(inCorner);
    }
    expect(flagged).toContain(true);
    expect(flagged).toContain(false);
  });
  it("with several jumps, only the one in the corner is flagged", () => {
    const at = (d: number) => bake([{ type: "kicker", distance: d }]).checks.some((c) => c.code === "feature-in-corner");
    const lap = bake([]).lapLength;
    const ds = Array.from({ length: Math.floor(lap) }, (_, k) => k);
    const bad = ds.find(at)!, good = ds.find((d) => !at(d) && Math.abs(d - bad) > 3)!;
    const b = bake([{ type: "kicker", distance: good }, { type: "kicker", distance: bad }]);
    expect([...jumpsInCorner(b.checks, b.features)]).toEqual([1]);
  });
  it("other warnings near a jump don't count", () => {
    expect(jumpsInCorner([{ level: "warning", code: "tight-corner", x: 0, z: 0, message: "" }], [{ x: 0, z: 0 }]).size).toBe(0);
  });
});
