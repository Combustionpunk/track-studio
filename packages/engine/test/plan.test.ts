// The plan drawing (src/plan.ts): one renderer for the web plan, the embed, the PNG previews and the link-preview card.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bake, fits, jumpSymbol, reverseDesign, PLAN_PALETTE, planLayers, planScene, planSvg, transformBuilt, type BuiltFeature, type Point2, type RcTrack, type RcVenue } from "../src/index.js";
import { allTracks, examples, readJson, referenceDir, repoRoot, venues } from "./helpers.js";

const club = () => readJson<RcTrack>(join(referenceDir, "examples", "club-a.rctrack.json"));
const draw = (doc: RcTrack, opts: Parameters<typeof planLayers>[1] = { px: 0.025 }) => planLayers(planScene(doc), opts);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** Tags open and close in order (the output has no comments, CDATA or text containing "<"). */
function wellFormed(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([\w:-]+)[^>]*?(\/?)>/g)) {
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else if (!m[3]) stack.push(m[2]);
  }
  return stack.length === 0;
}

describe("plan palette", () => {
  it("is the fixed plan palette from docs/design/tokens.json", () => {
    const tokens = JSON.parse(readFileSync(join(repoRoot, "docs/design/tokens.json"), "utf8")) as { color: { tokens: { name: string; value: string }[] } };
    const plan = Object.fromEntries(tokens.color.tokens.filter((t) => t.name.startsWith("plan-")).map((t) => [t.name, t.value]));
    expect(PLAN_PALETTE).toEqual(plan);
  });
});

