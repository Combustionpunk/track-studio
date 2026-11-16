// The phone designer (#122): under 640 px (the default since #124, which took the `?phone=edit` switch away), the
// designer is a 52 px header, the plan and a 64 px toolbar; a landscape phone gets "Turn your phone upright to edit"
// over it. Static renders with the plan and the bake mocked, as in designer-layout.test.tsx.
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

const { Designer, draftFromDoc, newDraft, PHONE_QUERY, TOUCH_QUERY, LANDSCAPE_PHONE_QUERY } = await import("../src/designer/Designer.js");
const { BottomToolbar, PhoneHeader } = await import("../src/designer/PhoneEditLayout.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
import type { DesignerBase } from "../src/designer/Designer.js";

const me = { id: 1, username: "yeti", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false };
const session = { me, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
const track = { status: "draft", approvedRevision: null } as unknown as DesignerBase["track"];
/** a saved track of the author's, open to edit at `search` */
const edit = (search = "", doc = saved()) => (
  (baked = doc.built),
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={[`/t/club-a/edit${search}`]}>
        <Designer mode="edit" initial={draftFromDoc(doc)} base={{ id: "club-a", revision: 1, doc, track, can: { submit: true } } as unknown as DesignerBase} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  ));
/** a new track, laying the lanes */
const laying = (search = "") =>
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={[`/new/design${search}`]}>
        <Designer mode="new" initial={newDraft({ area: { length: 22, width: 12 }, name: "Blank" })} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
/** the mode, and the media queries that match */
const setup = (mode: "quick" | "advanced", queries: string[]) => {
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: queries.includes(q) }), location: { href: "http://localhost/t/club-a/edit" } });
};
/** a phone held upright: narrow, and a finger */
const PHONE = [PHONE_QUERY, TOUCH_QUERY];

beforeEach(() => (plans.length = 0));
afterEach(() => (vi.unstubAllGlobals(), (baked = undefined)));

/** the opening tag of the first element with this class */
const tag = (html: string, cls: string) => new RegExp(`<[a-z]+[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`).exec(html)?.[0] ?? "";
/** the toolbar's button with this label */
const tool = (html: string, label: string) => {
  const m = new RegExp(`<button[^>]*>(?:(?!</button>).)*<span[^>]*>${label}</span></button>`).exec(html);
  return m?.[0] ?? "";
};

describe("a phone: header, plan and toolbar", () => {
  it.each(["quick", "advanced"] as const)("%s: the three bands, and none of the other layouts", (mode) => {
    setup(mode, PHONE);
    const html = edit();
    expect(html).toMatch(new RegExp(`^<div class="designer designer-phone-edit designer-${mode}">`));
    // the header: back to the track, the name, the save state in a word, the ⋯ button (its menu came with #124)
    const header = /<header class="phone-header">.*?<\/header>/.exec(html)?.[0] ?? "";
    expect(header).toContain('href="/t/club-a"');
    expect(header).toContain('aria-label="Back to track"');
    expect(header).toContain('<p class="phone-name">Club A</p>');
    expect(header).toContain('<span class="phone-save" aria-live="polite">Saved</span>');
    expect(header).toMatch(/<button[^>]*aria-label="More" aria-haspopup="menu"/);
    // the plan: editable, with no zoom buttons or layers
    expect(plans).toHaveLength(1);
    expect(plans[0].interactive).toBeUndefined();
    expect(plans[0].controls).toBe(false);
    expect(typeof plans[0].overlay).toBe("function");
    expect(html).toContain('class="designer-hint"');
    // the toolbar
    expect(html).toContain('<nav class="phone-toolbar" role="toolbar" aria-label="Designer tools">');
    for (const label of ["Select", "Add point", "Jump", "Delete", "Undo", "Redo"]) expect(tool(html, label), label).not.toBe("");
    expect(tool(html, "Select")).toContain('aria-pressed="true"');
    expect(tool(html, "Add point")).toContain('aria-pressed="false"');
    expect(tool(html, "Jump")).not.toContain("disabled"); // its sheet came with #123
    expect(tool(html, "Delete")).toContain("disabled"); // nothing selected
    expect(tool(html, "Undo")).toContain("disabled");
    expect(tool(html, "Redo")).toContain("disabled");
    // none of the other layouts, no 2D / 3D switch, no turn-upright message
    for (const s of ['class="designer-bar"', 'class="designer-grid"', 'class="designer-palette"', 'class="designer-side"', 'class="designer-dock"', 'class="mode-toggle"', "designer-viewswitch", "Design on a laptop or tablet", "Turn your phone upright"]) {
      expect(html, s).not.toContain(s);
    }
  });

  it("the first hint says to pinch in, with tap for click", () => {
    setup("quick", PHONE);
    const hint = /<div class="designer-hint">([^<]*)<\/div>/.exec(edit())?.[1] ?? "";
    expect(hint).toMatch(/^Pinch to zoom in\./);
    expect(hint).toContain("Tap");
    expect(hint).not.toMatch(/click|hold/i);
  });

  it("a narrow window with a mouse gets the same layout, with click and scroll", () => {
    setup("quick", [PHONE_QUERY]);
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-phone-edit designer-quick">/);
    const hint = /<div class="designer-hint">([^<]*)<\/div>/.exec(html)?.[1] ?? "";
    expect(hint).toMatch(/^Scroll to zoom in\./);
    expect(hint).toContain("Click");
    expect(hint).not.toMatch(/pinch|tap/i);
  });

  it("a landscape phone: the layout stays (nothing unmounts) and the message covers it", () => {
    // wider than 640 px on its side, so only the landscape query matches
    setup("quick", [LANDSCAPE_PHONE_QUERY, TOUCH_QUERY]);
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-phone-edit designer-quick">/);
    expect(html).toContain('class="phone-toolbar"');
    expect(tag(html, "phone-upright")).toContain('role="alert"');
    expect(html).toContain("Turn your phone upright to edit");
  });

  it("a new track still laying the lanes: a screen that says to lay them on a laptop or tablet (stage 2)", () => {
    setup("quick", PHONE);
    const html = laying();
    expect(html).toMatch(/^<div class="designer designer-phone">/);
    expect(html).toContain("<h1>Lay the lanes on a laptop or tablet</h1>");
  });
});

