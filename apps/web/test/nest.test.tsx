// Nested corners (#106): corners on neighbouring lanes round one shared pipe follow each other, so the pipe is one
// curve; an override is kept and can be re-matched; Quick mode shapes the outside corner too.
import { bakeBuilt, racingLine, type Built, type DesignPoint, type Point2, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { draftFromDoc, newDraft, SelectionPanel, toDoc, type Draft } from "../src/designer/Designer.js";
import { liveGeometry } from "../src/designer/geometry.js";
import { designStep, gridFor, paintTo, withLaying, type Cell, type Laying } from "../src/designer/lanes.js";
import { allows } from "../src/designer/mode.js";
import { findNests, followNest, follows, followValue, innerOf, linkedTo, matchNest, outerOf } from "../src/designer/nest.js";
import { apexRadius, QUICK_SIZES, setApex } from "../src/designer/shape.js";

/** Niagara centre – Indoor (Winter): a 22 × 12 m hall with nothing in it */
const NIAGARA = { length: 22, width: 12 };

const size = (label: string) => QUICK_SIZES.find((q) => q.label === label)!.apex;

function paint(d: Draft, targets: Cell[]): Laying[] {
  const g = gridFor(d);
  const out: Laying[] = [];
  let lay: Laying = { cells: [], closed: false };
  for (const t of targets) {
    const r = paintTo(g, lay, t);
    expect(r.refused, `painting ${t}`).toBeUndefined();
    out.push(...r.states);
    lay = out[out.length - 1] ?? lay;
  }
  return out;
}

/** a Niagara draft with the lane laid through `targets` and closed (step 2) */
function laid(targets: Cell[]): Draft {
  const d0 = newDraft({ area: NIAGARA, name: "L loop" });
  const d = paint(d0, targets).reduce((d, s) => withLaying(d, s), d0);
  expect(designStep(d)).toBe(2);
  return d;
}

/**
 * Yeti's L loop: two lanes along the south wall (rows 0 and 1) and two up the east wall (columns 9 and 10), driven
 * clockwise from the north-east corner. The elbow's outer corner [10, 0] turns 90° right; the inner lane's corner
 * beside it, [9, 1], turns 90° left round the same pipe.
 */
const L_LOOP: Cell[] = [[10, 5], [10, 0], [0, 0], [0, 1], [9, 1], [9, 5], [10, 5]];
/** the same loop mirrored east–west: the elbow is a left-hand bend */
const L_LEFT: Cell[] = [[0, 5], [0, 0], [10, 0], [10, 1], [1, 1], [1, 5], [0, 5]];
/** three lanes stacked round the south-east elbow: [10, 0] outside, [9, 1], then [8, 2] innermost */
const THREE: Cell[] = [[10, 5], [10, 0], [0, 0], [0, 1], [9, 1], [9, 4], [8, 4], [8, 2], [0, 2], [0, 5], [10, 5]];

const at = (pts: DesignPoint[], x: number, z: number) => {
  const i = pts.findIndex((p) => p.x === x && p.z === z);
  expect(i, `corner at ${x}, ${z}`).toBeGreaterThanOrEqual(0);
  return i;
};

const withPoints = (d: Draft, points: DesignPoint[]): Draft => ({ ...d, design: { ...d.design, points } });
const bake = (d: Draft): Built => bakeBuilt(toDoc(d));
const problems = (b: Built) => b.checks.filter((c) => c.level !== "info").map((c) => `${c.level} ${c.code}: ${c.message}`);

/**
 * Is the pipe between the two lanes one curve? Every divider point in the elbow's quadrant that lies near the outer
 * corner's inside edge (the arc of radius r − w/2 about its centre) is on that arc, and they all belong to one divider.
 */
function oneSharedCurve(d: Draft, outer: number): { radii: number[]; dividers: Set<number> } {
  const pts = d.design.points;
  const c = racingLine(pts, d.design.laneWidth ?? 2).corners[outer];
  const b = bake(d);
  const bis: Point2 = [c.b[0] - c.a[0], c.b[1] - c.a[1]];
  const bl = Math.hypot(bis[0], bis[1]);
  bis[0] /= bl;
  bis[1] /= bl;
  const C: Point2 = [c.P[0] + (bis[0] * c.r) / Math.cos(c.th / 2), c.P[1] + (bis[1] * c.r) / Math.cos(c.th / 2)];
  const R = c.r - c.w / 2;
  const radii: number[] = [];
  const dividers = new Set<number>();
  b.dividers.forEach((dv, k) =>
    dv.points.forEach(([x, z]) => {
      const v: Point2 = [x - C[0], z - C[1]];
      // the quadrant the arc spans, seen from the centre: from the incoming straight's tangent point round to the outgoing one's
      if (v[0] * c.a[0] + v[1] * c.a[1] < -1e-6 || v[0] * c.b[0] + v[1] * c.b[1] > 1e-6) return;
      const r = Math.hypot(v[0], v[1]);
      if (Math.abs(r - R) < 0.5) {
        radii.push(r);
        dividers.add(k);
      }
    }),
  );
  return { radii, dividers };
}

/** the laid loop's divider runs: the outer ring and the shared pipes; a mitre poking into the sweeper would add one */
const runs = (d: Draft) => bake(d).stats.dividerRuns;

describe("finding nested corners from the geometry", () => {
  it("the L loop at Niagara: the elbow's outer corner and the inner lane's corner share one pipe, one lane apart", () => {
    const d = laid(L_LOOP);
    const pts = d.design.points;
    expect(pts).toHaveLength(6);
    const outer = at(pts, 10, -5), inner = at(pts, 8, -3);
    const nests = findNests(pts, 2);
    expect(nests).toEqual([{ outer, inner, d: 2 }]);
    expect(innerOf(nests, outer)).toBe(inner);
    expect(outerOf(nests, inner)).toBe(outer);
    expect(outerOf(nests, outer)).toBeNull();
    expect(innerOf(nests, inner)).toBeNull();
    expect(linkedTo(nests, outer)).toEqual([inner]);
    expect(linkedTo(nests, inner)).toEqual([outer]);
    // the hairpin pairs along the walls are not nests: they turn round different centres
    expect(linkedTo(nests, at(pts, 10, 5))).toEqual([]);
  });

  it("a left-hand bend nests the same way", () => {
    const pts = laid(L_LEFT).design.points;
    expect(findNests(pts, 2)).toEqual([{ outer: at(pts, -10, -5), inner: at(pts, -8, -3), d: 2 }]);
  });

  it("three lanes stacked are two nests, each between neighbours; the outermost and innermost are not linked", () => {
    const pts = laid(THREE).design.points;
    const a = at(pts, 10, -5), b = at(pts, 8, -3), c = at(pts, 6, -1);
    const nests = findNests(pts, 2);
    expect(nests).toContainEqual({ outer: a, inner: b, d: 2 });
    expect(nests).toContainEqual({ outer: b, inner: c, d: 2 });
    expect(nests.some((n) => n.outer === a && n.inner === c)).toBe(false);
    expect(linkedTo(nests, b).sort((x, y) => x - y)).toEqual([a, c].sort((x, y) => x - y));
    // the loop's north-east elbow is a nest too: the lane up column 9 turns west inside the lane down column 10
    expect(nests).toContainEqual({ outer: at(pts, 10, 5), inner: at(pts, 8, 3), d: 2 });
    expect(nests).toHaveLength(3);
  });

  it("the reference's nested-corners fixture: a 2 m U inside a U (the same centre, the same bisector)", () => {
    const doc = JSON.parse(readFileSync(join(__dirname, "../../../packages/engine/test/fixtures/extra/nested-corners.rctrack.json"), "utf8")) as RcTrack;
    const pts = doc.design.points;
    const nests = findNests(pts, doc.design.laneWidth ?? 2);
    expect(nests).toContainEqual({ outer: at(pts, 10, -8), inner: at(pts, 8, -6), d: 2 });
    expect(nests).toContainEqual({ outer: at(pts, -10, -8), inner: at(pts, -8, -6), d: 2 });
    expect(nests).toHaveLength(2);
  });

  it("corners that aren't concentric are not nests: a lane two lanes away, an offset corner, a different turn", () => {
    const sq = (x: number, z: number): DesignPoint => ({ x, z, radius: 1 });
    // concentric but 4 m apart (two lanes between): no shared pipe
    expect(findNests([sq(10, -5), sq(-10, -5), sq(-10, 5), sq(6, 5), sq(6, -1), sq(-6, -1), sq(-6, 3), sq(10, 3)], 2)).toEqual([]);
    // the inner corner slid 0.5 m off the bisector
    expect(findNests([sq(10, -5), sq(-10, -5), sq(-10, -3), sq(8.5, -3), sq(8.5, 5), sq(10, 5)], 2)).toEqual([]);
    // the same L, exactly: one nest
    expect(findNests([sq(10, -5), sq(-10, -5), sq(-10, -3), sq(8, -3), sq(8, 5), sq(10, 5)], 2)).toHaveLength(1);
  });

  it("lanes sharing a pipe with a little play still nest, up to where the bake stops merging the pipes", () => {
    const sq = (x: number, z: number): DesignPoint => ({ x, z, radius: 1 });
    const L = (gap: number) => [sq(10, -5), sq(-10, -5), sq(-10, -3 + gap), sq(8 - gap, -3 + gap), sq(8 - gap, 5), sq(10, 5)];
    expect(findNests(L(0.3), 2)).toEqual([{ outer: 0, inner: 3, d: 2.3 }]);
    expect(findNests(L(0.7), 2)).toEqual([]);
  });
});

describe("the inner corner follows the outer one", () => {
  const shaped = (cells: Cell[], label: string) => {
    const d = laid(cells);
    const pts = d.design.points;
    const outer = findNests(pts, 2)[0].outer, inner = findNests(pts, 2)[0].inner;
    const sized = setApex(pts, outer, size(label), 2);
    return { d: withPoints(d, followNest(sized, outer, 2)), outer, inner, laid: d };
  };

  it("Sweeper on the outer corner: the inner one gets a 2.0 m apex, rounded; no overlap, no squeeze, one shared curve", () => {
    const { d, outer, inner, laid } = shaped(L_LOOP, "Sweeper");
    const p = d.design.points[inner];
    expect(apexRadius(p, 2)).toBe(2);
    expect(p.radius).toBe(3);
    expect(p.outer).toBe("round");
    // the outer corner itself is a plain Sweeper; nothing else moved
    expect(apexRadius(d.design.points[outer], 2)).toBe(4);
    d.design.points.forEach((q, k) => k !== inner && k !== outer && expect(q).toEqual(laid.design.points[k]));
    expect(problems(bake(d))).toEqual([]);
    expect(runs(d)).toBe(runs(laid));
    const curve = oneSharedCurve(d, outer);
    expect(curve.radii.length).toBeGreaterThan(5);
    curve.radii.forEach((r) => expect(r).toBeCloseTo(4, 2)); // within 1 cm of the outer lane's inside edge
    expect(curve.dividers.size).toBe(1);
  });

  it("…without the rule (Yeti's step 1), the same Sweeper overlaps the inner lane by 0.82 m", () => {
    const d = laid(L_LOOP);
    const outer = findNests(d.design.points, 2)[0].outer;
    const b = bake(withPoints(d, setApex(d.design.points, outer, size("Sweeper"), 2)));
    expect(b.checks.some((c) => c.code === "lane-overlap" && c.message.includes("0.82"))).toBe(true);
  });

  it("Medium: the inner corner can't go below a hairpin, so it stays at 0 and is rounded; the pipes merge into one", () => {
    const { d, inner, laid } = shaped(L_LOOP, "Medium");
    const p = d.design.points[inner];
    expect(apexRadius(p, 2)).toBe(0);
    expect(p.outer).toBe("round");
    expect(problems(bake(d))).toEqual([]);
    expect(runs(d)).toBe(runs(laid));
  });

  it("Tight: the inner corner stays a hairpin and keeps its square outside, which sits nearer the tight pipe than a round one", () => {
    const { d, inner } = shaped(L_LOOP, "Tight");
    const p = d.design.points[inner];
    expect(apexRadius(p, 2)).toBe(0);
    expect(p.outer).toBeUndefined();
    expect(problems(bake(d))).toEqual([]);
  });

  it("Hairpin on the outer corner: the laid inner hairpin already fits it exactly and is left as laid", () => {
    const { d, inner, laid } = shaped(L_LOOP, "Hairpin");
    expect(d.design.points[inner]).toEqual(laid.design.points[inner]);
    expect(problems(bake(d))).toEqual([]);
    expect(runs(d)).toBe(runs(laid));
  });

  it("a left-hand bend follows the same way", () => {
    for (const label of ["Sweeper", "Medium", "Tight"]) {
      const { d, outer, inner, laid } = shaped(L_LEFT, label);
      expect(apexRadius(d.design.points[inner], 2)).toBe(Math.max(0, size(label) - 2));
      expect(problems(bake(d)), label).toEqual([]);
      if (label === "Sweeper") {
        expect(runs(d)).toBe(runs(laid));
        const curve = oneSharedCurve(d, outer);
        curve.radii.forEach((r) => expect(r).toBeCloseTo(4, 2)); // within 1 cm of the outer lane's inside edge
        expect(curve.dividers.size).toBe(1);
      }
    }
  });

  it("a 3-lane nest: shaping the outside corner shapes both inside it, each one lane tighter", () => {
    const d0 = laid(THREE);
    const pts = d0.design.points;
    const a = at(pts, 10, -5), b = at(pts, 8, -3), c = at(pts, 6, -1);
    const d = withPoints(d0, followNest(setApex(pts, a, 4, 2), a, 2));
    expect(apexRadius(d.design.points[a], 2)).toBe(4);
    expect(apexRadius(d.design.points[b], 2)).toBe(2);
    expect(d.design.points[b].outer).toBe("round");
    expect(apexRadius(d.design.points[c], 2)).toBe(0);
    expect(d.design.points[c].outer).toBe("round");
    expect(problems(bake(d))).toEqual([]);
    expect(runs(d)).toBe(runs(d0));
    expect(oneSharedCurve(d, a).dividers.size).toBe(1);
    expect(oneSharedCurve(d, b).dividers.size).toBe(1);
    // the middle corner shaped on its own: only the innermost follows it
    const d2 = withPoints(d0, followNest(setApex(pts, b, 3, 2), b, 2));
    expect(apexRadius(d2.design.points[a], 2)).toBe(0);
    expect(apexRadius(d2.design.points[c], 2)).toBe(1);
    expect(d2.design.points[c].outer).toBe("round");
  });

  it("a corner with nothing inside it changes alone", () => {
    const d = laid(L_LOOP);
    const i = at(d.design.points, 10, 5);
    const sized = setApex(d.design.points, i, 1.8, 2);
    expect(followNest(sized, i, 2)).toBe(sized);
  });

  it("the follow value in radii: r_in = r_out − spacing, never below a hairpin's w/2", () => {
    const pts = laid(L_LOOP).design.points;
    const nest = findNests(pts, 2)[0];
    expect(followValue(setApex(pts, nest.outer, 4, 2), nest, 2)).toEqual({ radius: 3, outer: "round" });
    expect(followValue(setApex(pts, nest.outer, 2.5, 2), nest, 2)).toEqual({ radius: 1.5, outer: "round" });
    expect(followValue(setApex(pts, nest.outer, 2, 2), nest, 2)).toEqual({ radius: 1, outer: "round" });
    expect(followValue(setApex(pts, nest.outer, 1.8, 2), nest, 2)).toEqual({ radius: 1, outer: "round" });
    expect(followValue(setApex(pts, nest.outer, 1.0, 2), nest, 2)).toEqual({ radius: 1, outer: undefined });
    expect(followValue(setApex(pts, nest.outer, 0, 2), nest, 2)).toEqual({ radius: 1, outer: undefined });
  });
});

describe("overriding and matching", () => {
  it("a deliberate change to the inner corner is kept and reported honestly; Match re-links it", () => {
    const d0 = laid(L_LOOP);
    const nest = findNests(d0.design.points, 2)[0];
    const linked = followNest(setApex(d0.design.points, nest.outer, 4, 2), nest.outer, 2);
    expect(follows(linked, nest, 2)).toBe(true);
    // Yeti's step 3: the inner corner set to Medium by hand
    const over = setApex(linked, nest.inner, 1.8, 2);
    expect(over[nest.inner].radius).toBe(2.8);
    expect(over[nest.inner].outer).toBe("round");
    expect(follows(over, nest, 2)).toBe(false);
    const b = bake(withPoints(d0, over));
    // a lane-overlap error (rctrack 1.9), or the squeeze warning once 1.10 (#102) is in
    expect(b.checks.filter((c) => (c.code as string) === "lane-overlap" || (c.code as string) === "lane-squeeze")).toHaveLength(1);
    // Match corner 2
    const matched = matchNest(over, nest.inner, 2);
    expect(matched[nest.inner]).toEqual(linked[nest.inner]);
    expect(follows(matched, nest, 2)).toBe(true);
    expect(problems(bake(withPoints(d0, matched)))).toEqual([]);
  });

  it("an inner corner squared by hand no longer follows; the laid hairpin pair counts as following (auto is square)", () => {
    const d0 = laid(L_LOOP);
    const nest = findNests(d0.design.points, 2)[0];
    expect(follows(d0.design.points, nest, 2)).toBe(true);
    const sq = d0.design.points.map((p, k) => (k === nest.inner ? { ...p, outer: "square" as const } : p));
    expect(follows(sq, nest, 2)).toBe(true);
    const linked = followNest(setApex(d0.design.points, nest.outer, 4, 2), nest.outer, 2);
    const squared = linked.map((p, k) => (k === nest.inner ? { ...p, outer: "square" as const } : p));
    expect(follows(squared, nest, 2)).toBe(false);
    expect(matchNest(squared, nest.inner, 2)[nest.inner].outer).toBe("round");
  });

  it("matching the middle corner of a 3-lane nest re-links the innermost too", () => {
    const d0 = laid(THREE);
    const pts = d0.design.points;
    const a = at(pts, 10, -5), b = at(pts, 8, -3), c = at(pts, 6, -1);
    const linked = followNest(setApex(pts, a, 4, 2), a, 2);
    const over = setApex(setApex(linked, b, 0.5, 2), c, 1.5, 2);
    const matched = matchNest(over, b, 2);
    expect(apexRadius(matched[b], 2)).toBe(2);
    expect(apexRadius(matched[c], 2)).toBe(0);
  });

  it("Match on a corner with nothing outside it changes nothing", () => {
    const pts = laid(L_LOOP).design.points;
    expect(matchNest(pts, at(pts, 10, 5), 2)).toBe(pts);
  });

  it("no stored track changes on load: the nested-corners fixture opens with its points exactly as stored", () => {
    const doc = JSON.parse(readFileSync(join(__dirname, "../../../packages/engine/test/fixtures/extra/nested-corners.rctrack.json"), "utf8")) as RcTrack;
    const d = draftFromDoc(doc);
    expect(toDoc(d, { id: doc.id, revision: doc.revision, doc }).design.points).toEqual(doc.design.points);
    // its inner corners (radius 1, outer auto) don't match the rule's "round": Match is offered, nothing is applied
    const nests = findNests(d.design.points, 2);
    nests.forEach((n) => expect(follows(d.design.points, n, 2)).toBe(false));
  });
});

describe("the corner panels", () => {
  const panel = (d: Draft, i: number, view: "quick" | "advanced" = "quick") =>
    renderToStaticMarkup(<SelectionPanel sel={{ kind: "point", i }} view={view} draft={d} live={liveGeometry(d.design)} update={() => {}} onDelete={() => {}} inCorner={new Map()} />);

  it("Quick mode has the outside-corner control, with Auto showing what it resolves to", () => {
    expect(allows("quick", "outer")).toBe(true);
    const d = laid(L_LOOP);
    const h = panel(d, 0);
    expect(h).toMatch(/role="radiogroup"[^>]*aria-label="Outside corner"/);
    expect(h).toContain("Auto (square)");
    expect(h).toMatch(/aria-checked="true"[^>]*>Auto/);
    expect(h).toContain("Square");
    expect(h).toContain("Round");
    // still no Advanced-only fields
    expect(h).not.toMatch(/>Radius<|Lane width|East \(x\)/);
  });

  it("the outer corner's panel says what else it shapes; the inner one's says what it follows", () => {
    const d0 = laid(L_LOOP);
    const nest = findNests(d0.design.points, 2)[0];
    const d = withPoints(d0, followNest(setApex(d0.design.points, nest.outer, 4, 2), nest.outer, 2));
    for (const view of ["quick", "advanced"] as const) {
      const ho = panel(d, nest.outer, view);
      expect(ho).toContain(`Also shapes corner ${nest.inner + 1} (inside)`);
      expect(ho).not.toContain("Match corner");
      const hi = panel(d, nest.inner, view);
      expect(hi).toContain(`Follows corner ${nest.outer + 1} (outside)`);
      expect(hi).not.toContain("Match corner");
      expect(hi).toMatch(/aria-checked="true"[^>]*>Round/);
    }
    // a corner in no nest says nothing about it
    const h = panel(d, at(d.design.points, 10, 5));
    expect(h).not.toMatch(/Also shapes|Follows corner|Match corner/);
  });

  it("an overridden inner corner offers Match", () => {
    const d0 = laid(L_LOOP);
    const nest = findNests(d0.design.points, 2)[0];
    const linked = followNest(setApex(d0.design.points, nest.outer, 4, 2), nest.outer, 2);
    const d = withPoints(d0, setApex(linked, nest.inner, 1.8, 2));
    for (const view of ["quick", "advanced"] as const) {
      const h = panel(d, nest.inner, view);
      expect(h).toContain("Shaped on its own");
      expect(h).toMatch(new RegExp(`<button[^>]*>Match corner ${nest.outer + 1}</button>`));
      expect(h).not.toContain("Follows corner");
    }
  });
});
