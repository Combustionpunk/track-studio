// Reverse the direction of travel (#36): one designer action, one undo step, saved as a new revision.
import { bake, reverseDesign, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Designer, draftFromDoc, newDraft, toDoc, TOUCH_QUERY, type Draft } from "../src/designer/Designer.js";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import { gridFor, paintTo, withLaying, type Cell, type Laying } from "../src/designer/lanes.js";
import { MODE_KEY } from "../src/designer/mode.js";
import { reverseDraft } from "../src/designer/reverse.js";
import { followTravel } from "../src/designer/shape.js";
import { SessionContext } from "../src/lib/session.js";

// the designer guards leaving with useBlocker, which needs a data router; a static render doesn't
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));

const club = () => JSON.parse(readFileSync(join(__dirname, "../../../reference/examples/club-a.rctrack.json"), "utf8")) as RcTrack;

/** a loop laid in step 1 round the edge of a 12 × 8 m area: now in step 2 with `laid` kept */
function laidDraft(): Draft {
  const d = newDraft({ area: { length: 12, width: 8 }, obstacles: [], name: "Laid" });
  const g = gridFor(d);
  let lay: Laying = { cells: [], closed: false };
  const corners: Cell[] = [[0, 0], [g.cols - 1, 0], [g.cols - 1, g.rows - 1], [0, g.rows - 1], [0, 0]];
  for (const c of corners) {
    const r = paintTo(g, lay, c);
    lay = r.states[r.states.length - 1] ?? lay;
  }
  return withLaying(d, lay);
}

describe("reverseDraft", () => {
  it("reverses the design with the engine and leaves the rest alone", () => {
    const d = draftFromDoc(club());
    const r = reverseDraft(d);
    expect(r.design).toEqual(reverseDesign(d.design));
    expect({ ...r, design: null }).toEqual({ ...d, design: null });
  });

  it("works on unsaved changes: whatever the draft is now", () => {
    const d = draftFromDoc(club());
    const moved: Draft = { ...d, design: { ...d.design, points: d.design.points.map((p, i) => (i === 3 ? { ...p, x: p.x + 0.5 } : p)) } };
    expect(reverseDraft(moved).design.points[moved.design.points.length - 3]).toEqual(moved.design.points[3]);
  });

  it("reverses the squares a loop was laid through too, so going back to step 1 keeps the new direction", () => {
    const d = laidDraft();
    const r = reverseDraft(d);
    expect(r.laid).toEqual([d.laid![0], ...d.laid!.slice(1).reverse()]);
    expect(reverseDraft(r).laid).toEqual(d.laid);
  });

  it("does nothing while the lanes are being laid (there is no loop yet)", () => {
    const d = newDraft({ area: { length: 12, width: 8 }, obstacles: [], name: "New" });
    expect(reverseDraft(d)).toBe(d);
  });

  it("is one undo step, and undo puts it back", () => {
    const d = draftFromDoc(club());
    let h: HistoryState<Draft> = { past: [], present: d, future: [], group: null, at: 0, travels: 0 };
    h = historyReducer(h, { type: "set", next: reverseDraft(h.present), now: 1 });
    expect(h.past).toHaveLength(1);
    expect(h.present.design.points).toEqual(reverseDesign(d.design).points);
    h = historyReducer(h, { type: "undo" });
    expect(h.present).toBe(d);
  });

  it("undo or redo of a reverse keeps a selected corner on the same corner, not the same number", () => {
    const d = draftFromDoc(club());
    const n = d.design.points.length;
    const start: HistoryState<Draft> = { past: [], present: d, future: [], group: null, at: 0, travels: 0 };
    const seen = (h: HistoryState<Draft>) => ({ travels: h.travels, points: h.present.design.points });
    const reversed = historyReducer(start, { type: "set", next: reverseDraft(d), now: 1 });
    const undone = historyReducer(reversed, { type: "undo" });
    // corner 1 reversed is corner n-1; corner 0 stays corner 0
    expect(followTravel({ kind: "point" as const, i: n - 1 }, seen(reversed), seen(undone))).toEqual({ kind: "point", i: 1 });
    expect(followTravel({ kind: "point" as const, i: 0 }, seen(reversed), seen(undone))).toEqual({ kind: "point", i: 0 });
    const redone = historyReducer(undone, { type: "redo" });
    expect(followTravel({ kind: "point" as const, i: 2 }, seen(undone), seen(redone))).toEqual({ kind: "point", i: n - 2 });
    // jumps keep their order, so jump and start selections stay
    expect(followTravel({ kind: "feature" as const, i: 0 }, seen(reversed), seen(undone))).toEqual({ kind: "feature", i: 0 });
  });

  it("saving makes the next revision of the same track, baked the other way round", () => {
    const doc = club();
    const base = { id: "club-a", revision: 3, doc };
    const saved = bake(toDoc(reverseDraft(draftFromDoc(doc)), base));
    expect(saved.id).toBe("club-a");
    expect(saved.revision).toBe(4);
    const was = bake(toDoc(draftFromDoc(doc), base)).built!.startLine;
    expect(Math.hypot(saved.built!.startLine.x - was.x, saved.built!.startLine.z - was.z)).toBeLessThan(0.01);
    expect(Math.abs((((saved.built!.startLine.heading - was.heading - 180) % 360) + 360) % 360)).toBeLessThan(0.01);
  });
});

describe("the Reverse direction button", () => {
  const session = { me: null, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
  const render = (initial: Draft) =>
    renderToStaticMarkup(
      <SessionContext.Provider value={session}>
        <MemoryRouter>
          <Designer mode="new" initial={initial} storageKey="test" />
        </MemoryRouter>
      </SessionContext.Provider>,
    );
  const button = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Reverse direction(?:(?!<\/button>).)*<\/button>/)?.[0];
  afterEach(() => vi.unstubAllGlobals());

  it.each(["quick", "advanced"] as const)("is in the designer bar in %s mode, with an icon and its label", (mode) => {
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
    const html = render(draftFromDoc(club()));
    expect(html).toContain(`designer designer-${mode}`);
    const bar = html.slice(html.indexOf('class="designer-bar"'), html.indexOf('class="save-state"'));
    const b = button(bar);
    expect(b).toBeDefined();
    expect(b).toMatch(/<svg[^>]*lucide/);
    expect(b).not.toMatch(/disabled/);
  });

  it("is in the dock, not the bar, on a tablet in Quick mode", () => {
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode: "quick" }) : null), setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === TOUCH_QUERY }) });
    const html = render(draftFromDoc(club()));
    expect(html).toContain("designer-touch");
    expect(button(html.slice(0, html.indexOf('class="save-state"')))).toBeUndefined();
    const dock = html.slice(html.indexOf('aria-label="Designer tools"'));
    const b = dock.match(/<button[^>]*aria-label="Reverse direction"[^>]*>(?:(?!<\/button>).)*<\/button>/)?.[0];
    expect(b).toBeDefined();
    expect(b).toMatch(/<svg[^>]*lucide/);
    expect(b).not.toMatch(/disabled/);
  });

  it("is disabled while the lanes are being laid", () => {
    const b = button(render(newDraft({ area: { length: 12, width: 8 }, obstacles: [], name: "New" })));
    expect(b).toMatch(/disabled/);
  });
});
