// Quick mode step 1 from the keyboard (#47): a cursor square the arrows move, Enter or Space to start the lane on it,
// then the arrows lay it a square at a time through the same painting as the pointer (lanes.ts paintTo), Backspace
// takes the last square back, and Shift with two arrows in turn lays a diagonal step. Pure: the designer applies the
// states (one undo step each) and puts `say` in a live region.
import { cellAt, cellCentre, isBlocked, MIN_LOOP, paintTo, REFUSAL_TEXT, same, type Cell, type LaneGrid, type Laying, type Refusal } from "./lanes.js";

export interface LayKeys {
  /** the square Enter starts the lane on; the end of the lane once there is one */
  cursor: Cell;
  /** the first arrow of a Shift diagonal, waiting for the second */
  diagonal?: Cell;
}

export interface KeyPress {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export interface KeyResult {
  /** the lane after each painted square, in order (one undo step each); empty if nothing was laid */
  states: Laying[];
  keys: LayKeys;
  /** what to announce */
  say?: string;
  /** the key was ours: stop the browser and the plan doing anything else with it */
  handled: boolean;
}

/** where the cursor starts: the south-west square, where a loop round the edge would */
export const startCursor = (_g: LaneGrid): Cell => [0, 0];

const ARROWS: Record<string, Cell> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

const HEADING: Record<string, string> = {
  "1,0": "east",
  "1,1": "north-east",
  "0,1": "north",
  "-1,1": "north-west",
  "-1,0": "west",
  "-1,-1": "south-west",
  "0,-1": "south",
  "1,-1": "south-east",
};
const heading = (d: Cell) => HEADING[`${d[0]},${d[1]}`];

/** the keyboard's own words where the pointer's mention dragging or starting off the grid */
const KEY_REFUSAL: Partial<Record<Refusal, string>> = {
  used: "That square is already part of the lane. Backspace takes squares up.",
  outside: "That's the edge of the track area.",
};
export const refusal = (r: Refusal) => KEY_REFUSAL[r] ?? REFUSAL_TEXT[r];

const inGrid = (g: LaneGrid, c: Cell) => !!cellAt(g, cellCentre(g, c));

/** "column 3, row 2", counted from 1 at the south-west corner */
export const where = (c: Cell) => `column ${c[0] + 1}, row ${c[1] + 1}`;

/** "Square 5, heading east. The first square is 2 west, 3 south." */
export function describeLane(cells: Cell[]): string {
  const n = cells.length;
  if (!n) return "No lane yet. Enter or Space starts it on the cursor square.";
  const end = cells[n - 1];
  let s = n < MIN_LOOP ? `Square ${n} of ${MIN_LOOP} minimum` : `Square ${n}`;
  if (n === 1) return `${s}, ${where(end)}. The arrows lay the lane; Shift and two arrows for a diagonal.`;
  s += `, heading ${heading([end[0] - cells[n - 2][0], end[1] - cells[n - 2][1]])}`;
  if (cells.slice(0, -1).some((c) => same(c, end))) s += ", crossing the lane";
  if (n < MIN_LOOP) return `${s}.`;
  const dx = cells[0][0] - end[0], dz = cells[0][1] - end[1];
  const parts = [dx && `${Math.abs(dx)} ${dx > 0 ? "east" : "west"}`, dz && `${Math.abs(dz)} ${dz > 0 ? "north" : "south"}`].filter(Boolean);
  return `${s}. The first square is ${parts.join(", ")}.`;
}

/** One key press in step 1. Keys with Ctrl, ⌘ or Alt, and keys it doesn't use, are left to the page. */
export function layKey(g: LaneGrid, lay: Laying, ks: LayKeys, e: KeyPress): KeyResult {
  const none = { states: [], keys: ks, handled: false };
  if (lay.closed || e.ctrlKey || e.metaKey || e.altKey) return none;
  const cells = lay.cells;
  const n = cells.length;
  // any key but an arrow drops a half-made Shift diagonal
  if (!(e.key in ARROWS)) ks = { cursor: ks.cursor };

  if (e.key === "Backspace") {
    if (!n) return { states: [], keys: ks, say: "Nothing to take back.", handled: true };
    if (n === 1) return { states: [{ cells: [], closed: false }], keys: { cursor: cells[0] }, say: "The lane is taken up. Enter or Space starts it again here.", handled: true };
    const r = paintTo(g, lay, cells[n - 2]); // onto the previous square: takes the last one up
    const now = r.states[r.states.length - 1]?.cells ?? cells;
    return { states: r.states, keys: { cursor: now[now.length - 1] }, say: `Took back square ${n}. ${describeLane(now)}`, handled: true };
  }

  if (e.key === "Enter" || e.key === " ") {
    if (n) return { states: [], keys: ks, say: describeLane(cells), handled: true };
    const r = paintTo(g, lay, ks.cursor);
    if (r.refused) return { states: [], keys: ks, say: refusal(r.refused), handled: true };
    return { states: r.states, keys: { cursor: ks.cursor }, say: describeLane(r.states[0].cells), handled: true };
  }

  const d = ARROWS[e.key];
  if (!d) return none;
  let step = d;
  if (e.shiftKey) {
    const first = ks.diagonal;
    // the first arrow, or a second along the same line (which replaces it): wait for one across it
    if (!first || (first[0] === 0 ? d[0] === 0 : d[1] === 0)) {
      const across = d[0] === 0 ? "east or west" : "north or south";
      return { states: [], keys: { ...ks, diagonal: d }, say: `Diagonal: ${heading(d)}, then ${across}.`, handled: true };
    }
    step = [first[0] + d[0], first[1] + d[1]];
  }
  const from = n ? cells[n - 1] : ks.cursor;
  const target: Cell = [from[0] + step[0], from[1] + step[1]];

  if (!n) {
    // no lane yet: the arrows move the cursor
    if (!inGrid(g, target)) return { states: [], keys: { cursor: ks.cursor }, say: refusal("outside"), handled: true };
    return { states: [], keys: { cursor: target }, say: `${where(target)}${isBlocked(g, target) ? ", blocked by a fixed obstacle" : ""}.`, handled: true };
  }
  const r = paintTo(g, lay, target);
  const last = r.states[r.states.length - 1];
  const keys: LayKeys = { cursor: last && !last.closed ? last.cells[last.cells.length - 1] : from };
  if (r.refused) return { states: r.states, keys, say: refusal(r.refused), handled: true };
  if (last?.closed) return { states: r.states, keys, say: `Loop closed with ${last.cells.length} squares. On to step 2, shape it.`, handled: true };
  return { states: r.states, keys, say: last ? describeLane(last.cells) : undefined, handled: true };
}
