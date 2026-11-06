// Layouts stand alone (#63, rctrack 1.7): a venue template is a guide while drawing (shown, never saved), the rostrum
// control is gone, and "Check against a venue" runs the fit check on the design as it stands.
import type { RcTrack, RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../src/lib/hooks.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const sportsHall = ref<RcVenue>("venues/sports-hall-b.rcvenue.json");
const adapted = () => ref<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json");

// useApi answers per path; the venue template is the guide
const answers = new Map<string, Partial<Loadable<unknown>>>();
vi.mock("../src/lib/hooks.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/hooks.js")>();
  return { ...real, useApi: (path: string | null) => ({ data: undefined, error: undefined, loading: path !== null, reload: () => {}, ...(path ? answers.get(path) : {}) }) };
});
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));
// the plan draws once it has measured itself (not in a static render): record what it's given instead
const plans: { area?: unknown; obstacles?: { label?: string }[]; rostrum?: unknown }[] = [];
vi.mock("../src/components/PlanView.js", async (orig) => ({
  ...(await orig<typeof import("../src/components/PlanView.js")>()),
  PlanView: (p: { area?: unknown; obstacles?: { label?: string }[]; rostrum?: unknown }) => (plans.push(p), null),
}));

const { Designer, draftFromDoc, toDoc, SelectionPanel } = await import("../src/designer/Designer.js");
const { venueDraft } = await import("../src/designer/start.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { checkAgainstVenue, fitSummary } = await import("../src/designer/VenueCheck.js");
const { liveGeometry } = await import("../src/designer/geometry.js");
const { SessionContext } = await import("../src/lib/session.js");

const session = { me: null, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
const render = (initial: ReturnType<typeof draftFromDoc>) =>
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Designer mode="new" initial={initial} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
const inMode = (mode: "quick" | "advanced") => vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });

beforeEach(() => {
  plans.length = 0;
  answers.clear();
  answers.set("/api/venues/venue-2", { data: { doc: sportsHall }, loading: false });
  answers.set("/api/venues", { data: { venues: [{ id: "venue-2", name: "Sports hall B" }, { id: "venue-1", name: "Club hall" }] }, loading: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("the venue guide", () => {
  it.each(["quick", "advanced"] as const)("%s: a draft drawn for a venue shows its obstacles on the plan", (mode) => {
    inMode(mode);
    render(draftFromDoc(adapted()));
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.obstacles).toEqual(sportsHall.obstacles);
      expect(p.rostrum).toBeUndefined();
    }
  });

  it("is shown but never saved: the saved JSON has no obstacles, rostrum or basedOn", () => {
    const draft = draftFromDoc(adapted());
    const doc = toDoc(draft);
    expect(Object.keys(doc).sort()).toEqual(["area", "design", "format", "id", "info", "revision", "version"]);
    expect(doc.design).not.toHaveProperty("rostrum");
    expect(doc.info.drawnFor).toEqual({ venueTemplate: "venue-2", name: "Sports hall B" });
    expect(JSON.stringify(doc)).not.toMatch(/Pillar|Fire exit|obstacle|rostrum|basedOn/);
    // a new draft from the venue, too
    const fresh = toDoc(venueDraft(sportsHall));
    expect(fresh.area).toEqual(sportsHall.area);
    expect(JSON.stringify(fresh)).not.toMatch(/Pillar|obstacle|rostrum|basedOn/);
  });

  it("reopening a 1.6 draft drops its rostrum, and the guide comes from the live template", () => {
    const old = { ...adapted(), design: { ...adapted().design, rostrum: { side: "south", offset: 3 } } } as RcTrack;
    const draft = draftFromDoc(old);
    expect(draft.design).not.toHaveProperty("rostrum");
    // the template has since lost its pillars: the guide follows it
    answers.set("/api/venues/venue-2", { data: { doc: { ...sportsHall, obstacles: [] } }, loading: false });
    inMode("quick");
    render(draft);
    expect(plans.every((p) => p.obstacles?.length === 0)).toBe(true);
  });

  it("the guide's area is live too: a template made bigger since is the area drawn on", () => {
    answers.set("/api/venues/venue-2", { data: { doc: { ...sportsHall, area: { length: 30, width: 16 } } }, loading: false });
    inMode("advanced");
    const html = render(draftFromDoc(adapted()));
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(p.area).toEqual({ length: 30, width: 16 });
    expect(html).toContain("30 × 16 m");
  });

  it("no guide when the template is gone, and none for a blank draft", () => {
    answers.set("/api/venues/venue-2", { error: new Error("Venue not found"), loading: false });
    inMode("advanced");
    render(draftFromDoc(adapted()));
    const { info: _i, ...rest } = adapted();
    render(draftFromDoc({ ...rest, info: { name: "Blank" } }));
    expect(plans.length).toBeGreaterThan(1);
    expect(plans.every((p) => p.obstacles?.length === 0)).toBe(true);
  });
});

describe("the rostrum control is gone", () => {
  const panel = (draft: ReturnType<typeof draftFromDoc>, fromVenue?: string) =>
    renderToStaticMarkup(
      <SelectionPanel sel={null} view="advanced" draft={draft} live={liveGeometry(draft.design)} update={() => {}} onDelete={() => {}} fromVenue={fromVenue} inCorner={new Map()} />,
    );

  it("from a blank area: lane width and area, no rostrum", () => {
    const { info: _i, ...rest } = adapted();
    const html = panel(draftFromDoc({ ...rest, info: { name: "Blank" } }));
    expect(html).toContain("Area east–west");
    expect(html).not.toMatch(/rostrum/i);
  });

  it("drawn for a venue: the guide is explained, no rostrum", () => {
    const html = panel(draftFromDoc(adapted()), "Sports hall B");
    expect(html).toContain("aren&#x27;t saved with the track");
    expect(html).not.toMatch(/rostrum/i);
  });

  it.each(["quick", "advanced"] as const)("%s: nothing in the designer offers a rostrum", (mode) => {
    inMode(mode);
    expect(render(draftFromDoc(adapted()))).not.toMatch(/Rostrum side|Rostrum offset/);
  });
});

describe("Check against a venue", () => {
  it("is in the designer's side panel, with the venue the draft was drawn for picked", () => {
    inMode("quick");
    const html = render(draftFromDoc(adapted()));
    expect(html).toContain("Check against a venue");
    expect(html).toMatch(/<option value="venue-2" selected="">Sports hall B<\/option>/);
  });

  it("the adapted example fits Sports hall B where it's drawn, clear of the pillars", () => {
    const r = checkAgainstVenue(adapted().design, sportsHall);
    expect(r.fits).toContain("as designed");
    expect(r.asDrawn.checks).toEqual([]);
    expect(r.asDrawn.rostrum).toMatchObject({ side: "south", x: 3, z: -8.5 });
    expect(fitSummary(r)).toBe("Fits Sports hall B where it's drawn.");
  });

  it("reports the obstacles it hits where it's drawn, and the orientations that fit", () => {
    // the original example, not turned: where it's drawn it runs over a pillar of Sports hall B
    const r = checkAgainstVenue(ref<RcTrack>("examples/freeform-example.rctrack.json").design, sportsHall);
    expect(r.asDrawn.checks.map((c) => c.code)).toContain("obstacle");
    expect(r.fits).toEqual(["rotated 180"]);
    expect(fitSummary(r)).toBe("Fits Sports hall B once moved: rotated 180.");
  });

  it("says when nothing fits", () => {
    const tiny: RcVenue = { ...sportsHall, area: { length: 8, width: 6 }, obstacles: [] };
    const r = checkAgainstVenue(adapted().design, tiny);
    expect(r.fits).toEqual([]);
    expect(fitSummary(r)).toBe("Doesn't fit Sports hall B in any orientation.");
    expect(r.asDrawn.checks.map((c) => c.code)).toEqual(["outside-area"]);
  });
});
