// Quick mode step 1 from the keyboard (#47): a cursor square, arrows, Enter / Space, Backspace and Shift diagonals,
// on the same painting model as the pointer (lanes.ts), with an announcement for each step and each refusal.
import { bakeBuilt, venueCheck, type RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newDraft, toDoc } from "../src/designer/Designer.js";
import { designStep, gridFor, isLoop, laneGrid, withLaying, MIN_LOOP, paintTo, REFUSAL_TEXT, type Cell, type LaneGrid, type Laying } from "../src/designer/lanes.js";
import { layKey, refusal, startCursor, type LayKeys } from "../src/designer/laykeys.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const hall = ref<RcVenue>("venues/club-hall.rcvenue.json");
const g = laneGrid(hall.area, [], 2); // 11 × 6

const empty: Laying = { cells: [], closed: false };

/** "Shift+ArrowUp" → { key: "ArrowUp", shiftKey: true } */
const ev = (k: string) => (k.startsWith("Shift+") ? { key: k.slice(6), shiftKey: true } : { key: k, shiftKey: false });

/** Press `keys` in turn from `lay` / `ks`; every painted state, the announcements and where it ends up. */
function press(grid: LaneGrid, keys: string[], lay: Laying = empty, ks: LayKeys = { cursor: startCursor(grid) }) {
  const states: Laying[] = [];
  const said: string[] = [];
  for (const k of keys) {
    const r = layKey(grid, lay, ks, ev(k));
    expect(r.handled, k).toBe(true);
    states.push(...r.states);
    lay = r.states[r.states.length - 1] ?? lay;
    ks = r.keys;
    if (r.say) said.push(r.say);
  }
  return { lay, ks, states, said };
}
const times = (k: string, n: number) => Array<string>(n).fill(k);

describe("the cursor before the lane starts", () => {
  it("starts on the south-west square and the arrows move it, north up the plan", () => {
    expect(startCursor(g)).toEqual([0, 0]);
    const r = press(g, ["ArrowRight", "ArrowRight", "ArrowUp"]);
    expect(r.ks.cursor).toEqual([2, 1]);
    expect(r.states).toEqual([]); // moving the cursor lays nothing
    expect(r.said.at(-1)).toMatch(/column 3, row 2/);
  });

  it("stops at the edge of the track area and says so", () => {
    const r = press(g, ["ArrowLeft", "ArrowDown"]);
    expect(r.ks.cursor).toEqual([0, 0]);
    expect(r.said).toEqual([expect.stringMatching(/edge of the track area/i), expect.stringMatching(/edge of the track area/i)]);
  });

  it("says when the cursor is on a blocked square, and Enter there is refused", () => {
    const b = laneGrid(hall.area, [{ type: "circle", x: -8, z: -5, radius: 0.5 }], 2); // over [1, 0]
    expect(b.blocked.has("1,0")).toBe(true);
    const r = press(b, ["ArrowRight", "Enter"]);
    expect(r.said[0]).toMatch(/blocked/i);
    expect(r.states).toEqual([]);
    expect(r.said[1]).toMatch(/blocked by a fixed obstacle/);
  });

  it("Enter or Space starts the lane on the cursor square", () => {
    for (const k of ["Enter", " "]) {
      const r = press(g, ["ArrowUp", k]);
      expect(r.lay.cells).toEqual([[0, 1]]);
      expect(r.said.at(-1)).toMatch(new RegExp(`Square 1 of ${MIN_LOOP} minimum`));
    }
  });

  it("leaves other keys alone (so Tab, Ctrl+Z and the like still work)", () => {
    for (const key of ["Tab", "a", "Escape", "z"]) expect(layKey(g, empty, { cursor: [0, 0] }, { key }).handled).toBe(false);
    expect(layKey(g, empty, { cursor: [0, 0] }, { key: "z", ctrlKey: true }).handled).toBe(false);
    expect(layKey(g, empty, { cursor: [0, 0] }, { key: "ArrowUp", ctrlKey: true }).handled).toBe(false);
  });
});

