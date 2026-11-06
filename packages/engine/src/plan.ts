// The plan drawing: one renderer for the web plan, the embed, the PNG previews and the link-preview card, so a plan
// looks the same everywhere. Drawn from `built` only (plus the area and obstacles), never from `design`, in the fixed
// plan palette (docs/design/design-system.md, "Plan colours"). previewSvg (preview.ts) stays the reference port.
//
// Units are metres, SVG y = -z (north up). Lines that should look the same at any zoom (grid, racing line, outlines)
// are sized in screen pixels via `px`, the size of one output pixel in metres.
import { drawingArea, rostrumPosition } from "./bake.js";
import type { Area, Built, BuiltFeature, Obstacle, Point2, RcTrack, Side } from "./types.js";

/** The fixed plan palette: tokens.json's plan-* colours (a test keeps them equal). */
export const PLAN_PALETTE = {
  "plan-floor": "#2b2e32",
  "plan-area": "#33373c",
  "plan-carpet": "#46564c",
  "plan-pipe": "#ecece6",
  "plan-pipe-shared": "#a9b8c2",
  "plan-line": "#fdd459",
  "plan-jump": "#e0b16a",
  "plan-jump-edge": "#6b4a1f",
  "plan-rostrum": "#8a8f96",
  "plan-obstacle": "#b07a7a",
  "plan-grid": "#ffffff1a",
  "plan-grid-major": "#ffffff33",
  "plan-error": "#ff7f5c",
  "plan-warning": "#fdd459",
} as const;

/** The fixed print palette for the build sheet: tokens.json's print-* colours (a test keeps them equal). */
export const PRINT_PALETTE = {
  "print-paper": "#ffffff",
  "print-ink": "#1a1a1a",
  "print-muted": "#555555",
  "print-carpet": "#e9ece8",
  "print-grid": "#d6d6d6",
  "print-grid-major": "#8a8a8a",
  "print-jump": "#bdbdbd",
  "print-watermark": "#1a1a1a1f",
} as const;

type Palette = Record<keyof typeof PLAN_PALETTE, string>;

/** The plan's colour roles in print: black ink on white, so the sheet reads in black and white. */
const PRINT_ROLES: Palette = {
  "plan-floor": PRINT_PALETTE["print-paper"],
  "plan-area": PRINT_PALETTE["print-paper"],
  "plan-carpet": PRINT_PALETTE["print-carpet"],
  "plan-pipe": PRINT_PALETTE["print-ink"],
  "plan-pipe-shared": PRINT_PALETTE["print-muted"],
  "plan-line": PRINT_PALETTE["print-muted"],
  "plan-jump": PRINT_PALETTE["print-jump"],
  "plan-jump-edge": PRINT_PALETTE["print-ink"],
  "plan-rostrum": PRINT_PALETTE["print-paper"],
  "plan-obstacle": PRINT_PALETTE["print-paper"],
  "plan-grid": PRINT_PALETTE["print-grid"],
  "plan-grid-major": PRINT_PALETTE["print-grid-major"],
  "plan-error": PRINT_PALETTE["print-ink"],
  "plan-warning": PRINT_PALETTE["print-ink"],
};

const P: Palette = PLAN_PALETTE;

export type PlanLayer = "lanes" | "racingLine" | "dividers" | "features" | "start" | "checks" | "obstacles" | "grid" | "rostrum";
export type PlanLayers = Record<PlanLayer, boolean>;
export const ALL_PLAN_LAYERS: PlanLayers = { lanes: true, racingLine: true, dividers: true, features: true, start: true, checks: true, obstacles: true, grid: true, rostrum: true };

/** What a plan shows. `obstacles` and `rostrum` come from a venue (v1.7: layouts have none): venue plans, fits. */
export interface PlanScene {
  area: Area;
  obstacles?: Obstacle[];
  built?: Built;
  rostrum?: { side: Side; x: number; z: number };
}

