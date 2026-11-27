// rctrack 1.14 / rcvenue 1.3 (#197): grass, a surface SOAR races on. Only adds a word to `surface`; nothing re-bakes.
import { describe, expect, it } from "vitest";
import { adapt, buildSheet, fits, planScene, planSvg, previewSvg, validateTrack, validateVenue, venueCheck, VENUE_SURFACES, type RcTrack, type RcVenue } from "../src/index.js";
import { allTracks, allVenues, examples, extraVenues, readJson } from "./helpers.js";

const clubA = readJson<RcTrack>(examples.find((e) => e.name === "club-a.rctrack.json")!.path);
const field = readJson<RcVenue>(extraVenues.find((v) => v.name === "grass-field.rcvenue.json")!.path);
const grassTrack: RcTrack = { ...clubA, info: { ...clubA.info, surface: "grass" } };

describe("rctrack 1.14 / rcvenue 1.3: grass", () => {
  it("is a venue surface, and the schemas accept it on a template and a layout", () => {
    expect(VENUE_SURFACES).toContain("grass");
    expect(validateVenue({ ...field, surface: "grass" }).valid).toBe(true);
    expect(validateTrack(grassTrack).valid).toBe(true);
  });

  it("the fixture is a SOAR-style grass field linked to a forum track", () => {
    expect(field.surface).toBe("grass");
    expect(field.info.venue?.trackId).toBeTypeOf("number");
  });

  it("still refuses a word the format doesn't have", () => {
    expect(validateVenue({ ...field, surface: "sand" } as unknown as RcVenue).valid).toBe(false);
    expect(validateTrack({ ...clubA, info: { ...clubA.info, surface: "sand" } } as unknown as RcTrack).valid).toBe(false);
  });

  it("older documents (rcvenue 1.2 and before, rctrack 1.13 and before) still load", () => {
    for (const v of allVenues) expect(validateVenue(readJson(v.path)).valid, v.name).toBe(true);
    for (const t of allTracks) expect(validateTrack(readJson(t.path)).valid, t.name).toBe(true);
  });

  it("an adapted copy takes the field's grass", () => {
    const [fit] = fits(clubA, field);
    expect(fit).toBeDefined();
    expect(adapt(clubA, field, fit, { id: "x" }).info.surface).toBe("grass");
  });

  it("readers that don't know grass never look at it: preview, plan, build sheet, fit and venue checks come out the same", () => {
    // what an older reader does with a 1.14 file: it draws `built` and ignores the surface it can't name
    expect(previewSvg(grassTrack)).toBe(previewSvg(clubA));
    expect(planSvg(planScene(grassTrack), { width: 800 })).toBe(planSvg(planScene(clubA), { width: 800 }));
    expect(buildSheet(grassTrack)).toEqual(buildSheet(clubA));
    const { surface: _s, ...noSurface } = field;
    expect(fits(clubA, field)).toEqual(fits(clubA, noSurface));
    expect(venueCheck(clubA, field)).toEqual(venueCheck(clubA, noSurface));
  });
});
