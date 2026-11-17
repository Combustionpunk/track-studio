// The 3D preview on a phone (#127): a seventh toolbar button, 3D, that reads 2D while the preview shows; the editing
// tools wait while it does. Behind a switch (`?phone3d=1`, kept on the device) until the Board has measured it on real
// phones. Static renders with the plan, the bake and WebGL mocked, as in designer3d-toggle.test.tsx.
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
let webgl = true;
vi.mock("../src/viewer3d/support.js", () => ({ hasWebGL: () => webgl }));
const plans: unknown[] = [];
vi.mock("../src/components/PlanView.js", async (orig) => ({
  ...(await orig<typeof import("../src/components/PlanView.js")>()),
  PlanView: (p: { className?: string }) => (plans.push(p), <svg className={`plan-svg ${p.className ?? ""}`} />),
}));

const { Designer, draftFromDoc, PHONE_QUERY, TOUCH_QUERY } = await import("../src/designer/Designer.js");
const { BottomToolbar } = await import("../src/designer/PhoneEditLayout.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
const { PHONE_3D_KEY, phone3dSwitch, lastRun, figures3d } = await import("../src/lib/phone3d.js");
import type { DesignerBase } from "../src/designer/Designer.js";

const me = { id: 1, username: "yeti", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false };
const session = { me, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
const track = { status: "draft", approvedRevision: null } as unknown as DesignerBase["track"];
const edit = (search = "") => {
  const doc = saved();
  baked = doc.built;
  return renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={[`/t/club-a/edit${search}`]}>
        <Designer mode="edit" initial={draftFromDoc(doc)} base={{ id: "club-a", revision: 1, doc, track, can: { submit: true } } as unknown as DesignerBase} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
};
/** the storage the switch is kept in, and the view picked this session */
let stored: Record<string, string> = {};
const setup = (view: "2d" | "3d", queries: string[] = [PHONE_QUERY, TOUCH_QUERY], mode: "quick" | "advanced" = "quick") => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : stored[k] ?? null),
    setItem: (k: string, v: string) => void (stored[k] = v),
    removeItem: (k: string) => void delete stored[k],
  });
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => (k === "designer-view" ? view : null), setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: queries.includes(q) }), location: { href: "http://localhost/t/club-a/edit" } });
};

beforeEach(() => ((plans.length = 0), (webgl = true), (stored = {})));
afterEach(() => (vi.unstubAllGlobals(), (baked = undefined)));

/** the toolbar's button with this label */
const tool = (html: string, label: string) => new RegExp(`<button[^>]*>(?:(?!</button>).)*<span[^>]*>${label}</span></button>`).exec(html)?.[0] ?? "";
const buttons = (html: string) => /<nav class="phone-toolbar[^"]*"[^>]*>(.*?)<\/nav>/.exec(html)?.[1].match(/<button[^>]*>.*?<\/button>/g) ?? [];
const EDITING = ["Select", "Add point", "Jump", "Delete"];

describe("the switch (until the Board has the real-phone figures)", () => {
  const store = () => {
    const s: Record<string, string> = {};
    return { s, storage: { getItem: (k: string) => s[k] ?? null, setItem: (k: string, v: string) => void (s[k] = v), removeItem: (k: string) => void delete s[k] } };
  };
  it("off unless asked for", () => expect(phone3dSwitch(null, store().storage)).toBe(false));
  it("?phone3d=1 turns it on, and it stays on for this device", () => {
    const { s, storage } = store();
    expect(phone3dSwitch("1", storage)).toBe(true);
    expect(s[PHONE_3D_KEY]).toBe("1");
    expect(phone3dSwitch(null, storage)).toBe(true);
  });
  it("?phone3d=0 turns it off again", () => {
    const { s, storage } = store();
    phone3dSwitch("1", storage);
    expect(phone3dSwitch("0", storage)).toBe(false);
    expect(s[PHONE_3D_KEY]).toBeUndefined();
    expect(phone3dSwitch(null, storage)).toBe(false);
  });
  it("no storage (private mode): the address alone", () => {
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    expect(phone3dSwitch("1", broken)).toBe(true);
    expect(phone3dSwitch(null, broken)).toBe(false);
    expect(phone3dSwitch(null, undefined)).toBe(false);
  });
});

describe("the figures for the Board", () => {
  it("the last run of frames: frames a second and the slowest frame", () => {
    // a still view, then an orbit of 30 frames at 16 ms with one 40 ms frame
    const t = [0, 5000];
    for (let i = 1; i <= 30; i++) t.push(t[t.length - 1] + (i === 10 ? 40 : 16));
    const run = lastRun(t)!;
    expect(run.frames).toBe(31);
    expect(run.worstMs).toBe(40);
    expect(run.fps).toBeCloseTo(30 / ((29 * 16 + 40) / 1000), 5);
  });
  it("too few frames for an orbit: nothing yet", () => expect(lastRun([0, 16, 32])).toBeNull());
  it("in words", () => {
    expect(figures3d(812.4, null)).toBe("First frame 812 ms");
    expect(figures3d(812.4, { frames: 60, fps: 58.6, worstMs: 33.3 })).toBe("First frame 812 ms · Orbit 59 fps, slowest frame 33 ms");
    expect(figures3d(null, null)).toBe("");
  });
});

