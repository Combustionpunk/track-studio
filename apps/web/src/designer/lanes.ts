// Quick mode step 1, "Lay the lanes": paint the lane through squares the size of the lane width, then close the loop
// into corner points. Pure (no DOM): the designer turns each painted step into one undo step.
import type { Area, DesignPoint, Obstacle, Point2 } from "@track-studio/engine";
import { PIPE_R, racingLine } from "@track-studio/engine";

/** [column, row] of a grid square, counted from the area's south-west corner */
export type Cell = [number, number];

export interface LaneGrid {
  /** square size = the design's lane width (m) */
  size: number;
  /** south-west corner of the area, where square [0, 0] starts */
  origin: Point2;
  cols: number;
  rows: number;
  /** "col,row" of squares an obstacle overlaps */
  blocked: Set<string>;
}

/**
 * A square is blocked when an obstacle reaches into it or into the pipe round it: the bake checks obstacles against
 * the lanes plus half the pipe's thickness (PIPE_R), so a lane square touching an obstacle would fail.
 */
const MARGIN = PIPE_R; // m

export const key = (c: Cell) => `${c[0]},${c[1]}`;
export const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

const tidy = (v: number) => Math.round(v * 1000) / 1000;

/** Whole lane-width squares inside the area, from its south-west corner, with the obstacle-blocked ones. */
export function laneGrid(area: Area, obstacles: Obstacle[], size: number): LaneGrid {
  const origin: Point2 = [-area.length / 2, -area.width / 2];
  // a hair of tolerance so 22 m / 2 m is 11 squares, not 10.999…
  const cols = Math.max(0, Math.floor(area.length / size + 1e-9)), rows = Math.max(0, Math.floor(area.width / size + 1e-9));
  const g: LaneGrid = { size, origin, cols, rows, blocked: new Set() };
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      const [x0, z0] = cellCorner(g, [c, r]);
      if (obstacles.some((o) => overlaps(o, x0 - MARGIN, z0 - MARGIN, x0 + size + MARGIN, z0 + size + MARGIN))) g.blocked.add(key([c, r]));
    }
  return g;
}

/** south-west corner of a square */
export const cellCorner = (g: LaneGrid, c: Cell): Point2 => [g.origin[0] + c[0] * g.size, g.origin[1] + c[1] * g.size];

export const cellCentre = (g: LaneGrid, c: Cell): Point2 => [tidy(g.origin[0] + (c[0] + 0.5) * g.size), tidy(g.origin[1] + (c[1] + 0.5) * g.size)];

/** The square under a plan point, or null off the grid. */
export function cellAt(g: LaneGrid, p: Point2): Cell | null {
  const c = Math.floor((p[0] - g.origin[0]) / g.size), r = Math.floor((p[1] - g.origin[1]) / g.size);
  return c >= 0 && c < g.cols && r >= 0 && r < g.rows ? [c, r] : null;
}

/**
 * The square a drag is over, coming from `cur`: it only moves on to a square next to `cur` once the pointer is well
 * inside it (the middle 60%), so a diagonal drag that clips a side square near the shared corner goes corner to corner
 * instead of laying a staircase. A square further away (a fast drag) is taken at once; painting fills the gap.
 */
export function dragCell(g: LaneGrid, p: Point2, cur: Cell | null): Cell | null {
  const c = cellAt(g, p);
  if (!c || !cur || !neighbours(c, cur)) return c;
  const [x, z] = cellCentre(g, c);
  return Math.max(Math.abs(p[0] - x), Math.abs(p[1] - z)) <= 0.3 * g.size ? c : cur;
}

export const isBlocked = (g: LaneGrid, c: Cell) => g.blocked.has(key(c));

