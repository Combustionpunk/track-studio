// One corner numbering everywhere (#176): the designer's dots, titles, panels and messages name corners as the build
// sheet and the Corners figure count them (the engine's cornerNumbering): a hairpin drawn as two points is 5a and 5b,
// one corner; a point that turns too little to be a corner has no number and no name: it is just a point.
import { bakeBuilt, buildSheet, type DesignPoint, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../src/lib/hooks.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const clubA = () => ref<RcTrack>("examples/club-a.rctrack.json");
// a loop with a hairpin drawn as two 90° points (3a, 3b) and a 9° kink on the north straight (not a corner)
const HAIRPIN: DesignPoint[] = [{ x: -14, z: -8 }, { x: 4, z: -8 }, { x: 12, z: 0 }, { x: 12, z: 2 }, { x: 4, z: 8 }, { x: -5, z: 8.7 }, { x: -14, z: 8 }];
const hairpin = (): RcTrack => {
  const doc: RcTrack = { format: "rctrack", version: 1, id: "h", revision: 1, info: { name: "Hairpin" }, area: { length: 40, width: 30 }, design: { laneWidth: 2, points: HAIRPIN } };
  return { ...doc, built: bakeBuilt(doc) };
};

vi.mock("../src/lib/hooks.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/hooks.js")>();
  return { ...real, useApi: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }) as Loadable<unknown> };
});
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));
let baked: RcTrack["built"] = undefined;
vi.mock("../src/designer/useBake.js", () => ({ useBake: () => ({ built: baked ?? null, pending: false, error: null, ms: 0 }) }));
const plans: Record<string, unknown>[] = [];
vi.mock("../src/components/PlanView.js", async (orig) => ({
  ...(await orig<typeof import("../src/components/PlanView.js")>()),
  PlanView: (p: Record<string, unknown>) => (plans.push(p), <svg className="plan-svg" />),
}));

const { Designer, draftFromDoc } = await import("../src/designer/Designer.js");
const { MODE_KEY, submitBlock } = await import("../src/designer/mode.js");
const { sheetLabel, contextActions } = await import("../src/designer/PhoneSheets.js");
const { SelectionPanel } = await import("../src/designer/SidePanels.js");
const { liveGeometry } = await import("../src/designer/geometry.js");
const { shapeHint } = await import("../src/designer/addtool.js");
const { SessionContext } = await import("../src/lib/session.js");
import type { DesignerBase } from "../src/designer/Designer.js";