describe("planLayers", () => {
  it.each(allTracks)("$name renders from built without errors", ({ path }) => {
    const svg = draw(readJson<RcTrack>(path));
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(wellFormed(`<g>${svg}</g>`)).toBe(true);
  });

  it("is drawn from built only: the design makes no difference", () => {
    const doc = club();
    const noDesign = { ...doc, design: { points: [] } } as RcTrack;
    expect(draw(noDesign)).toBe(draw(doc));
  });

  it("fills the carpet from built.lanes (even-odd), with the carpet texture over it", () => {
    const svg = draw(club());
    expect(svg).toMatch(new RegExp(`<path class="p-carpet" d="M[^"]+Z M[^"]+Z" fill="${PLAN_PALETTE["plan-carpet"]}" fill-rule="evenodd"/>`));
    expect(svg).toMatch(/<pattern id="plan-carpet-tex"/);
    expect(svg).toMatch(/fill="url\(#plan-carpet-tex\)"/);
  });

  it("falls back to the racing line at lane width for files baked before rctrack 1.4 (no lanes)", () => {
    const doc = readJson<RcTrack>(join(repoRoot, "packages/engine/test/fixtures/v12/round-sweepers.rctrack.json"));
    expect(doc.built!.lanes).toBeUndefined();
    const svg = draw(doc);
    expect(svg).toMatch(/<g class="p-carpet"/);
    expect(svg).toMatch(/stroke-width="2(\.\d+)?"/);
  });

  it("draws pipes at real thickness (0.08 m), never thinner than 1.5 px; shared pipes get a core line", () => {
    const doc = club();
    const b = doc.built!;
    const svg = draw(doc, { px: 0.01 });
    expect(count(svg, /class="p-pipe"/g)).toBe(b.dividers.length);
    expect(svg).toMatch(/class="p-pipe"[^>]*stroke-width="0\.08"/);
    expect(count(svg, /class="p-shared"/g)).toBe(b.dividers.filter((d) => d.shared).length);
    expect(b.dividers.some((d) => d.shared)).toBe(true);
    // zoomed far out, a pipe is 1.5 px
    expect(draw(doc, { px: 0.2 })).toMatch(/class="p-pipe"[^>]*stroke-width="0\.3"/);
  });

  it("draws the rostrum, the chequered start line, grid boxes and direction-of-travel arrows", () => {
    const svg = draw(club());
    expect(svg).toMatch(/<g class="p-rostrum"/);
    expect(count(svg, /class="p-start-a"/g)).toBeGreaterThanOrEqual(4);
    expect(count(svg, /class="p-start-b"/g)).toBeGreaterThanOrEqual(4);
    expect(count(svg, /class="p-gridbox"/g)).toBeGreaterThanOrEqual(4);
    expect(count(svg, /class="p-arrow"/g)).toBeGreaterThan(5);
  });

  describe("reversed (#36): drawn from the re-baked built", () => {
    const before = club();
    const after = bake({ ...before, design: reverseDesign(before.design) });
    const s = before.built!.startLine;
    const h = (s.heading * Math.PI) / 180;
    /** how far along the original start line's direction of travel */
    const along = (x: number, z: number) => (x - s.x) * Math.cos(h) + (z - s.z) * Math.sin(h);
    const num = (m: RegExpMatchArray, k: number): Point2 => [Number(m[k]), -Number(m[k + 1])];
    /** each arrow chevron's direction (base middle to tip) against the original racing line's direction where it is */
    const arrowDots = (doc: RcTrack) => {
      const line = before.built!.racingLine;
      return [...draw(doc).matchAll(/class="p-arrow" d="M([-\d.]+) ([-\d.]+) L([-\d.]+) ([-\d.]+) L([-\d.]+) ([-\d.]+)"/g)].map((m) => {
        const [a, tip, b] = [num(m, 1), num(m, 3), num(m, 5)];
        const mid: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const k = line.reduce((best, p, i) => (Math.hypot(p[0] - mid[0], p[1] - mid[1]) < Math.hypot(line[best][0] - mid[0], line[best][1] - mid[1]) ? i : best), 0);
        const q = line[(k + 1) % line.length], p = line[k];
        return Math.sign((tip[0] - mid[0]) * (q[0] - p[0]) + (tip[1] - mid[1]) * (q[1] - p[1]));
      });
    };
    const boxes = (doc: RcTrack) => [...draw(doc).matchAll(/class="p-gridbox" transform="translate\(([-\d.]+) ([-\d.]+)\)/g)].map((m) => num(m, 1));

    it("direction arrows point the other way", () => {
      const was = arrowDots(before), now = arrowDots(after);
      expect(was.length).toBeGreaterThan(5);
      expect(now.length).toBeGreaterThan(5);
      expect(was.every((d) => d > 0)).toBe(true);
      expect(now.every((d) => d < 0)).toBe(true);
    });

    it("the grid boxes are on the other side of the start line, and so is its chevron", () => {
      const was = boxes(before), now = boxes(after);
      expect(was.length).toBeGreaterThanOrEqual(4);
      expect(now.length).toBeGreaterThanOrEqual(4);
      for (const [x, z] of was) expect(along(x, z)).toBeLessThan(0);
      for (const [x, z] of now) expect(along(x, z)).toBeGreaterThan(0);
      const chevron = (doc: RcTrack) => num(draw(doc).match(/class="p-start-dir" d="M[-\d.]+ [-\d.]+ L([-\d.]+) ([-\d.]+)/)!, 1);
      expect(along(...chevron(before))).toBeGreaterThan(0);
      expect(along(...chevron(after))).toBeLessThan(0);
    });
  });

  it("grid boxes sit behind the start line, on the lane, as many as fit on the straight (up to 10)", () => {
    const doc = club();
    const s = doc.built!.startLine;
    const h = (s.heading * Math.PI) / 180;
    const boxes = [...draw(doc).matchAll(/class="p-gridbox" transform="translate\(([-\d.]+) ([-\d.]+)\)/g)].map((m) => [Number(m[1]), -Number(m[2])]);
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    expect(boxes.length).toBeLessThanOrEqual(10);
    const oval = readJson<RcTrack>(join(repoRoot, "packages/engine/test/fixtures/extra/square-fill.rctrack.json"));
    expect(count(draw(oval), /class="p-gridbox"/g)).toBeLessThanOrEqual(10);
    for (const [x, z] of boxes) {
      const along = (x - s.x) * Math.cos(h) + (z - s.z) * Math.sin(h);
      expect(along).toBeLessThan(0); // behind the line
      expect(Math.min(...doc.built!.racingLine.map((p) => Math.hypot(p[0] - x, p[1] - z)))).toBeLessThan(s.width / 2);
    }
  });

  it("1 m grid with every fifth line major, measured from the south-west corner; optional", () => {
    const doc = club(); // 22 × 12 m
    const svg = draw(doc);
    expect(count(svg, /class="p-grid"/g) + count(svg, /class="p-grid-major"/g)).toBe(21 + 11);
    expect(count(svg, /class="p-grid-major"/g)).toBe(4 + 2); // x = 5, 10, 15, 20 and z = 5, 10 from the corner
    expect(svg).toMatch(/class="p-grid-major" d="M-6 /); // x = -11 + 5
    expect(draw(doc, { px: 0.025, layers: { grid: false } })).not.toMatch(/p-grid"|p-grid-major/);
  });

  it("marks errors on the lane and warnings with a ring; info stays off the plan", () => {
    const doc = readJson<RcTrack>(join(repoRoot, "packages/engine/test/fixtures/extra/outside-and-obstacles.rctrack.json"));
    const levels = doc.built!.checks.map((c) => c.level);
    const svg = draw(doc);
    expect(count(svg, /class="p-error"/g)).toBe(levels.filter((l) => l === "error").length);
    expect(count(svg, /class="p-warning"/g)).toBe(levels.filter((l) => l === "warning").length);
    expect(draw(club())).not.toMatch(/p-error|p-warning/); // only info checks
  });

  it("an error near point 0 is one continuous run along the line (no chord across the infield)", () => {
    const doc = club();
    const [x, z] = doc.built!.racingLine[0];
    doc.built!.checks = [{ level: "error", code: "outside-area", message: "x", x, z }];
    const d = /class="p-error" d="([^"]+)"/.exec(draw(doc))![1];
    const pts = d.slice(1).split(" L").map((p) => p.split(" ").map(Number));
    expect(pts.length).toBeGreaterThan(5);
    for (let k = 1; k < pts.length; k++) expect(Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])).toBeLessThan(0.5);
  });

  it("can tag things for the web plan's hover details", () => {
    const doc = club();
    const svg = draw(doc, { px: 0.025, tips: true });
    doc.built!.features.forEach((_, i) => expect(svg).toContain(`data-tip="f${i}"`));
    expect(svg).toContain('data-tip="start"');
    expect(svg).toContain('data-tip="rostrum"');
    expect(draw(doc)).not.toContain("data-tip");
  });

  it("layers can be switched off", () => {
    const svg = draw(club(), { px: 0.025, layers: { lanes: false, dividers: false, features: false, racingLine: false, start: false, rostrum: false, checks: false, obstacles: false, grid: false } });
    expect(svg).not.toMatch(/p-carpet|p-pipe|p-jump|p-line|p-start|p-rostrum|p-grid/);
    expect(svg).toMatch(/p-area/);
  });

  it("escapes obstacle labels", () => {
    const doc = club();
    doc.obstacles = [{ type: "circle", x: 0, z: 0, radius: 0.3, label: 'Pillar <"A"> & B' }];
    expect(draw(doc)).toContain("Pillar &lt;&quot;A&quot;&gt; &amp; B");
  });

  it("ids are prefixed, so several plans can share a page", () => {
    const svg = draw(club(), { px: 0.025, id: "card7" });
    expect(svg).toContain('id="card7-carpet-tex"');
    expect(svg).not.toContain('id="plan-');
  });

  it("matches the stored snapshot (club-a)", async () => {
    await expect(planSvg(planScene(club()), { width: 1200 })).toMatchFileSnapshot("__snapshots__/club-a.plan.svg");
  });
});

describe("jump symbols", () => {
  const f = (type: BuiltFeature["type"], profile: [number, number][], length = profile[profile.length - 1][0]): BuiltFeature => ({ type, x: 0, z: 0, heading: 0, length, width: 2, height: 0.1, profile });
  const all = new Map<string, BuiltFeature>();
  for (const { path } of [...allTracks]) for (const feat of readJson<RcTrack>(path).built?.features ?? []) if (!all.has(feat.type)) all.set(feat.type, feat);

  it("the fixtures cover every jump type", () => {
    expect([...all.keys()].sort()).toEqual(["bump", "double", "kicker", "stepdown", "stepup", "tabletop", "whoops"]);
  });

  it("splits the profile into humps on the ground: a double has two, whoops three", () => {
    expect(jumpSymbol(all.get("tabletop")!).humps).toHaveLength(1);
    expect(jumpSymbol(all.get("double")!).humps).toHaveLength(2);
    expect(jumpSymbol(all.get("whoops")!).humps).toHaveLength(3);
    expect(jumpSymbol(all.get("double")!).humps.map((h) => [h.from, h.to])).toEqual([[0, 0.85], [1.75, 2.6]]);
  });

  it("finds the take-off edge: the top of a ramp, or the drop off a step-down", () => {
    expect(jumpSymbol(f("tabletop", [[0, 0], [0.7, 0.14], [1.5, 0.14], [2.2, 0]])).takeoffs).toEqual([0.7]);
    expect(jumpSymbol(f("kicker", [[0, 0], [0.6, 0.12], [0.8, 0]])).takeoffs).toEqual([0.6]);
    expect(jumpSymbol(f("stepup", [[0, 0], [0.6, 0.12], [1.6, 0.12], [1.6, 0]])).takeoffs).toEqual([0.6]);
    expect(jumpSymbol(f("stepdown", [[0, 0], [0, 0.1], [1.111, 0.1], [2, 0]])).takeoffs).toEqual([1.111]);
    expect(jumpSymbol(all.get("whoops")!).takeoffs).toHaveLength(3);
  });

  it("downhill faces are hatched, so the types read differently", () => {
    expect(jumpSymbol(f("stepup", [[0, 0], [0.6, 0.12], [1.6, 0.12], [1.6, 0]])).down).toEqual([]);
    expect(jumpSymbol(f("tabletop", [[0, 0], [0.7, 0.14], [1.5, 0.14], [2.2, 0]])).down).toEqual([[1.5, 2.2]]);
    expect(jumpSymbol(f("stepdown", [[0, 0], [0, 0.1], [1.111, 0.1], [2, 0]])).down).toEqual([[1.111, 2]]);
  });

  it("a jump without a profile is drawn as its plain footprint", () => {
    const doc = club();
    doc.built!.features = [{ ...doc.built!.features[0], profile: [] }];
    const svg = draw(doc);
    expect(count(svg, /class="p-jump-body"/g)).toBe(1);
    expect(count(svg, /class="p-jump-dir"/g)).toBe(1);
  });

  it.each([...all.values()].map((v) => ({ type: v.type, feat: v })))("draws a $type with its outline, edges and a direction chevron", ({ feat }) => {
    const doc = club();
    doc.built!.features = [feat];
    const svg = draw(doc);
    expect(svg).toMatch(new RegExp(`<g class="p-jump" data-type="${feat.type}"`));
    expect(count(svg, /class="p-jump-body"/g)).toBe(jumpSymbol(feat).humps.length);
    expect(count(svg, /class="p-jump-takeoff"/g)).toBe(jumpSymbol(feat).takeoffs.length);
    expect(count(svg, /class="p-jump-dir"/g)).toBe(1);
  });
});

describe("planSvg", () => {
  it.each(examples)("$name: a standalone picture of the area plus 2.5 m margins, with a scale bar", ({ path }) => {
    const doc = readJson<RcTrack>(path);
    const svg = planSvg(planScene(doc), { width: 1200 });
    const { length: L, width: W } = doc.area;
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${Math.round((1200 * (W + 5)) / (L + 5))}" viewBox="${-L / 2 - 2.5} ${-W / 2 - 2.5} ${L + 5} ${W + 5}"`)).toBe(true);
    expect(svg).toMatch(new RegExp(`<rect class="p-floor"[^>]*fill="${PLAN_PALETTE["plan-floor"]}"`));
    expect(svg).toMatch(/<g class="p-scale">.*>5 m<\/text><\/g>/);
    expect(wellFormed(svg)).toBe(true);
  });

  it("puts the scale bar on the side away from the rostrum", () => {
    const doc = club(); // rostrum north
    const y = (svg: string) => Number(/<g class="p-scale"><path d="M[-\d.]+ ([-\d.]+)/.exec(svg)![1]);
    expect(y(planSvg(planScene(doc), { width: 600 }))).toBeGreaterThan(doc.area.width / 2); // south margin (svg y = -z)
    doc.built!.rostrum = { ...doc.built!.rostrum, side: "south", z: -7.5 };
    expect(y(planSvg(planScene(doc), { width: 600 }))).toBeLessThan(-doc.area.width / 2);
  });

  it("draws a venue (no built): area, obstacles, rostrum", () => {
    const venue = readJson<RcVenue>(join(referenceDir, "venues", "sports-hall-b.rcvenue.json"));
    const svg = planSvg({ area: venue.area, obstacles: venue.obstacles, rostrum: { side: "south", x: 0, z: -venue.area.width / 2 - 1.5 } }, { width: 800 });
    expect(svg).toMatch(/p-rostrum/);
    expect(svg).not.toMatch(/p-carpet|p-pipe/);
    expect(wellFormed(svg)).toBe(true);
  });

  it("pixelRatio sizes the hairlines for where the picture is shown", () => {
    const scene = planScene(club());
    const lineWidth = (svg: string) => Number(/class="p-line"[^>]*stroke-width="([\d.]+)"/.exec(svg)![1]);
    expect(lineWidth(planSvg(scene, { width: 1200, pixelRatio: 2 }))).toBeCloseTo(2 * lineWidth(planSvg(scene, { width: 1200 })), 2);
  });

  it("needs a positive width", () => {
    expect(() => planSvg(planScene(club()), { width: 0 })).toThrow(/width/);
  });
});

describe("transformBuilt", () => {
  it("moves the lanes (carpet) with the rest of the track", () => {
    const track = readJson<RcTrack>(join(referenceDir, "examples", "freeform-example.rctrack.json"));
    const venue = readJson<RcVenue>(venues.find((v) => v.name.startsWith("sports-hall-b"))!.path);
    const [fit] = fits(track, venue);
    const moved = transformBuilt(track.built!, fit);
    const adapted = readJson<RcTrack>(join(referenceDir, "examples", "freeform-at-sports-hall-b.rctrack.json"));
    const near = (p: number[], ring: number[][]) => Math.min(...ring.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    const rings = [...adapted.built!.lanes!.right, ...adapted.built!.lanes!.left];
    const worst = Math.max(...[...moved.lanes!.right, ...moved.lanes!.left].map((p) => near(p, rings)));
    expect(worst).toBeLessThan(0.15);
  });
});

// Problem marks: the one drawing of a problem, for every plan and for both designer modes (moved from the designer's
// own problemMarks, #28)
describe("problem marks", () => {
  const ONLY_CHECKS = { lanes: false, racingLine: false, dividers: false, features: false, start: false, checks: true, obstacles: false, grid: false, rostrum: false };
  /** the checks layer alone, as the designer draws it over its handles */
  const marks = (doc: RcTrack, px = 0.025) => draw(doc, { px, layers: ONLY_CHECKS, background: false, tips: true });
  const sectionPoints = (svg: string) => /class="p-error" d="([^"]+)"/.exec(svg)![1].slice(1).split(" L").map((p) => p.split(" ").map(Number)).map(([x, y]) => [x, -y]);
  const lengthOf = (pts: number[][]) => pts.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0);

  it("draws an error as a section of the lane, a warning or an off-lane error as a ring, and never info", () => {
    const doc = club();
    const on = doc.built!.racingLine[20];
    doc.built!.checks = [
      { level: "error", code: "outside-area", x: on[0], z: on[1], message: "e" },
      { level: "warning", code: "tight-corner", x: on[0], z: on[1], message: "w" },
      { level: "info", code: "radius-reduced", x: on[0], z: on[1], message: "i" },
      { level: "error", code: "obstacle", x: 100, z: 100, message: "far off the lane" },
    ];
    const svg = marks(doc);
    expect([...svg.matchAll(/<(\w+) class="(p-error|p-warning)"[^>]*data-tip="(c\d)"/g)].map((m) => [m[2], m[1], m[3]])).toEqual([
      ["p-error", "path", "c0"],
      ["p-warning", "circle", "c1"],
      ["p-error", "circle", "c3"],
    ]);
    expect(svg).not.toContain('data-tip="c2"');
    // about 3 m of lane (±1.5 m) centred on the problem, 3 px wide
    const sec = sectionPoints(svg);
    expect(lengthOf(sec)).toBeGreaterThan(2.4);
    expect(lengthOf(sec)).toBeLessThan(3.2);
    expect(sec.some((p) => Math.hypot(p[0] - on[0], p[1] - on[1]) < 1e-3)).toBe(true);
    expect(svg).toMatch(/class="p-error" d="[^"]+" fill="none" stroke="#ff7f5c" stroke-width="0.075"/);
    // rings: 9 px radius (at least 0.5 m), 2 px for a warning and 3 px for an error
    expect(svg).toMatch(/<circle class="p-warning" cx="[^"]+" cy="[^"]+" r="0.5" fill="none" stroke="#fdd459" stroke-width="0.05"/);
    expect(svg).toMatch(/<circle class="p-error" cx="100" cy="-100" r="0.5" fill="none" stroke="#ff7f5c" stroke-width="0.075"/);
    expect(marks(doc, 0.1)).toMatch(/<circle class="p-warning" [^>]*r="0.9"/);
  });

  it("a section wraps round the start of the line", () => {
    const doc = club();
    const [x, z] = doc.built!.racingLine[0];
    doc.built!.checks = [{ level: "error", code: "outside-area", message: "e", x, z }];
    const sec = sectionPoints(marks(doc));
    expect(sec.length).toBeGreaterThan(2);
    for (let k = 1; k < sec.length; k++) expect(Math.hypot(sec[k][0] - sec[k - 1][0], sec[k][1] - sec[k - 1][1])).toBeLessThan(1);
  });

  it("with background: false, draws only the chosen layers (no patterns or track area) to sit over something else", () => {
    const doc = club();
    const [x, z] = doc.built!.racingLine[0];
    doc.built!.checks = [{ level: "error", code: "outside-area", message: "e", x, z }];
    const svg = marks(doc);
    expect(wellFormed(svg)).toBe(true);
    expect(svg).toMatch(/^<path class="p-error"/);
    expect(svg).not.toMatch(/<defs>|p-area|p-carpet|p-line|p-pipe/);
    expect(draw(doc)).toMatch(/^<defs>.*p-area/);
    // the marks are the same as in the full drawing
    expect(draw(doc)).toContain(draw(doc, { px: 0.025, layers: ONLY_CHECKS, background: false }));
  });
});
