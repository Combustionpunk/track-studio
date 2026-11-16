// The phone designer's sheets (#123): selection, Checks, Jump and How to draw, each on the bottom `Sheet` above the
// toolbar. Static renders with the bake's own checks (the worker doesn't run here), as in checks-tab.test.tsx; the
// taps, the drag that tucks a sheet and Show are in e2e/phone-sheets.e2e.ts.
import type { Check, RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../src/lib/hooks.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const extra = (name: string) => JSON.parse(readFileSync(join(__dirname, "../../../packages/engine/test/fixtures/extra", `${name}.rctrack.json`), "utf8")) as RcTrack;

vi.mock("../src/lib/hooks.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/hooks.js")>();
  return { ...real, useApi: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }) as Loadable<unknown> };
});
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));
let baked: RcTrack["built"] = undefined;
vi.mock("../src/designer/useBake.js", () => ({ useBake: () => ({ built: baked ?? null, pending: false, error: null, ms: 0 }) }));
vi.mock("../src/components/PlanView.js", async (orig) => ({ ...(await orig<typeof import("../src/components/PlanView.js")>()), PlanView: () => <svg className="plan-svg" /> }));

const { Designer, draftFromDoc, PHONE_QUERY, TOUCH_QUERY } = await import("../src/designer/Designer.js");
const { PhoneSheets, PhoneChecks, PhoneJumps, PhoneHowTo, sheetLabel } = await import("../src/designer/PhoneSheets.js");
const { BottomToolbar } = await import("../src/designer/PhoneEditLayout.js");
const { liveGeometry } = await import("../src/designer/geometry.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
import type { DesignerBase, Selection } from "../src/designer/Designer.js";
import type { PanelProps } from "../src/designer/SidePanels.js";
import type { ToolPaletteProps } from "../src/designer/ToolPalette.js";

const me = { id: 1, username: "yeti", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false };
const session = { me, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };

afterEach(() => (vi.unstubAllGlobals(), (baked = undefined)));

/** the panels' props for a track, as the Designer makes them */
const panels = (doc: RcTrack, view: "quick" | "advanced", sel: Selection, more: Partial<PanelProps> = {}): PanelProps => {
  const draft = draftFromDoc(doc);
  return {
    view,
    checks: doc.built!.checks,
    bakedFeatures: doc.built!.features,
    pending: false,
    showSubmit: true,
    blocked: null,
    onShow: () => {},
    onMakeCrossover: () => {},
    onBridge: () => {},
    draft,
    drawn: draft,
    sel,
    live: liveGeometry(draft.design),
    update: () => {},
    onDelete: () => {},
    venueName: undefined,
    inCorner: new Map(),
    checksHeading: { current: null },
    ...more,
  };
};
const jumps = (view: "quick" | "advanced", more: Partial<ToolPaletteProps> = {}): ToolPaletteProps => ({
  view,
  laying: false,
  canStartAgain: false,
  onStartAgain: () => {},
  tool: { kind: "select" },
  onJump: () => {},
  onAdd: () => {},
  startOn: false,
  onStartLine: () => {},
  laneSnap: true,
  onLaneSnap: () => {},
  snap: "lanes",
  onSnap: () => {},
  ...more,
});
const render = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
/** the one sheet, open on `kind` */
/** the ⋯ menu's and its sheets' props (#124), not used by these sheets */
const nop = () => {};
const others = {
  menu: { view: "quick" as const, onView: nop, save: { label: "Save revision", state: "Saved", disabled: true, loginUrl: null, onSave: nop }, submit: { why: null, onSubmit: nop, onSeeChecks: null }, reverse: { onReverse: nop, canReverse: true }, onFit: nop, onDetails: nop, onHowTo: nop, backTo: { to: "/t/x", label: "Back to track" } },
  save: { mode: "edit" as const, note: "", setNote: nop, onSave: nop, saving: false, revision: 1, approvedRevision: null },
  details: { name: "X", onName: nop, description: undefined, onDescription: nop, venueName: undefined, area: { length: 22, width: 12 }, status: undefined },
};
const sheet = (kind: "selection" | "checks" | "jump" | "howto", p: PanelProps, height: "peek" | "full" = "peek", tucked = false, j = jumps(p.view)) =>
  render(<PhoneSheets sheet={{ kind, height }} onHeight={() => {}} tucked={tucked} panels={p} built={baked ?? ref<RcTrack>("examples/club-a.rctrack.json").built!} jumps={j} {...others} />);
const buttons = (html: string) => html.match(/<button[^>]*>.*?<\/button>/g) ?? [];

describe("the selection sheet", () => {
  const clubA = () => ref<RcTrack>("examples/club-a.rctrack.json");

  it("Quick, a corner: the turn, four size chips, the apex radius as a stepper, Outside corner; no Delete, no keyboard", () => {
    const html = sheet("selection", panels(clubA(), "quick", { kind: "point", i: 2 }));
    expect(html).toMatch(/<section class="bottom-sheet bottom-sheet--peek[^"]*"[^>]*role="dialog" aria-label="Corner 3"/);
    expect(html).toContain('<h2 id="sel-h">Corner 3</h2>');
    expect(html).toContain('class="sel-turn"');
    // the four sizes, as 44 px chips
    const sizes = /<div class="sizes phone-sizes" role="group" aria-label="Quick sizes">(.*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(sizes.match(/<button[^>]*class="phone-chip"/g)).toHaveLength(4);
    for (const s of ["Hairpin", "Tight", "Medium", "Sweeper"]) expect(sizes).toContain(s);
    // the stepper: − / value / +, and no number field (so no keyboard)
    const stepper = /<div class="stepper" role="group" aria-label="Apex radius">(.*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(stepper).toMatch(/<button[^>]*aria-label="Smaller"/);
    expect(stepper).toMatch(/<output[^>]*>\d+\.\d m<\/output>/);
    expect(stepper).toMatch(/<button[^>]*aria-label="Bigger"/);
    expect(html).not.toContain("<input");
    expect(html).toContain('role="radiogroup" aria-label="Outside corner"');
    // Delete is on the toolbar only
    expect(html).not.toMatch(/Delete/);
    // what fingers do, not the mouse
    expect(html).not.toMatch(/right-click|click/i);
  });

  it("the stepper's buttons stop at the ends", () => {
    const doc = clubA();
    doc.design.points[2] = { ...doc.design.points[2], radius: 0 }; // apex 0
    const html = sheet("selection", panels(doc, "quick", { kind: "point", i: 2 }));
    expect(html).toMatch(/<button[^>]*aria-label="Smaller"[^>]*disabled/);
    expect(html).not.toMatch(/<button[^>]*aria-label="Bigger"[^>]*disabled/);
    expect(html).toContain("<output");
    expect(/<output[^>]*>([^<]*)<\/output>/.exec(html)?.[1]).toBe("0.0 m");
  });

  it("Advanced, a corner point: its number fields and lane width, Outside corner; no Delete", () => {
    const html = sheet("selection", panels(clubA(), "advanced", { kind: "point", i: 0 }));
    expect(html).toMatch(/aria-label="Corner point 1"/);
    for (const f of ["East (x)", "North (z)", "Radius", "Lane width"]) expect(html, f).toContain(`<span>${f}</span>`);
    expect(html).toContain('aria-label="Outside corner"');
    expect(html).not.toMatch(/Delete/);
    expect(html).not.toMatch(/Wheel|Ctrl/);
  });

  it.each(["quick", "advanced"] as const)("%s, a jump and the start line: no Delete", (view) => {
    const p = panels(clubA(), view, { kind: "feature", i: 0 });
    const jump = sheet("selection", p);
    expect(jump).toMatch(/aria-label="Tabletop"/);
    expect(jump).toContain("Drag it along the track");
    expect(jump).not.toMatch(/Delete/);
    if (view === "advanced") expect(jump).toContain("<span>Length</span>");
    const start = sheet("selection", { ...p, sel: { kind: "start" } });
    expect(start).toMatch(/aria-label="Start (line|\/ finish)"/);
    expect(start).not.toMatch(/Delete/);
  });

  it("names the sheet after what's selected", () => {
    const d = draftFromDoc(clubA());
    expect(sheetLabel({ kind: "point", i: 4 }, "quick", d)).toBe("Corner 5");
    expect(sheetLabel({ kind: "point", i: 4 }, "advanced", d)).toBe("Corner point 5");
    expect(sheetLabel({ kind: "feature", i: 1 }, "quick", d)).toBe("Double");
    expect(sheetLabel({ kind: "start" }, "quick", d)).toBe("Start line");
  });

  it("tucked while a finger drags: down to its grab bar, the content out of reach, the height kept", () => {
    const html = sheet("selection", panels(clubA(), "quick", { kind: "point", i: 2 }), "peek", true);
    expect(html).toMatch(/<section class="bottom-sheet bottom-sheet--peek bottom-sheet--tucked/);
    expect(html).toMatch(/<div class="bottom-sheet-body" inert="">/);
  });
});

describe("the Checks sheet", () => {
  it.each(["quick", "advanced"] as const)("%s: the counts, the rows with a Show each, why Submit waits, the venue check, the figures", (view) => {
    const doc = extra("overlap-straights");
    baked = doc.built;
    const blocked = "Submit is waiting on 1 error. Move the straights apart.";
    const html = sheet("checks", panels(doc, view, null, { blocked }), "full");
    expect(html).toMatch(/<section class="bottom-sheet bottom-sheet--full[^"]*"[^>]*role="dialog" aria-label="Checks"/);
    expect(html).toContain('<p class="check-counts" aria-live="polite"><span class="lvl-error">1 error</span></p>');
    // the rows in the Advanced tab's words, each with a Show
    const check = doc.built!.checks[0] as Check;
    expect(html).toContain(check.message);
    expect(html).toMatch(/<button type="button" class="check-show">Show<\/button>/);
    expect(html).toContain(`<p id="submit-why" class="submit-why">${blocked}</p>`);
    expect(html).toContain("Check against a venue");
    // lap, corners and jumps at the bottom
    const figures = /<dl class="figures">(.*?)<\/dl>/.exec(html)?.[1] ?? "";
    for (const f of ["Lap", "Corners", "Jumps"]) expect(figures).toContain(`<dt>${f}</dt>`);
    expect(html.indexOf("Check against a venue")).toBeLessThan(html.indexOf('<dl class="figures">'));
  });

  it("no problems", () => {
    const doc = ref<RcTrack>("examples/club-a.rctrack.json");
    const html = render(<PhoneChecks {...panels(doc, "quick", null)} built={doc.built!} />);
    expect(html).toContain("No problems");
    expect(html).not.toContain("check-show");
  });
});

describe("the Jump sheet", () => {
  it("Quick: five jumps as chips with their plan symbols, Start line, and the Snap to lanes switch", () => {
    const html = render(<PhoneJumps {...jumps("quick")} />);
    const chips = /<div class="phone-jumps-group" role="group" aria-label="Jumps">(.*?)<\/div>/.exec(html)?.[1] ?? "";
    const names = [...chips.matchAll(/<\/svg>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(names).toEqual(["Tabletop", "Double", "Kicker", "Whoops", "Crossover"]);
    expect(chips.match(/class="jump-symbol"/g)).toHaveLength(5);
    for (const b of buttons(chips)) expect(b).toContain('class="phone-chip"');
    expect(html).toMatch(/<button type="button" class="phone-chip phone-chip-start" aria-pressed="false">Start line<\/button>/);
    // the snap setting, last
    expect(html).toMatch(/<button type="button" role="switch" aria-checked="true"[^>]*>Snap to lanes/);
    expect(html).not.toContain('role="radiogroup"');
    expect(html.indexOf("Start line")).toBeLessThan(html.indexOf("Snap to lanes"));
    // tap, not click
    expect(html).toContain("Tap on the racing line");
    expect(html).not.toMatch(/click/i);
  });

  it("Advanced: Step-up, Step-down and Bump too, and the Snap radio", () => {
    const html = render(<PhoneJumps {...jumps("advanced", { tool: { kind: "feature", type: "kicker" }, snap: "fine" })} />);
    for (const n of ["Step-up", "Step-down", "Bump"]) expect(html).toContain(n);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Kicker/);
    expect(html).toContain('role="radiogroup" aria-label="Snap"');
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Fine/);
    expect(html).not.toContain('role="switch"');
  });
});

describe("How to draw", () => {
  it.each(["quick", "advanced"] as const)("%s: the text with the keyboard and mouse taken out, and tap for click", (view) => {
    const html = render(<PhoneHowTo view={view} />);
    expect(html).toContain("<h2");
    expect(html).toContain("How to draw");
    expect(html).not.toMatch(/<kbd>|click|wheel|right-|Ctrl|Shift|Alt\b|Esc/i);
    expect(html).toMatch(/\btap\b/i);
    expect(html).toContain("Add point");
    expect(html).toContain("pinch");
  });

  it("opened as a sheet", () => {
    const html = sheet("howto", panels(ref<RcTrack>("examples/club-a.rctrack.json"), "quick", null), "full");
    expect(html).toMatch(/role="dialog" aria-label="How to draw"/);
  });
});

describe("the phone layout with the sheets", () => {
  const PHONE = [PHONE_QUERY, TOUCH_QUERY];
  const setup = (mode: "quick" | "advanced") => {
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: PHONE.includes(q) }), location: { href: "http://localhost/t/x/edit" } });
  };
  const edit = (doc: RcTrack) => (
    (baked = doc.built),
    renderToStaticMarkup(
      <SessionContext.Provider value={session}>
        <MemoryRouter initialEntries={["/t/x/edit"]}>
          <Designer mode="edit" initial={draftFromDoc(doc)} base={{ id: "x", revision: 1, doc, track: { status: "draft", approvedRevision: null }, can: { submit: true } } as unknown as DesignerBase} storageKey="test" />
        </MemoryRouter>
      </SessionContext.Provider>,
    ));

  it.each(["quick", "advanced"] as const)("%s: the checks pill over the plan, Jump on, ⋯ in the header (How to draw is in its menu); no sheet open yet", (mode) => {
    setup(mode);
    const html = edit(extra("overlap-straights"));
    expect(html).toMatch(/<button type="button" class="checks-pill checks-pill-error" aria-expanded="false">.*?1 error<\/button>/);
    expect(html.indexOf("checks-pill")).toBeGreaterThan(html.indexOf('class="designer-plan-wrap"'));
    expect(html.indexOf("checks-pill")).toBeLessThan(html.indexOf('class="phone-toolbar"'));
    const jump = /<button[^>]*><svg[^>]*lucide-layout-grid[^>]*>.*?<\/svg><span class="phone-tool-label">Jump<\/span><\/button>/.exec(html)?.[0] ?? "";
    expect(jump).not.toBe("");
    expect(jump).not.toContain("disabled");
    expect(html).toMatch(/<header class="phone-header">.*<button[^>]*aria-label="More" aria-haspopup="menu"/);
    expect(/<header class="phone-header">.*?<\/header>/.exec(html)?.[0]).not.toContain("How to draw");
    expect(html).not.toContain('class="bottom-sheet');
  });

  it("the pill says No problems on a clean track", () => {
    setup("quick");
    expect(edit(ref("examples/club-a.rctrack.json"))).toMatch(/class="checks-pill checks-pill-ok"[^>]*>.*?No problems<\/button>/);
  });

  const noop = () => {};
  it("the toolbar's Jump: pressed while a jump is armed (a mode, as Add point)", () => {
    const props = { tool: "feature" as const, onSelect: noop, onAdd: noop, canDelete: false, onDelete: noop, undo: noop, redo: noop, canUndo: false, canRedo: false, onJump: noop };
    const html = renderToStaticMarkup(<BottomToolbar {...props} />);
    const jump = /<button[^>]*>(?:(?!<\/button>).)*Jump<\/span><\/button>/.exec(html)?.[0] ?? "";
    expect(jump).toContain('aria-pressed="true"');
    expect(jump).not.toContain("aria-expanded");
  });

});