describe("the toolbar's 3D button", () => {
  const props = { tool: "select" as const, onSelect: () => {}, onAdd: () => {}, canDelete: true, onDelete: () => {}, undo: () => {}, redo: () => {}, canUndo: true, canRedo: true, onJump: () => {} };

  it("2D: a seventh button, 3D, after Redo, with the Lucide box", () => {
    const html = renderToStaticMarkup(<BottomToolbar {...props} view3d={{ label: "3D", onToggle: () => {} }} viewOnly={false} />);
    const b = buttons(html);
    expect(b.map((x) => /<span class="phone-tool-label">([^<]+)</.exec(x)?.[1])).toEqual(["Select", "Add point", "Jump", "Delete", "Undo", "Redo", "3D"]);
    expect(b[6]).toContain("lucide-box");
    expect(b[6]).not.toContain("disabled");
    for (const l of EDITING) expect(tool(html, l), l).not.toContain("disabled");
    expect(html).toContain("phone-toolbar-7");
  });

  it("3D showing: it reads 2D, and the editing tools wait (undo and redo still work, as on a laptop)", () => {
    const html = renderToStaticMarkup(<BottomToolbar {...props} tool="add" view3d={{ label: "2D", onToggle: () => {} }} viewOnly />);
    const b = buttons(html);
    expect(b).toHaveLength(7);
    expect(b[6]).toMatch(/<span class="phone-tool-label">2D<\/span>/);
    expect(b[6]).not.toContain("disabled");
    for (const l of EDITING) expect(tool(html, l), l).toContain("disabled");
    expect(tool(html, "Undo")).not.toContain("disabled");
    expect(tool(html, "Redo")).not.toContain("disabled");
    // a disabled tool isn't shown as the one that's on
    expect(tool(html, "Add point")).not.toContain('aria-pressed="true"');
  });

  it("no switch: six buttons, as before", () => {
    const html = renderToStaticMarkup(<BottomToolbar {...props} />);
    expect(buttons(html)).toHaveLength(6);
    expect(html).not.toContain("phone-toolbar-7");
  });
});

describe("the designer on a phone", () => {
  it.each(["quick", "advanced"] as const)("%s, switch off: no 3D button, and the 2D plan even with 3D picked on a bigger screen", (mode) => {
    setup("3d", undefined, mode);
    const html = edit();
    expect(buttons(html)).toHaveLength(6);
    expect(tool(html, "3D")).toBe("");
    expect(plans).toHaveLength(1);
    expect(html).not.toContain("Loading the 3D view");
  });

  it.each(["quick", "advanced"] as const)("%s, switch on, 2D: the 3D button, the plan, the tools", (mode) => {
    setup("2d", undefined, mode);
    const html = edit("?phone3d=1");
    expect(buttons(html)).toHaveLength(7);
    expect(tool(html, "3D")).not.toBe("");
    expect(plans).toHaveLength(1);
    for (const l of ["Select", "Add point", "Jump"]) expect(tool(html, l), l).not.toContain("disabled");
    expect(html).not.toContain("designer-viewswitch"); // the toolbar's button, not the laptop's switch
  });

  it("switch kept on the device: on without the address", () => {
    stored[PHONE_3D_KEY] = "1";
    setup("2d");
    expect(tool(edit(), "3D")).not.toBe("");
  });

  it.each(["quick", "advanced"] as const)("%s, 3D showing: the 3D view in place of the plan, the button reads 2D, editing waits", (mode) => {
    setup("3d", undefined, mode);
    const html = edit("?phone3d=1");
    expect(plans).toHaveLength(0);
    expect(html).toContain("Loading the 3D view");
    expect(tool(html, "2D")).not.toBe("");
    for (const l of EDITING) expect(tool(html, l), l).toContain("disabled");
    expect(html).toMatch(/<div class="designer-hint"[^>]*>3D is view only: switch to 2D to edit\./);
    // the checks pill stays
    expect(html).toContain("checks-pill");
  });

  it("3D picked without WebGL: the 2D plan, which edits, and the plain message; the button puts the message away", () => {
    webgl = false;
    setup("3d");
    const html = edit("?phone3d=1");
    expect(plans).toHaveLength(1);
    expect(html).toContain("The 3D view needs WebGL, which this browser doesn&#x27;t have or has turned off. Here&#x27;s the 2D plan.");
    for (const l of ["Select", "Add point", "Jump"]) expect(tool(html, l), l).not.toContain("disabled");
    expect(tool(html, "2D")).not.toBe("");
  });

  it("a laptop and a tablet: the 2D / 3D switch as before, whatever the phone switch", () => {
    for (const q of [[], [TOUCH_QUERY]]) {
      setup("2d", q);
      const html = edit("?phone3d=1");
      expect(html).toContain('class="plan-viewswitch designer-viewswitch"');
      expect(html).not.toContain("phone-toolbar");
    }
  });
});
