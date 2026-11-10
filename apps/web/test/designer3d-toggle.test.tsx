// The designer's 2D / 3D switch (#85): in Quick and Advanced, on laptops and tablets, not on phones and not while the
// lanes are being laid. 3D is view only: the 2D plan (and its editing) is swapped for the 3D view.
import type { RcTrack, RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../src/lib/hooks.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const hall = ref<RcVenue>("venues/sports-hall-b.rcvenue.json");
const adapted = () => ref<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json");

vi.mock("../src/lib/hooks.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/hooks.js")>();
  return { ...real, useApi: (path: string | null) => ({ data: path === "/api/venues/venue-2" ? { doc: hall } : undefined, error: undefined, loading: false, reload: () => {} }) as Loadable<unknown> };
});
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));
let webgl = true;
vi.mock("../src/viewer3d/support.js", () => ({ hasWebGL: () => webgl }));
const plans: unknown[] = [];
vi.mock("../src/components/PlanView.js", async (orig) => ({
  ...(await orig<typeof import("../src/components/PlanView.js")>()),
  PlanView: (p: unknown) => (plans.push(p), null),
}));

const { Designer, draftFromDoc, newDraft, PHONE_QUERY, TOUCH_QUERY } = await import("../src/designer/Designer.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
type Draft = ReturnType<typeof draftFromDoc>;

const session = { me: null, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
const render = (initial: Draft) =>
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Designer mode="new" initial={initial} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
const setup = (mode: "quick" | "advanced", view: "2d" | "3d" = "2d", query?: string) => {
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => (k === "designer-view" ? view : null), setItem: () => {}, removeItem: () => {} });
  if (query) vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === query }) });
};
const toggle = (html: string) => html.match(/<div class="plan-viewswitch[^"]*" role="group" aria-label="View">(.*?)<\/div>/)?.[1];

beforeEach(() => ((plans.length = 0), (webgl = true)));
afterEach(() => vi.unstubAllGlobals());

describe("the designer's 2D / 3D switch", () => {
  it.each(["quick", "advanced"] as const)("%s, laptop: 2D and 3D, 2D on", (mode) => {
    setup(mode);
    const t = toggle(render(draftFromDoc(adapted())));
    expect(t).toContain(">2D</button>");
    expect(t).toContain(">3D</button>");
    expect(t).toMatch(/aria-pressed="true"[^>]*>2D</);
    expect(plans.length).toBeGreaterThan(0);
  });

  it.each(["quick", "advanced"] as const)("%s, tablet: there too", (mode) => {
    setup(mode, "2d", TOUCH_QUERY);
    expect(toggle(render(draftFromDoc(adapted())))).toContain(">3D</button>");
  });

  it("not on a phone, which only views the plan", () => {
    setup("quick", "3d", PHONE_QUERY);
    const html = render(draftFromDoc(adapted()));
    expect(html).toContain("designer-phone");
    expect(toggle(html)).toBeUndefined();
    expect(plans.length).toBe(1); // the 2D plan, even with 3D picked on a bigger screen
  });

  it("not while laying the lanes: there's nothing to show in 3D yet", () => {
    setup("quick", "3d");
    const html = render({ ...newDraft({ area: { length: 22, width: 12 }, name: "t" }), laying: [[0, 0], [1, 0]] });
    expect(toggle(html)).toBeUndefined();
    expect(plans.length).toBeGreaterThan(0);
  });

  it.each(["quick", "advanced"] as const)("%s, in 3D: the 2D plan makes way for the 3D view, and the hint says it's view only", (mode) => {
    setup(mode, "3d");
    const html = render(draftFromDoc(adapted()));
    expect(toggle(html)).toMatch(/aria-pressed="true"[^>]*>3D</);
    expect(plans).toHaveLength(0);
    expect(html).toContain("Loading the 3D view");
    expect(html).toMatch(/<div class="designer-hint"[^>]*>[^<]*3D is view only/);
  });

  it.each(["quick", "advanced"] as const)("%s, 3D picked without WebGL: the 2D plan stays, edits as usual, with a note", (mode) => {
    webgl = false;
    setup(mode, "3d");
    const html = render(draftFromDoc(adapted()));
    expect(toggle(html)).toMatch(/aria-pressed="true"[^>]*>3D</);
    expect(plans.length).toBeGreaterThan(0);
    expect(html).not.toContain("Loading the 3D view");
    expect(html).toContain("The 3D view needs WebGL");
    expect(html).not.toContain("3D is view only"); // the plan is the editable one, so its hint is the plan's
    expect(html).toMatch(/<div class="designer-hint"[^>]*>[^<]*(Drag a corner|Click a straight)/);
  });
});