/** Does the obstacle overlap the axis-aligned box? Separating axes for rectangles (any rotation), nearest point for circles. */
function overlaps(o: Obstacle, x0: number, z0: number, x1: number, z1: number): boolean {
  if (o.type === "circle") {
    const dx = Math.max(x0 - o.x, 0, o.x - x1), dz = Math.max(z0 - o.z, 0, o.z - z1);
    return Math.hypot(dx, dz) < o.radius;
  }
  const a = ((o.rotation ?? 0) * Math.PI) / 180;
  const u: Point2 = [Math.cos(a), Math.sin(a)], v: Point2 = [-Math.sin(a), Math.cos(a)];
  const hl = o.length / 2, hw = o.width / 2;
  const rect: Point2[] = [
    [o.x + u[0] * hl + v[0] * hw, o.z + u[1] * hl + v[1] * hw],
    [o.x - u[0] * hl + v[0] * hw, o.z - u[1] * hl + v[1] * hw],
    [o.x - u[0] * hl - v[0] * hw, o.z - u[1] * hl - v[1] * hw],
    [o.x + u[0] * hl - v[0] * hw, o.z + u[1] * hl - v[1] * hw],
  ];
  const box: Point2[] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const axes: Point2[] = [[1, 0], [0, 1], u, v];
  return axes.every((ax) => {
    const proj = (ps: Point2[]) => ps.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    const A = proj(rect), B = proj(box);
    return Math.min(Math.max(...A), Math.max(...B)) > Math.max(Math.min(...A), Math.min(...B));
  });
}

// ---------------------------------------------------------------------------------------------- painting
/** The lane so far, in driving order. `closed` once it's come back to its first square. */
export interface Laying {
  cells: Cell[];
  closed: boolean;
}

/** fewest squares a loop can close with */
export const MIN_LOOP = 4;

export type Refusal = "blocked" | "used" | "crossing" | "dead-end" | "corner" | "outside";

export const REFUSAL_TEXT: Record<Refusal, string> = {
  blocked: "That square is blocked by a fixed obstacle.",
  used: "That square is already part of the lane. Drag back to take squares up.",
  crossing: "The lane can only cross itself straight across, at right angles.",
  "dead-end": "A crossing needs the lane to carry straight on.",
  corner: "A diagonal can't cut past a square blocked by a fixed obstacle.",
  outside: "Start the lane on a whole square inside the track area.",
};

/**
 * step 1's hint on turns. #104: tight corners paint (a 135° turn, a diagonal beside the lane, a lane beside a V's
 * point); step 2 rounds them and the bake says where lanes squeeze (a warning) or overlap (an error).
 */
export const TURNS_HINT = "Turns are 45°, 90° or 135°. Step 2 rounds them and shows where lanes squeeze or overlap.";

/**
 * Squares from `a` to `b` one step at a time (`a` excluded, `b` included): diagonal steps while both the column and
 * the row still differ, then straight. That's how a fast drag that skips squares is filled in.
 */
export function stepsBetween(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  let [c, r] = a;
  while (c !== b[0] || r !== b[1]) out.push([(c += Math.sign(b[0] - c)), (r += Math.sign(b[1] - r))]);
  return out;
}

/** next to each other, straight or corner to corner */
export const neighbours = (a: Cell, b: Cell) => !same(a, b) && Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;
const dir = (a: Cell, b: Cell): Cell => [b[0] - a[0], b[1] - a[1]];
const diagonal = (d: Cell) => d[0] !== 0 && d[1] !== 0;
/** the two squares a diagonal step from `a` to `b` passes between */
const passesBetween = (a: Cell, b: Cell): Cell[] => [[b[0], a[1]], [a[0], b[1]]];
/**
 * A V: a 90° turn between two diagonals at `b`. Its outside, square, would reach about 0.2 of the width into the square
 * beyond its point; round (as loopPoints lays it) it stays inside its own square, flush with its neighbours' (#104).
 */
const isV = (a: Cell, b: Cell, c: Cell) => {
  const [d, e] = [dir(a, b), dir(b, c)];
  return diagonal(d) && diagonal(e) && d[0] * e[0] + d[1] * e[1] === 0;
};
/** does the lane step straight from one of `p`, `q` to the other (a diagonal between them, which another would cross)? */
const stepsAcross = (cells: Cell[], [p, q]: Cell[]) =>
  cells.some((c, i) => i > 0 && ((same(c, p) && same(cells[i - 1], q)) || (same(c, q) && same(cells[i - 1], p))));
/** does the lane go straight through cells[i] (no turn there), from cells[i - 1] to cells[i + 1]? */
const straightAt = (cells: Cell[], i: number) => same(dir(cells[i - 1], cells[i]), dir(cells[i], cells[i + 1]));

/**
 * Can the lane step onto `step`, a square it already uses, from its end? Only as a crossing: used once before, not the
 * first square, the first pass straight through it and the new one at right angles, both along the grid (no diagonal
 * X), with somewhere to go straight on (painting refuses a turn there on the next step). A crossing with nowhere to go
 * straight on is a dead end.
 */
