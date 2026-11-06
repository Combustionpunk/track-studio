// Crossings on the plan (#51): the over pass drawn on top, the under pass dashed beneath the bridge, the bridge's
// footprint outlined, in the plan and the print palettes. Snapshots of the #50 fixtures.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_PALETTE, PRINT_PALETTE, planLayers, planScene, planSvg, type Point2, type RcTrack } from "../src/index.js";
import { extraDir, readJson } from "./helpers.js";

const fixture = (name: string) => readJson<RcTrack>(join(extraDir, `${name}.rctrack.json`));
const draw = (doc: RcTrack, opts: Parameters<typeof planLayers>[1] = { px: 0.025 }) => planLayers(planScene(doc), opts);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** "M1 2 L3 4 M…" → [[x, z], …] (svg y = -z) */
const points = (d: string): Point2[] => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), -Number(m[2])]);
const attr = (svg: string, cls: string, name: string) => new RegExp(`class="${cls}"[^>]*? ${name}="([^"]+)"`).exec(svg)?.[1];

/** Is p on the boundary of the convex quad q (within tol)? */
function onQuad(p: Point2, q: Point2[], tol = 0.002): boolean {
  return q.some((a, k) => {
    const b = q[(k + 1) % q.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t)) < tol;
  });
}

const BRIDGED = ["crossover-figure8", "tabletop-figure8", "two-crossings"];
const SNAPSHOTS = [...BRIDGED, "unbridged-figure8", "crossover-low-figure8", "tabletop-low-figure8", "shallow-crossing"];

