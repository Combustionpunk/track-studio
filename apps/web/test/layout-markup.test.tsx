// Evidence for #120 (the layout shell refactor), removed with the PR's screenshots before it merges: the designer's
// static markup, and its plan overlay, in every layout and mode, compared byte for byte with the files taken before the
// refactor (docs/screenshots/120-layout-shell/markup/). MARKUP_WRITE=1 writes them; without it they're compared.
import type { RcTrack } from "@track-studio/engine";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../src/lib/hooks.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const saved = () => ref<RcTrack>("examples/club-a.rctrack.json");
const DIR = join(__dirname, "../../../docs/screenshots/120-layout-shell/markup");
const WRITE = !!process.env.MARKUP_WRITE;

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
  PlanView: (p: Record<string, unknown>) => (plans.push(p), <svg className={`plan-svg ${p.className ?? ""}`} aria-label={p.label as string} />),
}));

const { Designer, draftFromDoc, newDraft, PHONE_QUERY, TOUCH_QUERY } = await import("../src/designer/Designer.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
import type { DesignerBase } from "../src/designer/Designer.js";

const me = { id: 1, username: "yeti", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false };
const sessionOf = (who: typeof me | null) => ({ me: who, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" });
const track = { status: "draft", approvedRevision: null } as unknown as DesignerBase["track"];
const wrap = (who: typeof me | null, node: ReactNode) =>
  renderToStaticMarkup(
    <SessionContext.Provider value={sessionOf(who)}>
      <MemoryRouter>{node}</MemoryRouter>
    </SessionContext.Provider>,
  );
type Screen = "desktop" | "tablet" | "phone";
const setup = (mode: "quick" | "advanced", screen: Screen, view3d = "2d") => {
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => (k === "designer-view" ? view3d : null), setItem: () => {}, removeItem: () => {} });
  const query = screen === "phone" ? PHONE_QUERY : screen === "tablet" ? TOUCH_QUERY : null;
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === query }), location: { href: "http://localhost/t/club-a/edit" } });
};
const edit = (who = me as typeof me | null) => {
  const doc = saved();
  baked = doc.built;
  return wrap(who, <Designer mode="edit" initial={draftFromDoc(doc)} base={{ id: "club-a", revision: 1, doc, track, can: { submit: true } } as unknown as DesignerBase} storageKey="test" />);
};
/** a new track that's been shaped but never saved: dirty */
const unsaved = () => {
  const doc = saved();
  baked = doc.built;
  return wrap(me, <Designer mode="new" initial={draftFromDoc(doc)} storageKey="test" />);
};
const laying = () => wrap(me, <Designer mode="new" initial={newDraft({ area: { length: 22, width: 12 }, name: "Blank" })} storageKey="test" />);

const check = (name: string, got: string) => {
  const file = join(DIR, name);
  if (WRITE) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, got);
    return;
  }
  expect(existsSync(file), `${name}: run with MARKUP_WRITE=1 first`).toBe(true);
  expect(got, name).toBe(readFileSync(file, "utf8"));
};
/** the overlay the plan was given, drawn at 5 cm per pixel */
const overlay = () => {
  const fn = plans[0]?.overlay as ((m: number) => ReactNode) | undefined;
  return fn ? renderToStaticMarkup(<svg>{fn(0.05)}</svg>) : "(no overlay)";
};

beforeEach(() => (plans.length = 0));
afterEach(() => (vi.unstubAllGlobals(), (baked = undefined)));

describe("the designer's markup, every layout and mode", () => {
  const screens: Screen[] = ["desktop", "tablet", "phone"];
  const modes = ["quick", "advanced"] as const;
  for (const screen of screens)
    for (const mode of modes) {
      it(`${screen} ${mode}: a saved track`, () => {
        setup(mode, screen);
        check(`${screen}-${mode}-edit.html`, edit());
        check(`${screen}-${mode}-edit.overlay.svg`, overlay());
      });
      it(`${screen} ${mode}: laying the lanes`, () => {
        setup(mode, screen);
        check(`${screen}-${mode}-laying.html`, laying());
        check(`${screen}-${mode}-laying.overlay.svg`, overlay());
      });
      it(`${screen} ${mode}: an unsaved new track`, () => {
        setup(mode, screen);
        check(`${screen}-${mode}-unsaved.html`, unsaved());
      });
    }
  it("desktop quick, not logged in", () => {
    setup("quick", "desktop");
    check("desktop-quick-anonymous.html", edit(null));
  });
  it("desktop advanced, 3D picked", () => {
    setup("advanced", "desktop", "3d");
    check("desktop-advanced-3d.html", edit());
  });
  it("tablet quick, 3D picked", () => {
    setup("quick", "tablet", "3d");
    check("tablet-quick-3d.html", edit());
  });
});