function crossable(g: LaneGrid, cells: Cell[], step: Cell): Refusal | null {
  const uses = cells.flatMap((c, i) => (same(c, step) ? [i] : []));
  if (uses.length !== 1 || uses[0] === 0) return "used";
  const j = uses[0];
  const [a, b] = [dir(cells[j], cells[j + 1]), dir(cells[cells.length - 1], step)];
  if (!straightAt(cells, j) || diagonal(a) || diagonal(b) || a[0] * b[0] + a[1] * b[1] !== 0) return "crossing";
  const on: Cell = [step[0] + b[0], step[1] + b[1]];
  const next = [...cells, step];
  if (same(on, cells[0])) return null; // straight on closes the loop
  if (!cellAt(g, cellCentre(g, on)) || isBlocked(g, on)) return "dead-end";
  return !cells.some((c) => same(c, on)) || !crossable(g, next, on) ? null : "dead-end";
}

/**
 * Paint from the end of the lane towards `target`: every step between is a new state (one undo step each). Stepping
 * back onto the previous square takes the last one up; stepping onto the first square with at least MIN_LOOP squares
 * closes the loop. Steps go to any of the eight neighbours, but a diagonal one can't pass a blocked square, nor cross a
 * diagonal of the lane's (an X). The lane may cross itself, straight across at right angles, once per square: off a
 * crossing it goes straight on. Stops at the first square it can't use, and says why.
 * #104: lanes may come closer than a lane width (a diagonal beside the lane, a 135° turn, a lane beside a V's point):
 * the bake decides whether they share a pipe (clean), squeeze (a lane-squeeze warning) or overlap (lane-overlap).
 */
export function paintTo(g: LaneGrid, lay: Laying, target: Cell): { states: Laying[]; refused?: Refusal } {
  const states: Laying[] = [];
  if (lay.closed) return { states };
  if (target[0] < 0 || target[0] >= g.cols || target[1] < 0 || target[1] >= g.rows) return { states, refused: "outside" };
  if (!lay.cells.length) {
    if (isBlocked(g, target)) return { states, refused: "blocked" };
    return { states: [{ cells: [target], closed: false }] };
  }
  let cells = lay.cells;
  for (const step of stepsBetween(cells[cells.length - 1], target)) {
    const n = cells.length;
    const closes = same(step, cells[0]) && n >= MIN_LOOP;
    if (n >= 2 && same(step, cells[n - 2])) {
      cells = cells.slice(0, -1);
    } else if (n >= 2 && cells.slice(0, -1).some((c) => same(c, cells[n - 1])) && !same(dir(cells[n - 2], cells[n - 1]), dir(cells[n - 1], step))) {
      return { states, refused: "crossing" }; // on a crossing: straight on only
    } else if (diagonal(dir(cells[n - 1], step)) && passesBetween(cells[n - 1], step).some((c) => isBlocked(g, c))) {
      return { states, refused: "corner" };
    } else if (diagonal(dir(cells[n - 1], step)) && stepsAcross(cells, passesBetween(cells[n - 1], step))) {
      return { states, refused: "crossing" };
    } else if (closes) {
      states.push({ cells, closed: true });
      return { states };
    } else if (isBlocked(g, step)) {
      return { states, refused: "blocked" };
    } else if (cells.some((c) => same(c, step))) {
      const refused = crossable(g, cells, step);
      if (refused) return { states, refused };
      cells = [...cells, step];
    } else {
      cells = [...cells, step];
    }
    states.push({ cells, closed: false });
  }
  return { states };
}

/**
 * Lifting the pointer at `p`: the step to the square under it, if that's next to the end of the lane and painting takes
 * it. A drag that ends near the edge of its last square, before dragCell moves on, still paints it, closing the loop
 * too. Never a step back onto the previous square (that would take the last one up) and never a refused square: there
 * the pointer only clipped it on the way out.
 */
export function releaseStep(g: LaneGrid, lay: Laying, p: Point2): Laying[] {
  const c = cellAt(g, p), n = lay.cells.length;
  if (lay.closed || !c || !n || !neighbours(c, lay.cells[n - 1]) || (n >= 2 && same(c, lay.cells[n - 2]))) return [];
  const r = paintTo(g, lay, c);
  return r.refused ? [] : r.states;
}

// ---------------------------------------------------------------------------------------------- closing
/**
 * Is this a closed loop of neighbouring squares (straight or corner to corner)? A square may be used twice only as a
 * crossing: not the first square, and both passes straight through it, at right angles along the grid.
 */