describe("crossings on the plan", () => {
  it.each(BRIDGED)("%s: one bridge per bridged crossing, drawn after the pipes so the over pass is on top", (name) => {
    const doc = fixture(name);
    const svg = draw(doc);
    const crossings = doc.built!.crossings!.filter((c) => c.bridge);
    expect(count(svg, /<g class="p-crossing"/g)).toBe(crossings.length);
    // every pipe comes before the first bridge
    expect(svg.lastIndexOf('class="p-pipe"')).toBeLessThan(svg.indexOf('class="p-crossing"'));
    crossings.forEach((c) => expect(svg).toContain(`data-bridge="${c.bridge!.type}" data-over="${c.over}"`));
  });

  it.each(BRIDGED)("%s: the bridging feature is drawn once, inside its crossing", (name) => {
    const doc = fixture(name);
    const svg = draw(doc);
    expect(count(svg, /<g class="p-jump"/g)).toBe(doc.built!.features.length);
    const bridges = svg.split('<g class="p-crossing"').slice(1);
    bridges.forEach((b) => expect(count(b.slice(0, b.indexOf('class="p-bridge"')), /<g class="p-jump"/g)).toBe(1));
  });

  it.each(BRIDGED)("%s: the footprint is outlined, and the under pass's lane edges are dashed across it", (name) => {
    const doc = fixture(name);
    const svg = draw(doc);
    const groups = svg.split('<g class="p-crossing"').slice(1);
    doc.built!.crossings!.filter((c) => c.bridge).forEach((c, k) => {
      const g = groups[k];
      const outline = points(attr(g, "p-bridge", "d")!);
      outline.forEach((p, i) => expect(Math.hypot(p[0] - c.footprint![i][0], p[1] - c.footprint![i][1])).toBeLessThan(0.002));
      expect(attr(g, "p-under", "stroke-dasharray")).toBeTruthy();
      const under = points(attr(g, "p-under", "d")!);
      expect(under).toHaveLength(4); // two edges, each clipped to the footprint
      for (const p of under) expect(onQuad(p, c.footprint!), `${p}`).toBe(true);
      // the edges are the under pass's lane edges: a lane width apart
      const gap = (a: Point2, b: Point2, p: Point2) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      expect(gap(under[0], under[1], under[2])).toBeCloseTo(2, 1);
      // the over pass's pipes run along both long sides, solid
      expect(attr(g, "p-over", "stroke-dasharray")).toBeUndefined();
      expect(points(attr(g, "p-over", "d")!)).toHaveLength(4);
    });
  });

  it("a tabletop that bridges is drawn the same way as a crossover, as itself", () => {
    const svg = draw(fixture("tabletop-figure8"));
    expect(svg).toMatch(/<g class="p-crossing" data-bridge="tabletop" data-over="second">.*?<g class="p-jump" data-type="tabletop"/);
  });

  it("an unbridged or too-low crossing has no bridge, but its carpet is filled in", () => {
    for (const name of ["unbridged-figure8", "crossover-low-figure8", "tabletop-low-figure8"]) {
      const svg = draw(fixture(name));
      expect(svg, name).not.toContain('class="p-crossing"');
      expect(count(svg, /class="p-crossing-carpet"/g), name).toBe(1);
    }
    // a low crossover is still drawn, as an ordinary jump
    expect(draw(fixture("crossover-low-figure8"))).toContain('data-type="crossover"');
  });

  it("every crossing's carpet is filled (the even-odd lanes leave it empty), under everything else", () => {
    const doc = fixture("crossover-figure8");
    const svg = draw(doc);
    expect(count(svg, /class="p-crossing-carpet"/g)).toBe(1);
    expect(svg.indexOf('class="p-crossing-carpet"')).toBeLessThan(svg.indexOf('class="p-line"'));
    // it covers the square where the two lanes overlap (2 m lanes crossing square): ±1 m round the crossing
    const patch = points(attr(svg, "p-crossing-carpet", "d")!);
    for (const p of patch) expect(Math.hypot(p[0], p[1])).toBeGreaterThan(Math.SQRT2 - 0.01);
  });

  it("tracks that don't cross themselves draw no crossing at all", () => {
    expect(draw(fixture("peel-round"))).not.toMatch(/p-crossing|p-under|p-over|p-bridge/);
  });

  it("the features layer switches the bridges off; the lanes layer the carpet patch", () => {
    const doc = fixture("crossover-figure8");
    expect(draw(doc, { px: 0.025, layers: { features: false } })).not.toMatch(/p-crossing"|p-jump/);
    expect(draw(doc, { px: 0.025, layers: { lanes: false } })).not.toContain("p-crossing-carpet");
  });

  it("can tag the bridge for the web plan's hover details, as its feature", () => {
    expect(draw(fixture("crossover-figure8"), { px: 0.025, tips: true })).toMatch(/<g class="p-crossing"[^>]*data-tip="f0"/);
  });

  it("uses only the palette's colours: the plan palette on screen, the print palette on the build sheet", () => {
    const hex = (s: string) => new Set([...s.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase()));
    const bridge = (s: string) => s.slice(s.indexOf('<g class="p-crossing"'));
    const plan = Object.values(PLAN_PALETTE).map((v) => v.toLowerCase());
    const print = Object.values(PRINT_PALETTE).map((v) => v.toLowerCase());
    for (const name of BRIDGED) {
      for (const c of hex(bridge(draw(fixture(name))))) expect(plan).toContain(c);
      for (const c of hex(bridge(draw(fixture(name), { px: 0.025, palette: "print" })))) expect(print).toContain(c);
    }
    // in print the outline and the dashes are ink, so they read in black and white
    const svg = draw(fixture("crossover-figure8"), { px: 0.025, palette: "print" });
    expect(attr(svg, "p-bridge", "stroke")).toBe(PRINT_PALETTE["print-ink"]);
    expect(attr(svg, "p-under", "stroke")).toBe(PRINT_PALETTE["print-ink"]);
  });

  it.each(SNAPSHOTS)("%s matches the stored snapshot", async (name) => {
    await expect(planSvg(planScene(fixture(name)), { width: 1200 })).toMatchFileSnapshot(`__snapshots__/${name}.plan.svg`);
  });
});