describe("laying the lane with the arrows", () => {
  it("lays a loop with the keyboard alone: one square (one undo step) per arrow, closing on the first square", () => {
    const keys = ["Enter", ...times("ArrowRight", 3), ...times("ArrowUp", 2), ...times("ArrowLeft", 3), ...times("ArrowDown", 2)];
    const r = press(g, keys);
    expect(r.lay.closed).toBe(true);
    expect(r.lay.cells).toHaveLength(10);
    expect(isLoop(r.lay.cells)).toBe(true);
    const open = r.states.slice(0, -1);
    expect(open.map((s) => s.cells.length)).toEqual(open.map((_, i) => i + 1));
    // the same squares the pointer would lay
    const drag = [[0, 0], [3, 0], [3, 2], [0, 2], [0, 0]] as Cell[];
    let lay = empty;
    for (const t of drag) lay = paintTo(g, lay, t).states.at(-1) ?? lay;
    expect(r.lay).toEqual(lay);
    expect(r.said.at(-1)).toMatch(/Loop closed with 10 squares/);
  });

  it("announces each step: the count, the minimum, the heading, and where the first square is once it can close", () => {
    const r = press(g, ["Enter", "ArrowRight", "ArrowRight", "ArrowUp", "ArrowUp"]);
    expect(r.said).toEqual([
      expect.stringMatching(/^Square 1 of 4 minimum/),
      expect.stringMatching(/^Square 2 of 4 minimum, heading east/),
      expect.stringMatching(/^Square 3 of 4 minimum, heading east/),
      expect.stringMatching(/^Square 4, heading north\. The first square is 2 west, 1 south/),
      expect.stringMatching(/^Square 5, heading north\. The first square is 2 west, 2 south/),
    ]);
  });

  it("the cursor follows the end of the lane", () => {
    const r = press(g, ["ArrowUp", "Enter", "ArrowRight", "ArrowUp"]);
    expect(r.ks.cursor).toEqual([1, 2]);
  });

  it("Backspace takes back the last square, one undo step each, and then the first one", () => {
    const r = press(g, ["Enter", "ArrowRight", "ArrowRight", "Backspace"]);
    expect(r.lay.cells).toEqual([[0, 0], [1, 0]]);
    expect(r.ks.cursor).toEqual([1, 0]);
    expect(r.said.at(-1)).toMatch(/^Took back square 3\. Square 2 of 4 minimum, heading east/);
    const r2 = press(g, ["Backspace", "Backspace"], r.lay, r.ks);
    expect(r2.states.map((s) => s.cells.length)).toEqual([1, 0]);
    expect(r2.ks.cursor).toEqual([0, 0]); // the cursor stays where the lane was
    expect(r2.said.at(-1)).toMatch(/lane is taken up/i);
    // nothing to take back: still handled (no browser Back), and says so
    const r3 = press(g, ["Backspace"], r2.lay, r2.ks);
    expect(r3.states).toEqual([]);
    expect(r3.said[0]).toMatch(/nothing to take back/i);
  });

  it("stepping back onto the previous square with an arrow takes it up too, as a drag back does", () => {
    const r = press(g, ["Enter", "ArrowRight", "ArrowRight", "ArrowLeft"]);
    expect(r.lay.cells).toEqual([[0, 0], [1, 0]]);
    expect(r.said.at(-1)).toMatch(/^Took back square 3\. Square 2 of 4 minimum/);
  });

  it("refuses a used square and the edge, and keeps the lane; the refusal names the keyboard's way back", () => {
    // [1, 1] is a turn of the lane: crossing it is refused, and the lane stays as it was
    const u = press(g, ["Enter", "ArrowRight", "ArrowUp", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"]);
    expect(u.lay.cells).toEqual([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [1, 2]]);
    expect(u.said.at(-1)).toBe(REFUSAL_TEXT.crossing);
    // the pointer's words about dragging become the keyboard's
    expect(refusal("used")).toMatch(/already part of the lane\. Backspace takes squares up/);
    for (const r of Object.keys(REFUSAL_TEXT) as (keyof typeof REFUSAL_TEXT)[]) expect(refusal(r)).not.toMatch(/drag/i);
    const e = press(g, ["Enter", "ArrowDown"]);
    expect(e.lay.cells).toEqual([[0, 0]]);
    expect(e.said.at(-1)).toMatch(/edge of the track area/i);
  });

  it("does nothing once the loop is closed", () => {
    const closed: Laying = { cells: [[0, 0], [1, 0], [1, 1], [0, 1]], closed: true };
    expect(layKey(g, closed, { cursor: [0, 1] }, { key: "ArrowUp" })).toMatchObject({ states: [], handled: false });
  });
});

describe("a crossing from the keyboard (#79)", () => {
  // the figure of eight from lanes.test.ts: east along row 2, round the north-east lobe, south down column 5 straight
  // across [5, 2], round the south-west lobe and back up to the first square
  const EIGHT = [
    ...times("ArrowRight", 8),
    ...times("ArrowUp", 3),
    ...times("ArrowLeft", 3),
    ...times("ArrowDown", 5),
    ...times("ArrowLeft", 5),
    ...times("ArrowUp", 2),
  ];
  const start = (k: string[]) => press(g, ["ArrowUp", "ArrowUp", "Enter", ...k]);

  it("crosses straight over and closes", () => {
    const r = start(EIGHT);
    expect(r.lay.closed).toBe(true);
    expect(r.lay.cells.filter((c) => c[0] === 5 && c[1] === 2)).toHaveLength(2);
    expect(isLoop(r.lay.cells)).toBe(true);
    expect(r.said.find((s) => /crossing the lane/.test(s))).toMatch(/^Square \d+, heading south, crossing the lane/);
  });

  it("refuses a turn on the crossing, with the reason", () => {
    const r = start([...EIGHT.slice(0, 8 + 3 + 3 + 3), "ArrowLeft"]); // on [5, 2], then turn west
    expect(r.lay.cells.at(-1)).toEqual([5, 2]);
    expect(r.said.at(-1)).toMatch(/cross itself straight across/);
  });
});

describe("a diagonal run from the keyboard (#82)", () => {
  it("Shift and two arrows in turn lay one corner-to-corner step", () => {
    const r = press(g, ["Enter", "Shift+ArrowUp", "Shift+ArrowRight"]);
    expect(r.states.map((s) => s.cells)).toEqual([[[0, 0]], [[0, 0], [1, 1]]]); // the second only after the second arrow
    expect(r.said).toEqual([
      expect.stringMatching(/^Square 1/),
      expect.stringMatching(/^Diagonal: north, then east or west/),
      expect.stringMatching(/^Square 2 of 4 minimum, heading north-east/),
    ]);
    expect(r.ks.diagonal).toBeUndefined();
    // the order of the two arrows doesn't matter
    expect(press(g, ["Enter", "Shift+ArrowRight", "Shift+ArrowUp"]).lay.cells).toEqual([[0, 0], [1, 1]]);
  });

  it("a second arrow along the same line replaces the first; an arrow without Shift goes straight", () => {
    const r = press(g, ["Enter", "Shift+ArrowUp", "Shift+ArrowDown"]);
    expect(r.ks.diagonal).toEqual([0, -1]);
    expect(r.lay.cells).toEqual([[0, 0]]);
    const s = press(g, ["Enter", "Shift+ArrowUp", "ArrowRight"]);
    expect(s.lay.cells).toEqual([[0, 0], [1, 0]]);
    expect(s.ks.diagonal).toBeUndefined();
  });

  it("lays the octagon from lanes.test.ts, closing through a diagonal step onto the first square", () => {
    const NE = ["Shift+ArrowUp", "Shift+ArrowRight"], NW = ["Shift+ArrowUp", "Shift+ArrowLeft"];
    const SW = ["Shift+ArrowDown", "Shift+ArrowLeft"], SE = ["Shift+ArrowDown", "Shift+ArrowRight"];
    const keys = [
      ...times("ArrowRight", 2),
      "Enter",
      ...times("ArrowRight", 6),
      ...NE,
      ...NE,
      "ArrowUp",
      ...NW,
      ...NW,
      ...times("ArrowLeft", 6),
      ...SW,
      ...SW,
      "ArrowDown",
      ...SE,
      ...SE,
    ];
    const r = press(g, keys);
    expect(r.lay.closed).toBe(true);
    expect(r.lay.cells[0]).toEqual([2, 0]);
    expect(r.lay.cells.at(-1)).toEqual([1, 1]);
    expect(isLoop(r.lay.cells)).toBe(true);
  });

  it("lays a diagonal past a used square (#104), refuses one past a blocked square, and says why", () => {
    // east, north and back west to [0, 1]: north-east from there passes between [1, 1] (used) and [0, 2]
    const keys = ["Enter", "ArrowRight", "ArrowUp", "ArrowLeft", "Shift+ArrowUp", "Shift+ArrowRight"];
    expect(press(g, keys).lay.cells.at(-1)).toEqual([1, 2]);
    // the same with a pillar over [0, 2]: refused
    const b = laneGrid(hall.area, [{ type: "circle", x: -10, z: -1, radius: 0.3 }], 2);
    expect([...b.blocked]).toEqual(["0,2"]);
    const r = press(b, keys);
    expect(r.lay.cells.at(-1)).toEqual([0, 1]);
    expect(r.said.at(-1)).toMatch(/can't cut past a square blocked/);
  });

  it("any other key drops a half-made diagonal", () => {
    const r = press(g, ["Enter", "Shift+ArrowUp", "Enter", "Shift+ArrowRight"]);
    expect(r.ks.diagonal).toEqual([1, 0]);
    expect(r.lay.cells).toEqual([[0, 0]]);
  });

  it("a key left to the page (Ctrl+Z, Tab) drops it too, but Shift on its own, repeating while held, doesn't", () => {
    const half = press(g, ["Enter", "Shift+ArrowUp"]);
    for (const e of [{ key: "z", ctrlKey: true }, { key: "Tab" }]) {
      const r = layKey(g, half.lay, half.ks, e);
      expect(r.handled).toBe(false);
      expect(r.keys.diagonal).toBeUndefined();
    }
    const shift = layKey(g, half.lay, half.ks, { key: "Shift", shiftKey: true });
    expect(shift.handled).toBe(false);
    expect(shift.keys.diagonal).toEqual([0, 1]);
  });

  it("Shift and two arrows move the cursor diagonally before the lane starts", () => {
    expect(press(g, ["Shift+ArrowUp", "Shift+ArrowRight"]).ks.cursor).toEqual([1, 1]);
  });
});

describe("what the keyboard lays bakes clean (rctrack 1.9 lane-overlap, #95)", () => {
  const NE = ["Shift+ArrowUp", "Shift+ArrowRight"], NW = ["Shift+ArrowUp", "Shift+ArrowLeft"];
  const SW = ["Shift+ArrowDown", "Shift+ArrowLeft"], SE = ["Shift+ArrowDown", "Shift+ArrowRight"];
  const LAYOUTS: Record<string, string[]> = {
    loop: ["Enter", ...times("ArrowRight", 3), ...times("ArrowUp", 2), ...times("ArrowLeft", 3), ...times("ArrowDown", 2)],
    "figure of eight": ["ArrowUp", "ArrowUp", "Enter", ...times("ArrowRight", 8), ...times("ArrowUp", 3), ...times("ArrowLeft", 3), ...times("ArrowDown", 5), ...times("ArrowLeft", 5), ...times("ArrowUp", 2)],
    octagon: ["ArrowRight", "ArrowRight", "Enter", ...times("ArrowRight", 6), ...NE, ...NE, "ArrowUp", ...NW, ...NW, ...times("ArrowLeft", 6), ...SW, ...SW, "ArrowDown", ...SE, ...SE],
    // straights side by side on neighbouring rows: lanes that share a pipe, not overlap
    serpentine: ["Enter", ...times("ArrowRight", 5), "ArrowUp", ...times("ArrowLeft", 4), "ArrowUp", ...times("ArrowRight", 4), "ArrowUp", ...times("ArrowLeft", 5), ...times("ArrowDown", 3)],
  };

  for (const [name, keys] of Object.entries(LAYOUTS)) {
    it(`the ${name} has no lane-overlap, and no errors at all`, () => {
      const d0 = newDraft({ area: hall.area, name, laneWidth: 2 });
      const r = press(gridFor(d0, hall.obstacles), keys);
      expect(r.lay.closed).toBe(true);
      const d = withLaying(d0, r.lay);
      expect(designStep(d)).toBe(2);
      const doc = toDoc(d);
      const b = bakeBuilt(doc);
      expect(b.checks.filter((c) => c.code === "lane-overlap")).toEqual([]);
      // the figure of eight's crossing is unbridged until step 3 bridges it
      const errors = [...b.checks, ...venueCheck(doc, hall).checks].filter((c) => c.level === "error" && c.code !== "crossing-unbridged");
      expect(errors).toEqual([]);
    });
  }
});
