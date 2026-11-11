// The "Add point" tool (#114): a plain click or drag on the track no longer adds a corner point; the tool does.
import type { DesignPoint, RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addKey, floorTap, keyInsert, lanePress, shapeHint, stepCorner } from "../src/designer/addtool.js";
import { historyReducer, type HistoryState } from "../src/designer/history.js";

vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));
vi.mock("../src/components/PlanView.js", async (orig) => ({ ...(await orig<typeof import("../src/components/PlanView.js")>()), PlanView: () => null }));
const { Designer, draftFromDoc, newDraft, QuickHowTo, Shortcuts, TOUCH_QUERY } = await import("../src/designer/Designer.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
type Draft = ReturnType<typeof draftFromDoc>;

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;

/** a square: (0,0) → (10,0) → (10,10) → (0,10) */
const SQUARE: DesignPoint[] = [
  { x: 0, z: 0, radius: 1 },
  { x: 10, z: 0, radius: 1 },
  { x: 10, z: 10, radius: 1 },
  { x: 0, z: 10, radius: 1 },
];

describe("a press on the track", () => {
  const press = { nearPoint: false, onCorner: false, selKind: null } as const;

  it("adds no point without the tool, in either mode: a click selects, a drag moves a point or pans", () => {
    expect(lanePress({ ...press, tool: "select", view: "quick" })).toBe("pass");
    expect(lanePress({ ...press, tool: "select", view: "advanced" })).toBe("pass");
    expect(lanePress({ ...press, tool: "select", view: "quick", nearPoint: true })).toBe("grab");
    expect(lanePress({ ...press, tool: "select", view: "advanced", onCorner: true })).toBe("grab");
    expect(lanePress({ ...press, tool: "select", view: "quick", selKind: "feature" })).toBe("release");
  });

  it("adds one with the tool on: on a straight in Advanced, anywhere on the track in Quick", () => {
    expect(lanePress({ ...press, tool: "add", view: "quick" })).toBe("add");
    expect(lanePress({ ...press, tool: "add", view: "quick", onCorner: true })).toBe("add");
    expect(lanePress({ ...press, tool: "add", view: "advanced" })).toBe("add");
    // a corner point under the press is still grabbed, so the tool never stacks points
    expect(lanePress({ ...press, tool: "add", view: "quick", nearPoint: true })).toBe("grab");
    expect(lanePress({ ...press, tool: "add", view: "advanced", onCorner: true })).toBe("grab");
  });

  it("places a jump while one is armed", () => {
    expect(lanePress({ ...press, tool: "feature", view: "quick" })).toBe("feature");
    expect(lanePress({ ...press, tool: "feature", view: "advanced", nearPoint: true })).toBe("feature");
  });
});

describe("a tap on the floor (Quick)", () => {
  it("adds a corner only with the tool on", () => {
    expect(floorTap({ tool: "select", view: "quick", laying: false, selKind: "point" })).toBe("deselect");
    expect(floorTap({ tool: "select", view: "quick", laying: false, selKind: null })).toBe("deselect");
    expect(floorTap({ tool: "add", view: "quick", laying: false, selKind: "point" })).toBe("add");
    expect(floorTap({ tool: "add", view: "quick", laying: false, selKind: null })).toBe("add");
  });
  it("never adds while laying the lanes, in Advanced, or with a jump or the start line selected", () => {
    expect(floorTap({ tool: "add", view: "quick", laying: true, selKind: null })).toBe("deselect");
    expect(floorTap({ tool: "add", view: "advanced", laying: false, selKind: "point" })).toBe("deselect");
    expect(floorTap({ tool: "add", view: "quick", laying: false, selKind: "start" })).toBe("deselect");
  });
});

describe("the keyboard", () => {
  it("A toggles the tool, without Ctrl, Cmd or Alt", () => {
    expect(addKey({ key: "a", ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(addKey({ key: "A", ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(addKey({ key: "a", ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(addKey({ key: "a", ctrlKey: false, metaKey: true, altKey: false })).toBe(false);
    expect(addKey({ key: "a", ctrlKey: false, metaKey: false, altKey: true })).toBe(false);
    expect(addKey({ key: "s", ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });

  it("N and P step the selected corner round the loop", () => {
    expect(stepCorner(4, null, 1)).toBe(0);
    expect(stepCorner(4, null, -1)).toBe(3);
    expect(stepCorner(4, 3, 1)).toBe(0);
    expect(stepCorner(4, 0, -1)).toBe(3);
    expect(stepCorner(4, 1, 1)).toBe(2);
  });

  it("Enter adds a point halfway to the next corner and selects it (Quick: an apex radius of 0)", () => {
    const r = keyInsert("quick", SQUARE, 3, 2)!;
    expect(r.index).toBe(4);
    expect(r.points).toHaveLength(5);
    expect(r.points[4]).toEqual({ x: 0, z: 5, radius: 1 });
    expect(r.points.slice(0, 4)).toEqual(SQUARE);
  });

  it("Advanced: the new point is between its neighbours, like a click on the straight", () => {
    const r = keyInsert("advanced", SQUARE, 0, 2)!;
    expect(r.index).toBe(1);
    expect(r.points[1]).toEqual({ x: 5, z: 0, radius: 1 });
  });

  it("refuses a point that would sit on top of a neighbour", () => {
    const tight: DesignPoint[] = [{ x: 0, z: 0 }, { x: 0.2, z: 0 }, { x: 5, z: 5 }];
    expect(keyInsert("quick", tight, 0, 2)).toBeNull();
    expect(keyInsert("quick", SQUARE, 9, 2)).toBeNull();
  });

  it("adding a point is one undo step: undo takes it away again", () => {
    const set = (h: HistoryState<DesignPoint[]>, next: DesignPoint[], group: string) => historyReducer(h, { type: "set", next, group, now: 1000 });
    let h: HistoryState<DesignPoint[]> = { past: [], present: SQUARE, future: [], group: null, at: 0, travels: 0 };
    h = set(h, keyInsert("quick", SQUARE, 0, 2)!.points, "insert:1");
    expect(h.present).toHaveLength(5);
    h = historyReducer(h, { type: "undo" });
    expect(h.present).toEqual(SQUARE);
  });
});

describe("the hints", () => {
  it("say how to add a point, and what the tool does while it's on", () => {
    const base = { advanced: false, tablet: false, adding: false, sel: null };
    expect(shapeHint(base)).toMatch(/Add point \(A\)/);
    expect(shapeHint({ ...base, tablet: true })).toMatch(/tap Add point/);
    expect(shapeHint({ ...base, advanced: true })).toMatch(/Add point \(A\)/);
    expect(shapeHint({ ...base, adding: true })).toMatch(/Click the track or the floor to add a corner/);
    expect(shapeHint({ ...base, adding: true, sel: 2 })).toMatch(/after 3/);
    expect(shapeHint({ ...base, adding: true, tablet: true })).toMatch(/^Tap the track/);
    expect(shapeHint({ ...base, adding: true, advanced: true })).toMatch(/Click a straight to add a point/);
    for (const h of [shapeHint({ ...base, adding: true }), shapeHint({ ...base, adding: true, advanced: true })]) expect(h).toMatch(/Esc/);
    // a plain tap or click no longer adds one, so the hint doesn't say it does
    expect(shapeHint(base)).not.toMatch(/Tap the track to add/);
    expect(shapeHint({ ...base, sel: 0 })).not.toMatch(/Tap the floor to add/);
  });

  it("\"How to draw\" says how to add a point, by mouse and by keyboard", () => {
    const how = renderToStaticMarkup(<Shortcuts />);
    expect(how).toMatch(/Add point/);
    expect(how).toMatch(/<kbd>A<\/kbd>/);
    expect(how).toMatch(/<kbd>Enter<\/kbd>/);
    expect(how).not.toMatch(/<b>Click a straight<\/b> to add a point there/);
  });

  it("Quick's \"How to draw\" says the same for the floor, and no longer that a bare click adds a corner", () => {
    const how = renderToStaticMarkup(<QuickHowTo />);
    expect(how).toMatch(/Add point/);
    expect(how).toMatch(/<kbd>A<\/kbd>/);
    expect(how).toMatch(/<kbd>N<\/kbd>/);
    expect(how).toMatch(/<kbd>Enter<\/kbd>/);
    expect(how).not.toMatch(/<b>Click the floor<\/b> to add a corner/);
    // laying the lanes: there's no track yet, so no Add point
    expect(renderToStaticMarkup(<QuickHowTo laying />)).not.toMatch(/Add point/);
  });
});

describe("the Add point button", () => {
  afterEach(() => vi.unstubAllGlobals());
  const session = { me: null, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
  const render = (initial: Draft, mode: "quick" | "advanced", query?: string) => {
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
    if (query) vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === query }) });
    return renderToStaticMarkup(
      <SessionContext.Provider value={session}>
        <MemoryRouter>
          <Designer mode="new" initial={initial} storageKey="test" />
        </MemoryRouter>
      </SessionContext.Provider>,
    );
  };
  const track = () => draftFromDoc(ref<RcTrack>("examples/club-a.rctrack.json"));
  const button = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Add point(?:(?!<\/button>).)*<\/button>/)?.[0];

  it.each(["quick", "advanced"] as const)("%s: in the palette next to the editing controls, off to begin with, with its key", (mode) => {
    const b = button(render(track(), mode));
    expect(b).toBeDefined();
    expect(b).toContain('aria-pressed="false"');
    expect(b).toContain('aria-keyshortcuts="A"');
  });

  it("tablet: in the dock", () => {
    const html = render(track(), "quick", TOUCH_QUERY);
    const dock = html.slice(html.indexOf('aria-label="Designer tools"'));
    expect(button(dock)).toBeDefined();
  });

  it("not there while the lanes are being laid", () => {
    expect(button(render(newDraft({ area: { length: 22, width: 12 }, name: "t" }), "quick"))).toBeUndefined();
  });
});