export interface PlanDrawOptions {
  /** one output pixel in metres */
  px: number;
  layers?: Partial<PlanLayers>;
  /** add data-tip="…" hooks for the web plan's hover details (f<i>, c<i>, o<i>, start, rostrum) */
  tips?: boolean;
  /** prefix for pattern ids, unique per page (default "plan") */
  id?: string;
  /** "print": the build sheet's light print palette, with outlines and hatching that survive black-and-white printing */
  palette?: "plan" | "print";
  /** false: leave out the patterns and the track area, so the chosen layers can sit over another drawing (the
   * designer draws the checks layer alone over its handles this way). Only for layers that use no patterns: checks,
   * racing line, start, dividers, grid and obstacles; lanes, rostrum and print jumps need the patterns. */
  background?: boolean;
}

export const PLAN_MARGIN = 2.5; // m around the area (room for the rostrum)
export const PIPE_THICKNESS = 0.08; // m (2 × PIPE_R in bake.ts)
export const GRID_BOXES = 10; // a full final
const ROSTRUM_SIZE: [number, number] = [5, 1.2]; // m, along × across its side

/** A layout's plan: its built geometry on its drawing area. Add a venue's obstacles and rostrum to place it in one. */
export function planScene(doc: Pick<RcTrack, "area" | "built">): PlanScene {
  return { area: drawingArea(doc), built: doc.built };
}

/** Plan point → SVG, rounded to the millimetre. */
const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
const pt = (x: number, z: number) => `${n(x)} ${n(-z)}`;
const path = (ps: ArrayLike<number>[], closed: boolean) => `M${Array.from(ps, (p) => pt(p[0], p[1])).join(" L")}${closed ? " Z" : ""}`;

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------------------------------- jumps

export interface JumpSymbol {
  /** stretches of the jump off the ground, metres along from the entry edge */
  humps: { from: number; to: number }[];
  /** take-off edges (metres along) */
  takeoffs: number[];
  /** other edges where the profile bends, off the ground */
  edges: number[];
  /** downhill faces [from, to], hatched */
  down: [number, number][];
}

/** How a jump is drawn, read from its `profile` ([along, height] from the entry edge). */
export function jumpSymbol(f: Pick<BuiltFeature, "profile">): JumpSymbol {
  const p = f.profile;
  const humps: JumpSymbol["humps"] = [];
  const down: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i + 1 < p.length; i++) {
    const [a0, h0] = p[i], [a1, h1] = p[i + 1];
    const ground = h0 <= 0 && h1 <= 0;
    if (!ground && start === null) start = a0;
    if (h1 < h0 && a1 > a0) down.push([a0, a1]);
    // a hump ends where the profile touches the ground again (whoops: one hump per wave)
    if (!ground && h1 <= 0 && start !== null) {
      humps.push({ from: start, to: a1 });
      start = null;
    }
  }
  if (start !== null) humps.push({ from: start, to: p[p.length - 1][0] });
  if (p.length < 2) return { humps: [], takeoffs: [], edges: [], down };

  // take-off: the top of a ramp (rising face, then flat or falling)
  const isTop = (i: number) => p[i][1] > 0 && p[i][1] > p[i - 1][1] && p[i][0] > p[i - 1][0] && p[i + 1][1] <= p[i][1];
  let takeoffs: number[] = [];
  for (let i = 1; i + 1 < p.length; i++) if (isTop(i)) takeoffs.push(p[i][0]);
  // no ramp (a step-down): drive off the end of the flat top
  if (!takeoffs.length) for (let i = 1; i + 1 < p.length; i++) if (p[i][1] > 0 && p[i][1] === p[i - 1][1] && p[i + 1][1] < p[i][1]) takeoffs.push(p[i][0]);
  takeoffs = [...new Set(takeoffs)];
  const ends = new Set(humps.flatMap((h) => [h.from, h.to]));
  const edges = [...new Set(p.filter(([a, h]) => h > 0 && !takeoffs.includes(a) && !ends.has(a)).map(([a]) => a))];
  return { humps, takeoffs, edges, down };
}

