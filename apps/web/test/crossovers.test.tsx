// Crossovers in the designer (#51): the palette, placing one on a crossing, swap over / under, Quick and Advanced
// panels, the hints on crossing checks, "Make it a crossover", and the start line keeping each bridge on its pass.
import { bakeBuilt, type Check, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChecksPanel, draftFromDoc, SelectionPanel, type Draft } from "../src/designer/Designer.js";
import { addCrossover, bridgeAt, crossingHint, makeCrossover, moveStart, swapOver } from "../src/designer/crossings.js";
import { liveGeometry } from "../src/designer/geometry.js";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import { JumpPalette } from "../src/designer/JumpPalette.js";
import { deleteJump, FEATURE_TYPES, moveJump, paletteJumps } from "../src/designer/mode.js";

const EXTRA = join(__dirname, "../../../packages/engine/test/fixtures/extra");
const fixture = (name: string) => JSON.parse(readFileSync(join(EXTRA, `${name}.rctrack.json`), "utf8")) as RcTrack;
const withFeatures = (doc: RcTrack, features: RcTrack["design"]["features"], start = doc.design.start): RcTrack => ({ ...doc, design: { ...doc.design, features, start } });
const errors = (doc: RcTrack) => bakeBuilt(doc).checks.filter((c) => c.level === "error").map((c) => c.code);

// the figure of eight: 2 m lanes crossing square at (0, 0), the first pass at 9.042 m, the second at 44.596 m (start 2 m)
const eight = fixture("unbridged-figure8");
const [FIRST, SECOND] = eight.built!.crossings![0].distances;

