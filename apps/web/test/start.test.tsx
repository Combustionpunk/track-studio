// New designs (#14): "From a venue" or "Start blank", and both open in step 1 (#38).
import { bakeBuilt, type RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { toDoc } from "../src/designer/Designer.js";
import { designStep, gridFor, paintTo, withLaying, type Cell, type Laying } from "../src/designer/lanes.js";
import { BLANK_MAX, BLANK_MIN, blankArea, blankDraft, blankHref, blankProblems, venueDraft } from "../src/designer/start.js";

vi.mock("../src/lib/hooks.js", async (orig) => ({ ...(await orig<typeof import("../src/lib/hooks.js")>()), useApi: () => ({ data: { venues: [] }, loading: false, reload: () => {} }) }));
const { NewTrackPage, BlankStartForm } = await import("../src/designer/pages.js");

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const VENUES = ["club-hall", "small-hall", "sports-hall-b"].map((n) => ref<RcVenue>(`venues/${n}.rcvenue.json`));
const html = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

/** paint the ring round the edge of the grid and close it */
function closeEdgeLoop(d: ReturnType<typeof blankDraft>) {
  const g = gridFor(d);
  let lay: Laying = { cells: [], closed: false };
  const corners: Cell[] = [[0, 0], [g.cols - 1, 0], [g.cols - 1, g.rows - 1], [0, g.rows - 1], [0, 0]];
  for (const c of corners) {
    const r = paintTo(g, lay, c);
    expect(r.refused).toBeUndefined();
    lay = r.states[r.states.length - 1] ?? lay;
  }
  expect(lay.closed).toBe(true);
  return withLaying(d, lay);
}

describe("blank area: validation in plain words", () => {
  it(`accepts ${BLANK_MIN}–${BLANK_MAX} m each way, decimals too`, () => {
    expect(BLANK_MIN).toBe(6);
    expect(BLANK_MAX).toBe(60);
    for (const [length, width] of [["6", "6"], ["60", "60"], ["22", "12"], ["24.5", " 13.5 "]]) expect(blankProblems({ length, width })).toEqual({});
  });

  it("says what to change for each field", () => {
    expect(blankProblems({ length: "", width: "12" })).toEqual({ length: "Enter the length in metres." });
    expect(blankProblems({ length: "22", width: "abc" })).toEqual({ width: "Enter the width in metres." });
    expect(blankProblems({ length: "5.9", width: "12" })).toEqual({ length: "Length must be at least 6 m." });
    expect(blankProblems({ length: "22", width: "61" })).toEqual({ width: "Width can be at most 60 m." });
    expect(blankProblems({ length: "-3", width: "Infinity" })).toEqual({ length: "Length must be at least 6 m.", width: "Enter the width in metres." });
  });

  it("the designer link carries the area and an optional name", () => {
    expect(blankHref({ name: "", length: 22, width: 12 })).toBe("/new/design?length=22&width=12");
    expect(blankHref({ name: " Winter & co ", length: 24.5, width: 13 })).toBe("/new/design?length=24.5&width=13&name=Winter+%26+co");
  });

  it("the designer page reads the area from the link, kept to the same limits", () => {
    const area = (q: string) => blankArea(new URLSearchParams(q));
    expect(area("length=24.5&width=13")).toEqual({ length: 24.5, width: 13 });
    expect(area("length=200&width=2")).toEqual({ length: 60, width: 6 });
    expect(area("")).toEqual({ length: 22, width: 12 });
    expect(area("length=abc&width=-")).toEqual({ length: 22, width: 12 });
  });
});

describe("Start blank", () => {
  it("has the area entered, no venue, no obstacles, and opens in step 1", () => {
    const d = blankDraft({ length: 24, width: 14 }, "My blank");
    expect(d.area).toEqual({ length: 24, width: 14 });
    expect(d.basedOn).toBeNull();
    expect(d.obstacles).toEqual([]);
    expect(d.info.name).toBe("My blank");
    expect(designStep(d)).toBe(1);
    expect(blankDraft({ length: 24, width: 14 }).info.name).toBe("New track");
  });

  it.each([
    [6, 6],
    [22, 12],
    [24.5, 13.5],
    [60, 60],
  ])("the lane grid fits a %s × %s m area (#38's rules)", (length, width) => {
    const g = gridFor(blankDraft({ length, width }));
    expect(g.size).toBe(2);
    expect(g.origin).toEqual([-length / 2, -width / 2]);
    expect(g.cols).toBe(Math.floor(length / 2));
    expect(g.rows).toBe(Math.floor(width / 2));
    expect(g.blocked.size).toBe(0);
  });

  it("saves with area set, basedOn null and no obstacles, and bakes clean", () => {
    const doc = toDoc(closeEdgeLoop(blankDraft({ length: 22, width: 12 }, "Blank")));
    expect(doc.area).toEqual({ length: 22, width: 12 });
    expect(doc.basedOn).toBeNull();
    expect(doc.obstacles).toEqual([]);
    expect(doc.design.points.length).toBe(4);
    expect(bakeBuilt(doc).checks.filter((c) => c.severity === "error")).toEqual([]);
  });
});

describe("From a venue", () => {
  it.each(VENUES.map((v) => [v.info.name, v] as const))("%s: area, obstacles, rostrum and basedOn from the venue, then step 1", (_, v) => {
    const d = venueDraft(v);
    expect(d.area).toEqual(v.area);
    expect(d.obstacles).toEqual(v.obstacles ?? []);
    expect(d.design.rostrum).toEqual({ side: "south", ...v.rostrum });
    expect(d.basedOn).toEqual({ venueTemplate: v.id, revision: v.revision });
    expect(d.info.name).toBe(`New track at ${v.info.name}`);
    expect(venueDraft(v, "Mine").info.name).toBe("Mine");
    expect(designStep(d)).toBe(1);
    expect(gridFor(d).origin).toEqual([-v.area.length / 2, -v.area.width / 2]);
  });
});

describe("new track page", () => {
  it("offers From a venue and Start blank; blank asks for length and width in metres", () => {
    const h = html(<NewTrackPage />);
    expect(h).toMatch(/<h2[^>]*>From a venue<\/h2>/);
    expect(h).toMatch(/<h2[^>]*>Start blank<\/h2>/);
    expect(h).toMatch(/Length[\s\S]*east–west/);
    expect(h).toMatch(/Width[\s\S]*north–south/);
    expect(h.match(/class="ts-unit">m</g)).toHaveLength(2);
    expect(h).toContain(`${BLANK_MIN}–${BLANK_MAX} m each way`);
    expect(h).not.toContain("ts-help--error");
  });

  it("shows each problem under its field once tried", () => {
    const h = html(<BlankStartForm initial={{ name: "", length: "4", width: "", tried: true }} />);
    expect(h).toContain("Length must be at least 6 m.");
    expect(h).toContain("Enter the width in metres.");
    expect(h.match(/ts-input--invalid/g)).toHaveLength(2);
    expect(h.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(h.match(/class="ts-help ts-help--error"/g)).toHaveLength(2);
  });
});
