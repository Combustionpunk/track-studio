// Quick mode step 1's hints (#96): the line on turns (45°, 90° and, since #104, 135°), on desktop (palette and floating hint) and on a tablet.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Designer, newDraft, TOUCH_QUERY, type Draft } from "../src/designer/Designer.js";
import { MODE_KEY } from "../src/designer/mode.js";
import { SessionContext } from "../src/lib/session.js";

// the designer guards leaving with useBlocker, which needs a data router; a static render doesn't
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));

const TURNS = "Turns are 45°, 90° or 135°. Step 2 shapes them and shows where lanes squeeze or overlap.";
const session = { me: null, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
const render = (initial: Draft) =>
  unescape(renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Designer mode="new" initial={initial} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  ));
const unescape = (html: string) => html.replace(/&#x27;/g, "'");
const hint = (html: string) => html.match(/<div class="designer-hint"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
const quick = () => vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode: "quick" }) : null), setItem: () => {}, removeItem: () => {} });

describe("step 1's hint on turns (#96)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const blank = () => newDraft({ area: { length: 22, width: 12 }, name: "t" });
  const started = (): Draft => ({ ...blank(), laying: [[0, 0], [1, 0]] });

  it.each([
    ["before the first square", blank],
    ["while laying", started],
  ])("is in the floating hint %s, and in the palette", (_, draft) => {
    quick();
    const html = render(draft());
    expect(hint(html)).toContain(TURNS);
    const palette = html.slice(html.indexOf('aria-label="Lay the lanes"'));
    expect(palette.slice(0, palette.indexOf("</aside>"))).toContain(TURNS);
  });

  it("is in the floating hint on a tablet, which has no palette", () => {
    quick();
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === TOUCH_QUERY }) });
    const html = render(started());
    expect(html).toContain("designer-touch");
    expect(hint(html)).toContain(TURNS);
  });
});