function drawJump(f: BuiltFeature, i: number, px: number, tips: boolean, P: Palette, print: boolean, id: string): string {
  const h = (f.heading * Math.PI) / 180;
  const tx = Math.cos(h), tz = Math.sin(h), nx = -tz, nz = tx;
  const at = (along: number, across: number): Point2 => [f.x + tx * (along - f.length / 2) + nx * across, f.z + tz * (along - f.length / 2) + nz * across];
  const half = f.width / 2;
  const across = (a: number) => `M${pt(...at(a, -half))} L${pt(...at(a, half))}`;
  const sym = jumpSymbol(f);
  if (!sym.humps.length) sym.humps.push({ from: 0, to: f.length }); // no profile: the footprint, plain
  const hair = n(px);
  const o: string[] = [`<g class="p-jump" data-type="${escapeXml(f.type)}"${tips ? ` data-tip="f${i}"` : ""}>`];
  for (const hp of sym.humps) {
    const quad = [at(hp.from, -half), at(hp.to, -half), at(hp.to, half), at(hp.from, half)];
    o.push(`<path class="p-jump-body" d="${path(quad, true)}" fill="${P["plan-jump"]}" stroke="${P["plan-jump-edge"]}" stroke-width="${hair}" stroke-linejoin="round"/>`);
    if (print) o.push(`<path class="p-jump-print-hatch" d="${path(quad, true)}" fill="url(#${id}-jump-hatch)"/>`);
  }
  // downhill faces: hatch lines across, every ~10 cm (at least 3 px apart)
  const step = Math.max(0.1, 3 * px);
  const hatch: string[] = [];
  for (const [a0, a1] of sym.down) for (let a = a0 + step / 2; a < a1; a += step) hatch.push(across(a));
  if (hatch.length) o.push(`<path class="p-jump-hatch" d="${hatch.join(" ")}" stroke="${P["plan-jump-edge"]}" stroke-opacity="0.45" stroke-width="${hair}" fill="none"/>`);
  if (sym.edges.length) o.push(`<path class="p-jump-edge" d="${sym.edges.map(across).join(" ")}" stroke="${P["plan-jump-edge"]}" stroke-width="${hair}" fill="none"/>`);
  for (const a of sym.takeoffs) o.push(`<path class="p-jump-takeoff" d="${across(a)}" stroke="${P["plan-jump-edge"]}" stroke-width="${n(Math.max(0.05, 2.5 * px))}" stroke-linecap="butt" fill="none"/>`);
  // direction of travel, on the longest hump
  const main = sym.humps.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a), sym.humps[0] ?? { from: 0, to: f.length });
  const mid = (main.from + main.to) / 2;
  const c = Math.min(f.width * 0.18, Math.max((main.to - main.from) * 0.3, 0.15), 0.35);
  o.push(
    `<path class="p-jump-dir" d="M${pt(...at(mid - c / 2, -c))} L${pt(...at(mid + c / 2, 0))} L${pt(...at(mid - c / 2, c))}" stroke="${P["plan-jump-edge"]}" stroke-width="${n(Math.max(0.03, 1.5 * px))}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  );
  o.push("</g>");
  return o.join("");
}

// ---------------------------------------------------------------------------------------------------- racing line helpers

/** Cumulative distance along the closed racing line, per point. */
function along(line: Built["racingLine"]): number[] {
  const s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  return s;
}

function nearestIndex(line: Built["racingLine"], x: number, z: number): { i: number; d: number } {
  let best = 0, bd = Infinity;
  line.forEach((p, i) => {
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < bd) (bd = d), (best = i);
  });
  return { i: best, d: bd };
}

/** Point and heading (radians) `back` metres before index `i0`, walking the closed line backwards. */
function walkBack(line: Built["racingLine"], i0: number, back: number): { x: number; z: number; h: number; w: number } {
  const len = line.length;
  let i = i0, left = back;
  for (let k = 0; k < len; k++) {
    const p = line[i], q = line[(i - 1 + len) % len];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d >= left && d > 0) {
      const t = left / d;
      return { x: p[0] + (q[0] - p[0]) * t, z: p[1] + (q[1] - p[1]) * t, h: Math.atan2(p[1] - q[1], p[0] - q[0]), w: p[2] };
    }
    left -= d;
    i = (i - 1 + len) % len;
  }
  return { x: line[i0][0], z: line[i0][1], h: 0, w: line[i0][2] };
}

/** Lane surface for files without built.lanes: runs of the racing line stroked at lane width (2 cm steps). */
function laneRuns(line: Built["racingLine"]): { d: string; w: number }[] {
  const len = line.length;
  if (len < 2) return [];
  const q = (w: number) => Math.round(w * 50) / 50;
  const runs: { pts: Point2[]; w: number }[] = [];
  for (let i = 0; i < len; i++) {
    const a = line[i], b = line[(i + 1) % len];
    const w = q((a[2] + b[2]) / 2);
    const last = runs[runs.length - 1];
    if (last && last.w === w) last.pts.push([b[0], b[1]]);
    else runs.push({ pts: [[a[0], a[1]], [b[0], b[1]]], w });
  }
  return runs.map((r) => ({ d: path(r.pts, false), w: r.w }));
}

/** Chevrons along the racing line every `every` metres. */
function arrows(line: Built["racingLine"], every = 8): { x: number; z: number; h: number }[] {
  const out: { x: number; z: number; h: number }[] = [];
  let acc = every / 2;
  for (let i = 0; i < line.length; i++) {
    const p = line[i], q = line[(i + 1) % line.length];
    acc += Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (acc >= every) {
      acc = 0;
      out.push({ x: (p[0] + q[0]) / 2, z: (p[1] + q[1]) / 2, h: Math.atan2(q[1] - p[1], q[0] - p[0]) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- the layers

/** The plan's contents (no <svg> wrapper): for the web plan, which adds its own view, controls and overlays. */
export function planLayers(scene: PlanScene, opts: PlanDrawOptions): string {
  const { area, obstacles = [], built } = scene;
  const px = opts.px;
  const layers = { ...ALL_PLAN_LAYERS, ...opts.layers };
  const id = opts.id ?? "plan";
  const print = opts.palette === "print";
  const P = print ? PRINT_ROLES : PLAN_PALETTE;
  const tips = !!opts.tips;
  const tip = (k: string) => (tips ? ` data-tip="${k}"` : "");
  const L = area.length, W = area.width;
  const hair = n(px);
  const o: string[] = [];

  // patterns: carpet texture (fine fibres) and the rostrum hatch, sized so they never get finer than a few pixels
  if (opts.background !== false) {
    const tex = Math.max(0.06, 4 * px);
    const hatch = Math.max(0.25, 6 * px);
    o.push(
      `<defs>` +
        `<pattern id="${id}-carpet-tex" patternUnits="userSpaceOnUse" width="${n(tex)}" height="${n(tex)}">` +
        `<path d="M0 ${n(tex)} L${n(tex / 2)} ${n(tex / 2)}" stroke="${P["plan-pipe"]}" stroke-opacity="0.07" stroke-width="${n(tex * 0.22)}"/>` +
        `<path d="M${n(tex / 2)} ${n(tex)} L${n(tex)} ${n(tex / 2)}" stroke="${P["plan-floor"]}" stroke-opacity="0.16" stroke-width="${n(tex * 0.22)}"/>` +
        `<path d="M0 ${n(tex / 2)} L${n(tex / 2)} 0" stroke="${P["plan-floor"]}" stroke-opacity="0.12" stroke-width="${n(tex * 0.18)}"/>` +
        `</pattern>` +
        `<pattern id="${id}-hatch" patternUnits="userSpaceOnUse" width="${n(hatch)}" height="${n(hatch)}" patternTransform="rotate(45)">` +
        `<path d="M0 0 L0 ${n(hatch)}" stroke="${P["plan-floor"]}" stroke-opacity="0.45" stroke-width="${n(Math.max(0.04, px))}"/>` +
        `</pattern>` +
        (print
          ? `<pattern id="${id}-jump-hatch" patternUnits="userSpaceOnUse" width="${n(Math.max(0.12, 4 * px))}" height="${n(Math.max(0.12, 4 * px))}" patternTransform="rotate(45)">` +
            `<path d="M0 0 L0 ${n(Math.max(0.12, 4 * px))}" stroke="${P["plan-jump-edge"]}" stroke-width="${n(Math.max(0.015, 0.75 * px))}"/>` +
            `</pattern>`
          : "") +
        `</defs>`,
    );

    o.push(`<rect class="p-area" x="${n(-L / 2)}" y="${n(-W / 2)}" width="${n(L)}" height="${n(W)}" fill="${P["plan-area"]}"${print ? ` stroke="${P["plan-pipe"]}" stroke-width="${n(2 * px)}"` : ""}/>`);
  }

  if (layers.obstacles)
    obstacles.forEach((ob, i) => {
      if (ob.type === "circle" && print) {
        const k = ob.radius * Math.SQRT1_2;
        o.push(
          `<g class="p-obstacle"${tip(`o${i}`)}><circle cx="${n(ob.x)}" cy="${n(-ob.z)}" r="${n(ob.radius)}" fill="${P["plan-obstacle"]}" stroke="${P["plan-pipe"]}" stroke-width="${n(1.5 * px)}"/>` +
            `<path d="M${pt(ob.x - k, ob.z - k)} L${pt(ob.x + k, ob.z + k)} M${pt(ob.x - k, ob.z + k)} L${pt(ob.x + k, ob.z - k)}" stroke="${P["plan-pipe"]}" stroke-width="${n(px)}"/></g>`,
        );
      } else if (ob.type === "circle") o.push(`<circle class="p-obstacle" cx="${n(ob.x)}" cy="${n(-ob.z)}" r="${n(ob.radius)}" fill="${P["plan-obstacle"]}"${tip(`o${i}`)}/>`);
      else
        o.push(
          `<rect class="p-keepout" x="${n(ob.x - ob.length / 2)}" y="${n(-ob.z - ob.width / 2)}" width="${n(ob.length)}" height="${n(ob.width)}" transform="rotate(${n(-(ob.rotation ?? 0))} ${n(ob.x)} ${n(-ob.z)})" fill="${P["plan-obstacle"]}" fill-opacity="0.35" stroke="${print ? P["plan-pipe"] : P["plan-obstacle"]}" stroke-width="${n(1.5 * px)}" stroke-dasharray="${n(6 * px)} ${n(4 * px)}"${tip(`o${i}`)}/>`,
        );
    });

  // carpet
  if (layers.lanes && built) {
    if (built.lanes) {
      const d = `${path(built.lanes.right, true)} ${path(built.lanes.left, true)}`;
      o.push(`<path class="p-carpet" d="${d}" fill="${P["plan-carpet"]}" fill-rule="evenodd"/>`);
      if (!print) o.push(`<path class="p-carpet-tex" d="${d}" fill="url(#${id}-carpet-tex)" fill-rule="evenodd"/>`);
    } else {
      const runs = laneRuns(built.racingLine);
      for (const paint of print ? [P["plan-carpet"]] : [P["plan-carpet"], `url(#${id}-carpet-tex)`])
        o.push(`<g class="p-carpet" fill="none" stroke="${paint}" stroke-linejoin="round" stroke-linecap="round">${runs.map((r) => `<path d="${r.d}" stroke-width="${n(r.w)}"/>`).join("")}</g>`);
    }
  }

  // 1 m grid over the carpet, from the south-west corner (as the build sheet measures), every fifth line major
  if (layers.grid) {
    const minor: string[] = [], major: string[] = [];
    for (let k = 1; k < L; k++) (k % 5 ? minor : major).push(`M${n(-L / 2 + k)} ${n(-W / 2)} V${n(W / 2)}`);
    for (let k = 1; k < W; k++) (k % 5 ? minor : major).push(`M${n(-L / 2)} ${n(W / 2 - k)} H${n(L / 2)}`);
    for (const d of minor) o.push(`<path class="p-grid" d="${d}" stroke="${P["plan-grid"]}" stroke-width="${hair}"/>`);
    for (const d of major) o.push(`<path class="p-grid-major" d="${d}" stroke="${P["plan-grid-major"]}" stroke-width="${hair}"/>`);
  }

  // errors: a 3 px overlay on the lane ±1.5 m around the problem (a ring if it's off the lane)
  const marks: string[] = [];
  if (layers.checks && built) {
    const s = along(built.racingLine);
    const total = s[s.length - 1] + Math.hypot(built.racingLine[0][0] - built.racingLine[built.racingLine.length - 1][0], built.racingLine[0][1] - built.racingLine[built.racingLine.length - 1][1]);
    built.checks.forEach((c, i) => {
      if (c.x === undefined || c.z === undefined || c.level === "info") return;
      const ring = (cls: string, colour: string, w: number) =>
        `<circle class="${cls}" cx="${n(c.x!)}" cy="${n(-c.z!)}" r="${n(Math.max(0.5, 9 * px))}" fill="none" stroke="${colour}" stroke-width="${n(w * px)}"${tip(`c${i}`)}/>`;
      if (c.level === "warning") return void marks.push(ring("p-warning", P["plan-warning"], 2));
      const near = nearestIndex(built.racingLine, c.x, c.z);
      if (near.d > built.racingLine[near.i][2] / 2 + 0.3) return void marks.push(ring("p-error", P["plan-error"], 3));
      // one continuous run either side of the problem (the line is closed: wrap round point 0)
      const len = built.racingLine.length;
      const gap = (k: number) => {
        const d = Math.abs(s[k] - s[near.i]);
        return Math.min(d, total - d);
      };
      let a = 0, b = 0;
      while (a < len - 1 && gap((near.i - a - 1 + len) % len) <= 1.5) a++;
      while (b < len - 1 - a && gap((near.i + b + 1) % len) <= 1.5) b++;
      const pts = Array.from({ length: a + b + 1 }, (_, k) => built.racingLine[(near.i - a + k + len) % len]);
      o.push(`<path class="p-error" d="${path(pts, false)}" fill="none" stroke="${P["plan-error"]}" stroke-width="${n(3 * px)}" stroke-linecap="round" stroke-linejoin="round"${tip(`c${i}`)}/>`);
    });
  }

  if (layers.racingLine && built) {
    o.push(
      `<path class="p-line" d="${path(built.racingLine, true)}" fill="none" stroke="${P["plan-line"]}" stroke-width="${n(1.5 * px)}" stroke-dasharray="${n(4 * px)} ${n(3 * px)}" stroke-linejoin="round"/>`,
    );
    const c = Math.max(0.22, 5 * px);
    for (const a of arrows(built.racingLine)) {
      const t: Point2 = [Math.cos(a.h), Math.sin(a.h)], nrm: Point2 = [-t[1], t[0]];
      const p = (u: number, v: number): Point2 => [a.x + t[0] * u + nrm[0] * v, a.z + t[1] * u + nrm[1] * v];
      o.push(`<path class="p-arrow" d="M${pt(...p(-c / 2, -c))} L${pt(...p(c / 2, 0))} L${pt(...p(-c / 2, c))}" fill="none" stroke="${P["plan-line"]}" stroke-width="${n(2 * px)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }

  if (layers.start && built) o.push(drawStart(built, px, tip("start"), P));
  if (layers.features && built) built.features.forEach((f, i) => o.push(drawJump(f, i, px, tips, P, print, id)));

  // pipes at real thickness (at least 1.5 px), a core line inside shared ones
  if (layers.dividers && built) {
    const w = Math.max(PIPE_THICKNESS, 1.5 * px);
    for (const d of built.dividers) {
      const dd = path(d.points, d.closed);
      o.push(`<path class="p-pipe" d="${dd}" fill="none" stroke="${P["plan-pipe"]}" stroke-width="${n(w)}" stroke-linejoin="round" stroke-linecap="round"/>`);
      if (d.shared) o.push(`<path class="p-shared" d="${dd}" fill="none" stroke="${P["plan-pipe-shared"]}" stroke-width="${n(w * 0.45)}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  }

  const r = scene.rostrum;
  if (layers.rostrum && r) {
    const ew = r.side === "east" || r.side === "west";
    const [a, b] = ew ? [ROSTRUM_SIZE[1], ROSTRUM_SIZE[0]] : ROSTRUM_SIZE;
    const box = `x="${n(r.x - a / 2)}" y="${n(-r.z - b / 2)}" width="${n(a)}" height="${n(b)}"`;
    if (print)
      o.push(
        `<g class="p-rostrum"><rect ${box} fill="${P["plan-rostrum"]}" stroke="${P["plan-pipe"]}" stroke-width="${n(1.5 * px)}"/>` +
          `<text x="${n(r.x)}" y="${n(-r.z)}" dy="0.35em" text-anchor="middle" font-size="${n(Math.min(a, b) * 0.45)}" font-family="Inter, 'DejaVu Sans', sans-serif" fill="${P["plan-pipe"]}"${ew ? ` transform="rotate(-90 ${n(r.x)} ${n(-r.z)})"` : ""}>ROSTRUM</text></g>`,
      );
    else o.push(`<g class="p-rostrum"${tip("rostrum")}><rect ${box} fill="${P["plan-rostrum"]}"/><rect ${box} fill="url(#${id}-hatch)"/></g>`);
  }

  if (layers.obstacles)
    obstacles.forEach((ob) => {
      if (ob.label)
        o.push(`<text class="p-label" x="${n(ob.x)}" y="${n(-ob.z)}" dy="0.35em" text-anchor="middle" font-size="${n(Math.max(0.35, 11 * px))}" font-family="Inter, 'DejaVu Sans', sans-serif" fill="${P["plan-pipe"]}">${escapeXml(ob.label)}</text>`);
    });

  o.push(...marks);
  return o.join("");
}

/** Chequered start line across the lane, grid boxes behind it, and a chevron for the direction of travel. */
function drawStart(built: Built, px: number, tipAttr: string, P: Palette): string {
  const s = built.startLine;
  const h = (s.heading * Math.PI) / 180;
  const t: Point2 = [Math.cos(h), Math.sin(h)], nrm: Point2 = [-t[1], t[0]];
  const at = (u: number, v: number, o: { x: number; z: number } = s): Point2 => [o.x + t[0] * u + nrm[0] * v, o.z + t[1] * u + nrm[1] * v];
  const o: string[] = [`<g class="p-start"${tipAttr}>`];
  const across = Math.max(4, Math.round(s.width / 0.2));
  const sq = s.width / across;
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < across; k++) {
      const u0 = (row - 1) * sq, v0 = -s.width / 2 + k * sq;
      const cls = (row + k) % 2 ? "p-start-b" : "p-start-a";
      const colour = (row + k) % 2 ? P["plan-floor"] : P["plan-pipe"];
      o.push(`<path class="${cls}" d="${path([at(u0, v0), at(u0 + sq, v0), at(u0 + sq, v0 + sq), at(u0, v0 + sq)], true)}" fill="${colour}"/>`);
    }
  // grid boxes: staggered pairs behind the line (cars ~0.45 × 0.28 m), as many as fit on the straight
  const line = built.racingLine;
  if (line.length > 1) {
    const { i } = nearestIndex(line, s.x, s.z);
    for (let k = 0; k < GRID_BOXES; k++) {
      const back = 0.6 + Math.floor(k / 2) * 1.0 + (k % 2) * 0.5;
      const p = walkBack(line, i, back);
      const tail = walkBack(line, i, back + 0.3).h; // the back of the box is on the straight too
      if (Math.abs(((tail - h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > (12 * Math.PI) / 180) break;
      const side = k % 2 ? -1 : 1;
      const ox = p.x - Math.sin(p.h) * side * (p.w / 4), oz = p.z + Math.cos(p.h) * side * (p.w / 4);
      o.push(
        `<rect class="p-gridbox" transform="translate(${pt(ox, oz)}) rotate(${n((-p.h * 180) / Math.PI)})" x="-0.225" y="-0.14" width="0.45" height="0.28" fill="none" stroke="${P["plan-pipe"]}" stroke-opacity="0.75" stroke-width="${n(Math.max(0.02, px))}"/>`,
      );
    }
  }
  const c = Math.max(0.25, 5 * px);
  o.push(
    `<path class="p-start-dir" d="M${pt(...at(1.2 - c / 2, -c))} L${pt(...at(1.2 + c / 2, 0))} L${pt(...at(1.2 - c / 2, c))}" fill="none" stroke="${P["plan-line"]}" stroke-width="${n(Math.max(0.05, 2 * px))}" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  o.push("</g>");
  return o.join("");
}

// ---------------------------------------------------------------------------------------------------- standalone

export interface PlanSvgOptions {
  /** picture width in px; the height follows the area's proportions */
  width: number;
  layers?: Partial<PlanLayers>;
  id?: string;
  /** default true */
  scaleBar?: boolean;
  /**
   * output pixels per display pixel (default 1): a 1200 px picture shown at 480 px wants 2.5, so hairlines, chevrons
   * and labels keep their on-screen size wherever the picture is shown
   */
  pixelRatio?: number;
}

export function planBounds(area: Area, margin = PLAN_MARGIN) {
  return { x0: -area.length / 2 - margin, y0: -area.width / 2 - margin, w: area.length + 2 * margin, h: area.width + 2 * margin };
}

export const planHeight = (area: Area, width: number) => Math.round((width * (area.width + 2 * PLAN_MARGIN)) / (area.length + 2 * PLAN_MARGIN));

/** 1, 2 or 5 × 10^n, close to `m`. */
export function niceLength(m: number): number {
  const p = 10 ** Math.floor(Math.log10(m));
  const f = m / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** The plan's contents fitted into a px box (x, y, w, h), as a nested <svg>: for pictures made of several parts. */
export function planInBox(scene: PlanScene, box: { x: number; y: number; w: number; h: number }, opts: Omit<PlanSvgOptions, "width"> = {}): string {
  if (!(box.w > 0 && box.h > 0)) throw new Error("planInBox: box needs a positive width and height");
  const b = planBounds(scene.area);
  const px = Math.max(b.w / box.w, b.h / box.h) * (opts.pixelRatio ?? 1);
  return `<svg x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" viewBox="${n(b.x0)} ${n(b.y0)} ${n(b.w)} ${n(b.h)}">${planLayers(scene, { px, layers: opts.layers, id: opts.id })}${opts.scaleBar === false ? "" : scaleBar(scene, px)}</svg>`;
}

/** Scale bar in the margin on the side away from the rostrum. */
function scaleBar(scene: PlanScene, px: number): string {
  const { area } = scene;
  const b = planBounds(area);
  const m = niceLength(b.w / 6);
  const side = scene.rostrum?.side;
  const y = side === "south" ? -area.width / 2 - PLAN_MARGIN / 2 : area.width / 2 + PLAN_MARGIN / 2;
  const x = -area.length / 2;
  const tick = Math.max(0.15, 4 * px);
  const w = n(Math.max(0.03, 1.5 * px));
  return (
    `<g class="p-scale"><path d="M${n(x)} ${n(y)} H${n(x + m)} M${n(x)} ${n(y - tick)} V${n(y + tick)} M${n(x + m)} ${n(y - tick)} V${n(y + tick)}" stroke="${P["plan-pipe"]}" stroke-width="${w}" fill="none"/>` +
    `<text x="${n(x + m + 0.3)}" y="${n(y)}" dy="0.35em" font-size="${n(Math.max(0.4, 12 * px))}" font-family="Inter, 'DejaVu Sans', sans-serif" fill="${P["plan-pipe"]}">${m} m</text></g>`
  );
}

/** A standalone SVG of the plan: floor, area plus margins, everything on it and a scale bar. */
export function planSvg(scene: PlanScene, opts: PlanSvgOptions): string {
  if (!(opts.width > 0)) throw new Error("planSvg: width must be positive");
  const b = planBounds(scene.area);
  const px = (b.w / opts.width) * (opts.pixelRatio ?? 1);
  const height = planHeight(scene.area, opts.width);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${height}" viewBox="${n(b.x0)} ${n(b.y0)} ${n(b.w)} ${n(b.h)}">` +
    `<rect class="p-floor" x="${n(b.x0)}" y="${n(b.y0)}" width="${n(b.w)}" height="${n(b.h)}" fill="${P["plan-floor"]}"/>` +
    planLayers(scene, { px, layers: opts.layers, id: opts.id }) +
    (opts.scaleBar === false ? "" : scaleBar(scene, px)) +
    `</svg>`
  );
}

/** Where a venue's rostrum stands (venue plans have no `built`). */
export const venueRostrum = (area: Area, side: Side = "south", offset = 0) => {
  const [x, z] = rostrumPosition(area, side, offset);
  return { side, x, z };
};
