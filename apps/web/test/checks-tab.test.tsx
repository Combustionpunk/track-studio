// Checks on the Advanced tab, "How to draw" on top of Quick's right-hand column (#113). Quick is for laying the track,
// Advanced for checking and fine-tuning; on Quick a blocked Submit still says why and offers a way to Advanced › Checks.
import type { RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../src/lib/hooks.js";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "../../../packages/engine/test/fixtures/extra", `${name}.rctrack.json`), "utf8")) as RcTrack;
const overlap = () => fixture("overlap-straights");
const clean = () => fixture("nested-corners");

vi.mock("../src/lib/hooks.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/hooks.js")>();
  return { ...real, useApi: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }) as Loadable<unknown> };
});
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));
// the bake, settled: the fixture's own checks (the worker doesn't run here)
let baked: RcTrack["built"] = undefined;
let pending = false;
vi.mock("../src/designer/useBake.js", () => ({ useBake: () => ({ built: baked ?? null, pending, error: null, ms: 0 }) }));
vi.mock("../src/components/PlanView.js", async (orig) => ({ ...(await orig<typeof import("../src/components/PlanView.js")>()), PlanView: () => null }));

const { Designer, draftFromDoc, newDraft } = await import("../src/designer/Designer.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
import type { DesignerBase } from "../src/designer/Designer.js";

const me = { id: 1, username: "yeti", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false };
const session = { me, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
/** an author's saved track they can submit */
const edit = (doc: RcTrack) => (
  (baked = doc.built),
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Designer mode="edit" initial={draftFromDoc(doc)} base={{ id: doc.id, revision: 1, doc, can: { submit: true } } as unknown as DesignerBase} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  ));
const laying = () =>
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Designer mode="new" initial={newDraft({ area: { length: 22, width: 12 }, name: "Blank" })} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
const setup = (mode: "quick" | "advanced") =>
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
/** the right-hand column */
const side = (html: string) => html.match(/<aside class="designer-side"[^>]*>(.*?)<\/aside>/s)?.[1] ?? "";
const bar = (html: string) => html.match(/<div class="designer-bar">(.*?)<div class="designer-(?:messages|grid)">/s)?.[1] ?? "";

afterEach(() => (vi.unstubAllGlobals(), (pending = false)));

describe("Quick: no Checks, How to draw on top", () => {
  it("shaping: How to draw is the first panel in the right-hand column and Checks isn't there", () => {
    setup("quick");
    const s = side(edit(clean()));
    expect(s).toMatch(/^<details class="sel-panel shortcuts"[^>]*><summary>How to draw<\/summary>/);
    expect(s).not.toContain('id="ck-h"');
    expect(s).not.toContain(">Checks");
  });
  it("Quick's How to draw is about Quick's gestures, not Advanced's", () => {
    setup("quick");
    const s = side(edit(clean()));
    expect(s).toContain("inside handle");
    expect(s).not.toContain("hairpin");
  });
  it("laying the lanes: How to draw comes first there too, and no Checks", () => {
    setup("quick");
    const s = side(laying());
    expect(s).toMatch(/^<details class="sel-panel shortcuts"[^>]*><summary>How to draw<\/summary>/);
    expect(s).not.toContain(">Checks");
    expect(s).toContain("Squares");
  });
});

describe("Advanced: Checks as before", () => {
  it("Checks leads the right-hand column with the live results and the lane-overlap message", () => {
    setup("advanced");
    const html = edit(overlap());
    const s = side(html);
    expect(s).toMatch(/^<section class="checks-panel" aria-labelledby="ck-h">/);
    expect(s).toContain("Lanes overlap by 0.60 m here");
    expect(s).toMatch(/<button type="button" class="check-show">Show<\/button>/);
    // the blocking reason is under the checks, and the bar has no second copy of it
    expect(s).toMatch(/<p id="submit-why" class="submit-why">Submit is waiting on 1 error\./);
    expect(bar(html)).not.toContain('id="submit-why"');
    // Advanced's own How to draw stays where it was, below the checks
    expect(s.indexOf("How to draw")).toBeGreaterThan(s.indexOf("ck-h"));
  });
});

describe("Submit is blocked by errors on either tab", () => {
  it.each(["quick", "advanced"] as const)("%s: Submit is disabled and says why", (mode) => {
    setup(mode);
    const b = bar(edit(overlap()));
    expect(b).toMatch(/<button type="button" class="btn btn-primary" disabled="" aria-describedby="submit-why" title="Submit is waiting on 1 error\.[^"]*">Submit track<\/button>/);
  });
  it("Quick: the reason shows by Submit, with a way to Advanced › Checks", () => {
    setup("quick");
    const b = bar(edit(overlap()));
    const why = b.match(/<p id="submit-why" class="submit-why-bar"[^>]*>(.*?)<\/p>/s)?.[1];
    expect(why).toContain("Submit is waiting on 1 error.");
    expect(why).toMatch(/<button type="button" class="linkish"[^>]*>See Checks<\/button>/);
  });
  it("Quick: a wait that isn't an error shows by Submit too, with nothing to see in Checks", () => {
    setup("quick");
    pending = true;
    const b = bar(edit(clean()));
    expect(b).toContain('aria-describedby="submit-why"');
    const why = b.match(/<p id="submit-why" class="submit-why-bar"[^>]*>(.*?)<\/p>/s)?.[1];
    expect(why).toBe("Checking the track…");
  });
  it("Quick: nothing by Submit when it isn't blocked", () => {
    setup("quick");
    const doc = clean();
    expect(doc.built!.checks.filter((c) => c.level === "error")).toEqual([]);
    expect(bar(edit(doc))).not.toContain('id="submit-why"');
  });
});