describe("above 640 px: the laptop and tablet layouts, as they were", () => {
  it("a laptop", () => {
    setup("quick", []);
    expect(edit()).toMatch(/^<div class="designer designer-quick ">/);
  });
  it("a tablet", () => {
    setup("quick", [TOUCH_QUERY]);
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-quick designer-touch">/);
    expect(html).toContain('class="designer-dock"');
    expect(html).not.toContain("phone-");
  });
});

describe("the pieces", () => {
  const backTo = { to: "/t/x", label: "Back to track" };
  // (#124) "Unsaved" and "Not saved yet" became a Save button: phone-menu.test.tsx
  it.each([
    [{ dirty: true, revision: 3 }, "Save"],
    [{ dirty: false, revision: 3 }, "Saved"],
    [{ dirty: false, revision: undefined }, "Save"],
    [{ dirty: true, revision: undefined }, "Save"],
  ])("the header's save state for %o: %s", (s, word) => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PhoneHeader backTo={backTo} name="" {...s} loggedIn loginUrl="/auth/login" saving={false} saveOpen={false} onSave={() => {}} menuOpen={false} onMenu={() => {}} />
      </MemoryRouter>,
    );
    const state = /<span class="phone-save" aria-live="polite">(.*?)<\/span><button/.exec(html)?.[1] ?? "";
    expect(state.replace(/<[^>]+>/g, "")).toBe(word);
    expect(html).toContain('<p class="phone-name">Untitled track</p>');
  });

  const props = { tool: "select" as const, onSelect: () => {}, onAdd: () => {}, canDelete: false, onDelete: () => {}, undo: () => {}, redo: () => {}, canUndo: false, canRedo: false, onJump: () => {} };
  it("Delete is enabled while something can be deleted; Add point is a mode", () => {
    const html = renderToStaticMarkup(<BottomToolbar {...props} tool="add" canDelete canUndo canRedo />);
    expect(tool(html, "Delete")).not.toContain("disabled");
    expect(tool(html, "Undo")).not.toContain("disabled");
    expect(tool(html, "Redo")).not.toContain("disabled");
    expect(tool(html, "Add point")).toContain('aria-pressed="true"');
    expect(tool(html, "Select")).toContain('aria-pressed="false"');
    // Jump opens its sheet (#123); pressed only while a jump is armed
    expect(tool(html, "Jump")).not.toContain("disabled");
    expect(tool(html, "Jump")).toContain('aria-pressed="false"');
  });

  it("every button has a label and a Lucide icon", () => {
    const html = renderToStaticMarkup(<BottomToolbar {...props} />);
    const buttons = html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(6);
    for (const b of buttons) {
      expect(b).toMatch(/<svg[^>]*class="lucide[^"]*"[^>]*aria-hidden="true"/);
      expect(b).toMatch(/<span class="phone-tool-label">[^<]+<\/span>/);
    }
  });
});