const me = { id: 1, username: "yeti", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false };
const session = { me, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
const track = { status: "draft", approvedRevision: null } as unknown as DesignerBase["track"];
/** the designer on a saved track in a mode: its markup, and the plan's overlay (the corner dots) */
const open = (doc: RcTrack, mode: "quick" | "advanced") => {
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), location: { href: "http://localhost/t/x/edit" } });
  baked = doc.built;
  const html = renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Designer mode="edit" initial={draftFromDoc(doc)} base={{ id: doc.id, revision: 1, doc, track, can: { submit: true } } as unknown as DesignerBase} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
  const overlay = renderToStaticMarkup(<svg>{(plans.at(-1)!.overlay as (m: number) => ReactNode)(1)}</svg>);
  return { html, overlay };
};
const dots = (overlay: string) => [...overlay.matchAll(/<text class="ed-corner-n"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const titles = (overlay: string, cls: string) => [...overlay.matchAll(new RegExp(`class="${cls}(?: [^"]*)?"[^>]*><title>([^:<]*):`, "g"))].map((m) => m[1]);
/** the build sheet's label for each design point, "" for points that aren't on it */
const sheetLabels = (doc: RcTrack) => {
  const s = buildSheet(doc);
  return doc.design.points.map((_, i) => s.cornerPoints.find((c) => c.index === i)?.label ?? "");
};

beforeEach(() => (plans.length = 0));
afterEach(() => (vi.unstubAllGlobals(), (baked = undefined)));

describe("the designer numbers corners as the build sheet and the Corners figure do (#176)", () => {
  it.each([["club-a", clubA], ["a hairpin and a point that isn't a corner", hairpin]] as const)("%s: Quick mode's dots carry the build sheet's labels", (_, doc) => {
    const d = doc();
    const { overlay } = open(d, "quick");
    expect(dots(overlay)).toEqual(sheetLabels(d));
    // the Corners figure counts the numbers the dots show
    const numbers = new Set(sheetLabels(d).filter(Boolean).map((l) => parseInt(l, 10)));
    expect(numbers.size).toBe(d.built!.stats.corners);
  });

  it("club-a: the hairpin points are 5a and 5b, one corner of 12", () => {
    const d = clubA();
    const { overlay, html } = open(d, "quick");
    expect(dots(overlay).slice(0, 6)).toEqual(["1", "2", "3", "4", "5a", "5b"]);
    expect(titles(overlay, "ed-corner").slice(4, 6)).toEqual(["Corner 5a", "Corner 5b"]);
    expect(html).toContain("<dd>12</dd><dt>Corners</dt>");
  });

  it("a point that isn't a corner has no number and no name: it is just Point", () => {
    const { overlay } = open(hairpin(), "quick");
    expect(dots(overlay)).toEqual(["1", "2", "3a", "3b", "4", "", "5"]);
    expect(titles(overlay, "ed-corner")).toEqual(["Corner 1", "Corner 2", "Corner 3a", "Corner 3b", "Corner 4", "Point", "Corner 5"]);
  });

  it("Advanced mode's corner points carry the same names", () => {
    const { overlay } = open(hairpin(), "advanced");
    expect(titles(overlay, "ed-point")).toEqual(["Corner point 1", "Corner point 2", "Corner point 3a", "Corner point 3b", "Corner point 4", "Point", "Corner point 5"]);
  });

  it("the selection panel and the phone's sheet are named the same way", () => {
    const d = draftFromDoc(clubA());
    expect(sheetLabel({ kind: "point", i: 4 }, "quick", d)).toBe("Corner 5a");
    expect(sheetLabel({ kind: "point", i: 5 }, "advanced", d)).toBe("Corner point 5b");
    expect(sheetLabel({ kind: "point", i: 5 }, "quick", draftFromDoc(hairpin()))).toBe("Point");
    expect(sheetLabel({ kind: "point", i: 5 }, "advanced", draftFromDoc(hairpin()))).toBe("Point");
  });

  // Board, 25 Nov 2026: under its "Point" heading a point that isn't a corner is a "point", never a "corner"
  describe("a point that isn't a corner is called a point in its own panel", () => {
    /** the hairpin layout with one more point halfway along the first straight: dead straight, index 1 */
    const withStraight = (): RcTrack => {
      const doc = hairpin();
      return { ...doc, design: { ...doc.design, points: [HAIRPIN[0], { x: -5, z: -8 }, ...HAIRPIN.slice(1)] } };
    };
    const panel = (doc: RcTrack, i: number, view: "quick" | "advanced", opts: { touch?: boolean; phone?: boolean } = {}) => {
      const d = draftFromDoc(doc);
      return renderToStaticMarkup(<SelectionPanel sel={{ kind: "point", i }} view={view} draft={d} live={liveGeometry(d.design)} update={() => {}} onDelete={() => {}} inCorner={new Map()} {...opts} />);
    };
    const button = (html: string) => html.match(/<button[^>]*btn-danger[^>]*>([^<]*)</)?.[1];

    it("Quick, on a straight line: \"This point is on a straight line\" and Delete point", () => {
      const html = panel(withStraight(), 1, "quick");
      expect(html).toContain('<h2 id="sel-h">Point</h2>');
      expect(html).toContain("This point is on a straight line: drag it to make a turn, or delete it.");
      expect(button(html)).toBe("Delete point");
      expect(html).not.toMatch(/[Cc]orner/);
    });

    it("Quick, a slight bend: drag the point, its outside pipe, Delete point", () => {
      const html = panel(hairpin(), 5, "quick");
      expect(html).toContain('<h2 id="sel-h">Point</h2>');
      expect(html).toContain("Drag the point to move it, or its inside handle to cut it back. Right-click it or press Delete to remove it.");
      expect(html).toContain('role="radiogroup" aria-label="Outside pipe"');
      expect(button(html)).toBe("Delete point");
      expect(html.replace(/title="[^"]*"/g, "")).not.toMatch(/[Cc]orner/); // the Square choice's tip still describes pipes "meeting in a corner"
      expect(panel(hairpin(), 5, "quick", { touch: true })).toContain("Drag the point to move it, or its inside handle to cut it back.</p>");
    });

    it("Advanced: no corner wording either, on the laptop or in the phone's sheet", () => {
      for (const opts of [{}, { touch: true, phone: true }]) {
        for (const [doc, i] of [[withStraight(), 1], [hairpin(), 5]] as const) {
          const html = panel(doc, i, "advanced", opts);
          expect(html).toContain('<h2 id="sel-h">Point</h2>');
          expect(html).toContain('aria-label="Outside pipe"');
          if (!opts.phone) expect(button(html)).toBe("Delete point");
          expect(html.replace(/title="[^"]*"/g, "").replace("drag it to make a corner", "")).not.toMatch(/[Cc]orner/);
        }
      }
    });

    it("a real corner keeps its corner wording", () => {
      const quick = panel(hairpin(), 2, "quick");
      expect(quick).toContain('<h2 id="sel-h">Corner 3a</h2>');
      expect(quick).toContain("Drag the corner to move it, or its inside handle to cut it back.");
      expect(quick).toContain('aria-label="Outside corner"');
      expect(button(quick)).toBe("Delete corner");
      expect(panel(hairpin(), 2, "advanced")).toContain('aria-label="Outside corner"');
    });

    it("its dot's and apex handle's titles, and the phone's held-point sheet, don't say corner", () => {
      const { overlay } = open(hairpin(), "quick");
      const all = [...overlay.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
      const mine = all.filter((t) => t.startsWith("Point:"));
      expect(mine.length).toBeGreaterThanOrEqual(2); // the dot and its apex handle
      for (const t of mine) expect(t).not.toMatch(/corner/i);
      expect(mine.some((t) => t.startsWith("Point: drag in or out to cut it back (apex radius"))).toBe(true);
      expect(all.some((t) => t.startsWith("Corner 1: drag in or out to cut the corner back"))).toBe(true);
      const d = draftFromDoc(hairpin());
      const labels = (i: number, view: "quick" | "advanced") => contextActions({ kind: "point", i }, view, d, liveGeometry(d.design)).map((a) => a.label);
      expect(labels(5, "quick")).toEqual(["Delete", "Round outside pipe"]);
      expect(labels(5, "advanced")).toEqual(["Delete", "Round outside pipe", "Make hairpin"]);
      expect(labels(2, "quick")[1]).toMatch(/^(Round|Square) outside corner$/);
    });
  });

  it("what to fix names the corner by its label", () => {
    const msg = submitBlock({ dirty: false, pending: false, points: HAIRPIN, laneWidth: 2, checks: [{ level: "error", code: "outside-area", x: 12.2, z: 2.1, message: "x" }] });
    expect(msg).toBe("Submit is waiting on 1 error. Move corner 3b back inside the track area to fix it.");
    // a point that isn't a corner has no name, so the sentence is about the track
    const bend = submitBlock({ dirty: false, pending: false, points: HAIRPIN, checks: [{ level: "error", code: "obstacle", x: -5, z: 8.7, message: "x" }] });
    expect(bend).toBe("Submit is waiting on 1 error. Move the track off the fixed obstacle to fix it.");
  });

  it("the add-point hint names the selected corner", () => {
    expect(shapeHint({ advanced: false, tablet: false, adding: true, sel: "corner 5a" })).toBe("Click the track or the floor to add a corner after corner 5a. Esc or A to stop.");
  });
});
