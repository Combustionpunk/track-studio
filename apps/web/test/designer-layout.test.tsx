// The designer's layout shell (#120): one state, three layouts. Desktop is the fallback (bar, palette, plan, side
// column), a coarse pointer in Quick mode gets the tablet layout (plan, dock, pill), and under 640 px the phone gets the
// view-only screen ("Design on a laptop or tablet"). Static renders with the plan and the bake mocked.
import type { RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../src/lib/hooks.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const saved = () => ref<RcTrack>("examples/club-a.rctrack.json");

vi.mock("../src/lib/hooks.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/hooks.js")>();
  return { ...real, useApi: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }) as Loadable<unknown> };
});
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));
let baked: RcTrack["built"] = undefined;
vi.mock("../src/designer/useBake.js", () => ({ useBake: () => ({ built: baked ?? null, pending: false, error: null, ms: 0 }) }));
// the plan: what it was asked to draw, in place of the drawing
const plans: Record<string, unknown>[] = [];
vi.mock("../src/components/PlanView.js", async (orig) => ({
  ...(await orig<typeof import("../src/components/PlanView.js")>()),
  PlanView: (p: Record<string, unknown>) => (plans.push(p), <svg className={`plan-svg ${p.className ?? ""}`} aria-label={p.label as string} />),
}));

const { Designer, draftFromDoc, newDraft, PHONE_QUERY, TOUCH_QUERY } = await import("../src/designer/Designer.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
import type { DesignerBase } from "../src/designer/Designer.js";

const me = { id: 1, username: "yeti", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false };
const session = { me, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
const track = { status: "draft", approvedRevision: null } as unknown as DesignerBase["track"];
/** a saved track of the author's, open to edit */
const edit = (doc = saved()) => (
  (baked = doc.built),
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Designer mode="edit" initial={draftFromDoc(doc)} base={{ id: "club-a", revision: 1, doc, track, can: { submit: true } } as unknown as DesignerBase} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  ));
/** a new track, laying the lanes */
const laying = () =>
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Designer mode="new" initial={newDraft({ area: { length: 22, width: 12 }, name: "Blank" })} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
/** the mode, and the screen: a phone (under 640 px), a tablet (a coarse pointer) or a laptop */
const setup = (mode: "quick" | "advanced", screen?: "phone" | "tablet") => {
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
  const query = screen === "phone" ? PHONE_QUERY : screen === "tablet" ? TOUCH_QUERY : null;
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === query }), location: { href: "http://localhost/t/club-a/edit" } });
};

beforeEach(() => (plans.length = 0));
afterEach(() => (vi.unstubAllGlobals(), (baked = undefined)));

describe("a phone (under 640 px): the view-only screen", () => {
  it.each(["quick", "advanced"] as const)("%s, a saved track: the plan to look at, the figures, a link to copy; nothing to edit with", (mode) => {
    setup(mode, "phone");
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-phone">/);
    expect(html).toContain("<h1>Design on a laptop or tablet</h1>");
    expect(html).toContain("Copy link to this design");
    // the plan, view only
    expect(plans).toHaveLength(1);
    expect(plans[0].interactive).toBe(false);
    expect(plans[0].className).toBe("phone-plan");
    expect(plans[0].label).toBe("Plan of Club A, view only");
    // the figures
    expect(html).toMatch(/<dd>[\d.]+ m<\/dd><dt>Lap<\/dt>/);
    expect(html).toMatch(/<dd>\d+<\/dd><dt>Corners<\/dt>/);
    expect(html).toMatch(/<dd>Draft<\/dd><dt>Status<\/dt>/);
    // back to the track
    expect(html).toContain('href="/t/club-a"');
    // none of the editing layouts
    for (const s of ['class="designer-grid"', 'class="designer-palette"', 'class="designer-side"', 'class="designer-dock"', 'class="mode-toggle"', "Save revision", "designer-hint", 'role="toolbar"']) {
      expect(html, s).not.toContain(s);
    }
  });

  it("a new track: nothing laid yet, and a note that unsaved work stays in the browser", () => {
    setup("quick", "phone");
    const html = laying();
    expect(html).toContain("<h1>Design on a laptop or tablet</h1>");
    expect(html).toContain("Changes you haven&#x27;t saved stay in this browser until you save them.");
    expect(html).toContain("<dd>—</dd><dt>Lap</dt>");
    expect(html).toContain("<dd>Not saved</dd><dt>Status</dt>");
    expect(plans[0].built).toBeUndefined(); // no track yet
    expect(html).not.toContain('class="designer-grid"');
  });
});

describe("a laptop: bar, palette, plan and the side column", () => {
  it("Quick: jumps and the track tools on the left, How to draw on the right, the bar's controls", () => {
    setup("quick");
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-quick ">/);
    expect(html).toContain('<div class="designer-bar">');
    expect(html).toContain('<aside class="designer-palette" aria-label="Add to the track">');
    expect(html).toContain("Add point");
    expect(html).toContain("Snap to lanes");
    expect(html).toContain('<aside class="designer-side" aria-label="Details">');
    expect(html).toContain("<summary>How to draw</summary>");
    for (const s of ["Undo", "Redo", "Reverse direction", "Save revision", "Submit track", 'aria-label="Steps"']) expect(html, s).toContain(s);
    expect(html).not.toContain('class="designer-dock"');
    expect(html).not.toContain("designer-phone");
    expect(plans[0].interactive).toBeUndefined(); // the default: editable
    expect(plans[0].controls).toBe(true);
  });

  it("Advanced: the snap modes, Checks on the right", () => {
    setup("advanced");
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-advanced ">/);
    expect(html).toContain('role="radiogroup" aria-label="Snap"');
    expect(html).toContain('<aside class="designer-side" aria-label="Checks">');
    expect(html).toContain('id="ck-h"');
    expect(html).not.toContain('aria-label="Steps"');
  });

  it("laying the lanes: step 1's help in the palette, the lane so far on the right", () => {
    setup("quick");
    const html = laying();
    expect(html).toContain('<aside class="designer-palette" aria-label="Lay the lanes">');
    expect(html).toContain("Start again");
    expect(html).toContain('<aside class="designer-side" aria-label="The lane so far">');
    expect(html).toContain("<dt>Squares</dt>");
  });
});

describe("a tablet (a coarse pointer, Quick): the plan with a dock, no columns", () => {
  it("a saved track: the dock's tools, the checks pill; the bar keeps its short form", () => {
    setup("quick", "tablet");
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-quick designer-touch">/);
    expect(html).toContain('<div class="designer-dock" role="toolbar" aria-label="Designer tools">');
    expect(html).toContain('class="checks-pill');
    expect(html).toContain('aria-label="Zoom to fit"');
    expect(html).not.toContain('class="designer-palette"');
    expect(html).not.toContain('class="designer-side"');
    expect(html).not.toContain("Reverse direction</button>"); // the dock's "Reverse" instead
    expect(plans[0].controls).toBe(false);
  });

  it("laying the lanes: Start again in the dock, no pill yet", () => {
    setup("quick", "tablet");
    const html = laying();
    expect(html).toContain('class="designer-dock"');
    expect(html).toContain(">Start again</button>");
    expect(html).not.toContain("checks-pill");
  });

  it("Advanced on a tablet is the laptop layout", () => {
    setup("advanced", "tablet");
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-advanced ">/);
    expect(html).toContain('class="designer-palette"');
    expect(html).not.toContain('class="designer-dock"');
  });
});