export function isLoop(cells: Cell[]): boolean {
  const n = cells.length;
  if (n < MIN_LOOP) return false;
  const at = (i: number) => cells[(i + n) % n];
  const passes = new Map<string, number[]>();
  cells.forEach((c, i) => passes.set(key(c), [...(passes.get(key(c)) ?? []), i]));
  for (const uses of passes.values()) {
    if (uses.length === 1) continue;
    if (uses.length > 2 || uses[0] === 0) return false;
    const [a, b] = uses.map((i) => dir(at(i), at(i + 1)));
    if (!uses.every((i) => same(dir(at(i - 1), at(i)), dir(at(i), at(i + 1)))) || diagonal(a) || diagonal(b) || a[0] * b[0] + a[1] * b[1] !== 0) return false;
  }
  return cells.every((c, i) => neighbours(c, at(i + 1)));
}

/**
 * The closed loop as `design.points`: a corner at the centre of every square where the direction changes (by 45°, 90°
 * or 135°; painting allows nothing sharper), in driving order, each with radius = width / 2: an apex radius of 0
 * whatever the turn, the inside edges of the two straights meeting at a point. Only x, z and radius are written, and
 * `outer: "round"` on a V (#104), so its outside stays inside its own square.
 */
export function loopPoints(g: LaneGrid, cells: Cell[]): DesignPoint[] {
  const n = cells.length;
  const out: DesignPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = cells[(i - 1 + n) % n], b = cells[i], c = cells[(i + 1) % n];
    if (b[0] - a[0] === c[0] - b[0] && b[1] - a[1] === c[1] - b[1]) continue;
    const [x, z] = cellCentre(g, b);
    out.push(isV(a, b, c) ? { x, z, radius: tidy(g.size / 2), outer: "round" } : { x, z, radius: tidy(g.size / 2) });
  }
  return out;
}

/** The start line in the middle of the longest straight, as a distance along the line from the first corner. */
export function startOnLongestStraight(points: DesignPoint[], laneWidth: number): number {
  const { corners } = racingLine(points, laneWidth);
  let s = 0, best = -1, at = 0;
  corners.forEach((c, i) => {
    s += c.r * c.th;
    const next = corners[(i + 1) % corners.length];
    const straight = Math.hypot(next.start[0] - c.end[0], next.start[1] - c.end[1]);
    // strictly longer, so ties go to the first
    if (straight > best + 1e-9) [best, at] = [straight, s + straight / 2];
    s += straight;
  });
  return Math.round(at * 1000) / 1000;
}

// ---------------------------------------------------------------------------------------------- the draft
/** What step 1 needs of the designer's draft: while `laying` is there, the design has no points yet. */
interface Layable {
  area: Area;
  laying?: Cell[];
  /** the squares of the closed loop, kept in step 2 so "1 · Lay the lanes" can reopen it */
  laid?: Cell[];
  design: { laneWidth?: number; points: DesignPoint[]; start?: { distance?: number } };
}

/** 1 · Lay the lanes (new designs, until the loop closes) or 2 · Shape it (everything with points). */
export const designStep = (d: Pick<Layable, "laying">): 1 | 2 => (d.laying ? 1 : 2);

/** The lane grid on the draft's area; `obstacles` (the venue guide's, never the draft's) block squares. */
export const gridFor = (d: Pick<Layable, "area" | "design">, obstacles: Obstacle[] = []) => laneGrid(d.area, obstacles, d.design.laneWidth ?? 2);

/** The draft after a painted step: still laying, or (closed) the loop's corner points and on to step 2. */
export function withLaying<D extends Layable>(d: D, lay: Laying): D {
  if (!lay.closed) {
    const { laid: _, ...rest } = d;
    return { ...rest, laying: lay.cells } as D;
  }
  const { laying: _, ...rest } = d;
  const lw = d.design.laneWidth ?? 2;
  const points = loopPoints(gridFor(d), lay.cells);
  return { ...rest, laid: lay.cells, design: { ...d.design, points, start: { ...d.design.start, distance: startOnLongestStraight(points, lw) } } } as D;
}

/**
 * Back to step 1 from step 2 ("1 · Lay the lanes", confirmed): the loop's squares reopen, one step from closing, as
 * after undoing the close, and the shaping is thrown away. A track that wasn't laid here starts from no squares.
 */
export function reopenLaying<D extends Layable>(d: D): D {
  const { laid, ...rest } = d;
  return { ...rest, laying: laid ?? [], design: { ...d.design, points: [] } } as unknown as D;
}