describe("the palette", () => {
  it("offers Crossover in Quick and in Advanced", () => {
    expect(paletteJumps("quick")).toContain("crossover");
    expect(paletteJumps("advanced")).toContain("crossover");
    expect(FEATURE_TYPES).toHaveLength(8);
  });
  it("with its own jump-style symbol, not the tabletop's", () => {
    const h = renderToStaticMarkup(<JumpPalette jumps={["tabletop", "crossover"]} armed={null} onPick={() => {}} />);
    const [tabletop, crossover] = [...h.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    expect(crossover).not.toBe(tabletop);
    expect(h).toContain("Crossover</button>");
    expect(h).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe("live geometry places crossovers as the bake does", () => {
  it.each(["crossover-figure8", "tabletop-figure8", "two-crossings", "crossover-low-figure8", "crossover-unused-figure8", "unbridged-figure8"])("%s", (name) => {
    const doc = fixture(name);
    const live = liveGeometry(doc.design);
    const b = bakeBuilt(doc);
    expect(live.features).toHaveLength(b.features.length);
    live.features.forEach((f, i) => {
      expect(Math.hypot(f.x - b.features[i].x, f.z - b.features[i].z)).toBeLessThan(0.01);
      expect(f.heading).toBeCloseTo(b.features[i].heading, 2);
      expect(f.length).toBeCloseTo(b.features[i].length, 2);
      expect(f.profile).toEqual(b.features[i].profile);
    });
    expect(live.crossings).toEqual(b.crossings ?? []);
  });
});

describe("placing a crossover", () => {
  const live = liveGeometry(eight.design);
  it("on a crossing snaps to it, over the pass that was clicked; type, distance and over only", () => {
    // clicked 1.2 m along the first pass from the crossing
    const a = addCrossover([], live.crossings, [0.85, 0.85], FIRST + 1.2, live.total);
    expect(a).toEqual({ features: [{ type: "crossover", distance: FIRST, over: "first" }], index: 0 });
    // and on the second pass
    const b = addCrossover([], live.crossings, [-0.85, 0.85], SECOND - 1.2, live.total);
    expect(b.features[0]).toEqual({ type: "crossover", distance: SECOND, over: "second" });
    expect(errors(withFeatures(eight, a.features))).toEqual([]);
    expect(errors(withFeatures(eight, b.features))).toEqual([]);
  });
  it("away from any crossing it stays where it was clicked, still with over written", () => {
    const s = 20;
    const a = addCrossover([{ type: "kicker", distance: 30 }], live.crossings, [9, 5], s, live.total);
    expect(a).toEqual({ features: [{ type: "kicker", distance: 30 }, { type: "crossover", distance: 20, over: "first" }], index: 1 });
  });
});

describe("swap over / under", () => {
  const live = liveGeometry(eight.design);
  it("puts the other pass over, on that pass's side of the crossing", () => {
    const f = [{ type: "crossover" as const, distance: FIRST, over: "first" as const }];
    const swapped = swapOver(f, 0, live.crossings, live.total);
    expect(swapped).toEqual([{ type: "crossover", distance: SECOND, over: "second" }]);
    expect(swapOver(swapped, 0, live.crossings, live.total)).toEqual(f);
    const b = bakeBuilt(withFeatures(eight, swapped));
    expect(b.crossings![0].over).toBe("second");
  });
  it("keeps an Advanced crossover's sizes", () => {
    const f = [{ type: "crossover" as const, distance: FIRST, over: "first" as const, rampLength: 1.5, topLength: 4, height: 0.45 }];
    expect(swapOver(f, 0, live.crossings, live.total)[0]).toEqual({ ...f[0], distance: SECOND, over: "second" });
  });
});

describe("one undo step each: place, move, swap, delete", () => {
  it("history", () => {
    const live = liveGeometry(eight.design);
    type Doc = { features: NonNullable<RcTrack["design"]["features"]> };
    let h: HistoryState<Doc> = { past: [], present: { features: [] }, future: [], group: null, at: 0, travels: 0 };
    const set = (next: Doc, group?: string, now = 1000) => (h = historyReducer(h, { type: "set", next, group, now }));
    set({ features: addCrossover([], live.crossings, [0, 0], FIRST, live.total).features });
    for (let k = 1; k <= 10; k++) set({ features: moveJump(h.present.features, 0, FIRST + k * 0.1) }, "drag:feature:1", 1000 + k * 500);
    set({ features: swapOver(h.present.features, 0, live.crossings, live.total) });
    set({ features: deleteJump(h.present.features, 0) });
    expect(h.past).toHaveLength(4);
    const undo = () => (h = historyReducer(h, { type: "undo" }));
    undo();
    expect(h.present.features[0]).toMatchObject({ over: "second", distance: SECOND });
    undo();
    expect(h.present.features[0]).toMatchObject({ over: "first" });
    expect(h.present.features[0].distance).toBeCloseTo(FIRST + 1, 3);
    undo();
    expect(h.present.features[0]).toEqual({ type: "crossover", distance: FIRST, over: "first" });
    undo();
    expect(h.present.features).toEqual([]);
  });
});

describe("the selected crossover's panel", () => {
  const doc = withFeatures(eight, [{ type: "crossover", distance: FIRST, over: "first" }]);
  const draft = draftFromDoc(doc);
  const panel = (view: "quick" | "advanced", d: Draft = draft) => {
    const edits: Draft[] = [];
    const html = renderToStaticMarkup(
      <SelectionPanel sel={{ kind: "feature", i: 0 }} view={view} draft={d} live={liveGeometry(d.design)} update={(fn) => edits.push(fn(d))} onDelete={() => {}} inCorner={new Set()} />,
    );
    return { html, edits };
  };
  it("Quick: which pass goes over, Swap over/under and Delete; no sizes", () => {
    const { html } = panel("quick");
    expect(html).toContain("Swap over/under");
    expect(html).toContain("Delete crossover");
    expect(html).toMatch(/first pass from the start goes over/i);
    expect(html).not.toMatch(/Ramp length|Top length|Height/);
  });
  it("Advanced: ramp length, top length and height too, with the defaults as placeholders", () => {
    const { html } = panel("advanced");
    expect(html).toContain("Swap over/under");
    expect(html).toMatch(/Ramp length[\s\S]*Top length[\s\S]*Height/);
    expect(html).toContain('placeholder="2"');
    expect(html).toContain('placeholder="0.4"');
    expect(html).not.toMatch(/>Length</);
  });
});

describe("hints on crossing checks", () => {
  const check = (code: Check["code"]): Check => ({ level: "error", code, message: "", x: 0, z: 0 });
  it("an unbridged crossing: add a crossover (or a long tabletop) here", () => {
    expect(crossingHint(check("crossing-unbridged"), null)).toBe("Add a crossover (or a long tabletop) here.");
  });
  it("a tabletop too low to drive under", () => {
    expect(crossingHint(check("crossing-too-low"), "tabletop")).toBe("Too low to drive under: use a Crossover, or raise it to 0.40 m in Advanced.");
    expect(crossingHint(check("crossing-too-low"), "crossover")).toBe("Too low to drive under: raise it to 0.40 m in Advanced.");
    expect(crossingHint(check("tight-corner"), null)).toBeNull();
  });
  it("finds the tabletop or crossover a too-low check is about", () => {
    for (const name of ["tabletop-low-figure8", "crossover-low-figure8"]) {
      const b = fixture(name).built!;
      const c = b.checks.find((k) => k.code === "crossing-too-low")!;
      expect(bridgeAt(c, b.features), name).toBe(0);
    }
    expect(bridgeAt({ ...check("crossing-too-low"), x: 9, z: 6 }, fixture("tabletop-low-figure8").built!.features)).toBeNull();
  });

  const checksPanel = (doc: RcTrack, view: "quick" | "advanced") =>
    renderToStaticMarkup(<ChecksPanel checks={doc.built!.checks} features={doc.built!.features} view={view} pending={false} blocked={null} ready={false} onShow={() => {}} onMakeCrossover={() => {}} />);
  it("the checks list shows them; Quick offers a one-tap Make it a crossover for a low tabletop", () => {
    expect(checksPanel(fixture("unbridged-figure8"), "quick")).toContain("Add a crossover (or a long tabletop) here.");
    const low = fixture("tabletop-low-figure8");
    expect(checksPanel(low, "quick")).toContain("Make it a crossover");
    expect(checksPanel(low, "quick")).toContain("Too low to drive under: use a Crossover, or raise it to 0.40 m in Advanced.");
    expect(checksPanel(low, "advanced")).not.toContain("Make it a crossover");
    expect(checksPanel(fixture("crossover-low-figure8"), "quick")).not.toContain("Make it a crossover");
  });
});

describe("Make it a crossover", () => {
  it("swaps the type and keeps the distance; the crossing is bridged, over the tabletop's pass", () => {
    const doc = fixture("tabletop-low-figure8");
    const live = liveGeometry(doc.design);
    const f = makeCrossover(doc.design.features!, 0, live.crossings, live.total);
    expect(f).toEqual([{ type: "crossover", distance: doc.design.features![0].distance, over: "second" }]);
    expect(errors(withFeatures(doc, f))).toEqual([]);
    expect(bakeBuilt(withFeatures(doc, f)).crossings![0]).toMatchObject({ over: "second", bridge: { type: "crossover", feature: 0 } });
  });
});

describe("moving the start line keeps each bridge on the same pass", () => {
  it("the passes swap names, so a crossover's over is rewritten", () => {
    const doc = withFeatures(eight, [{ type: "crossover", distance: FIRST, over: "first" }]);
    const live = liveGeometry(doc.design);
    const before = bakeBuilt(doc).crossings![0];
    const physical = before.distances[0]; // the first pass is over
    // start just after the first pass: the old second pass is now driven first
    const moved = moveStart(doc.design, live, 20);
    expect(moved.start).toEqual({ distance: 20 });
    expect(moved.features![0].over).toBe("second");
    const after = bakeBuilt({ ...doc, design: moved }).crossings![0];
    expect(after.distances[after.over === "first" ? 0 : 1]).toBeCloseTo(physical, 3);
    // a move that doesn't swap the passes changes nothing else
    const small = moveStart(doc.design, live, 3);
    expect(small.features).toBe(doc.design.features);
  });
});
