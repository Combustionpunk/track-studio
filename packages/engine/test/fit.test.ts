// The fit search must reproduce reference/fit.py (fixture: scripts/gen_fit_fixtures.py -> test/fixtures/fit-expected.json).
import { describe, expect, it } from "vitest";
import { adapt, fits, validateTrack, venueCheck, type FitResult, type RcTrack, type RcVenue, type VenueCheck } from "../src/index.js";
import { allTracks, allVenues, examples, readJson, venues } from "./helpers.js";
import expected from "./fixtures/fit-expected.json";

const cases = allTracks.flatMap((t) => allVenues.map((v) => ({ key: `${t.name} | ${v.name}`, track: t.path, venue: v.path })));

describe("fit", () => {
  it("fixture covers every example x venue", () => {
    expect(Object.keys(expected).sort()).toEqual(cases.map((c) => c.key).sort());
  });

  it.each(cases)("$key", ({ key, track, venue }) => {
    const want = (expected as unknown as Record<string, { fits: FitResult[]; check: VenueCheck }>)[key];
    const t = readJson<RcTrack>(track), v = readJson<RcVenue>(venue);
    const got = fits(t, v);
    expect(got.map((r) => r.orientation)).toEqual(want.fits.map((r) => r.orientation));
    // stronger than required: same positions and spare space too
    expect(got).toEqual(want.fits);
    // the venue checks of the layout where it is drawn: same codes, positions within a cell, same rostrum
    const check = venueCheck(t, v);
    expect(check.checks.map((c) => c.code)).toEqual(want.check.checks.map((c) => c.code));
    check.checks.forEach((c, i) => expect(Math.hypot(c.x! - want.check.checks[i].x!, c.z! - want.check.checks[i].z!)).toBeLessThanOrEqual(0.1 + 1e-9));
    expect(check.rostrum).toEqual(want.check.rostrum);
  });
});

describe("adapt", () => {
  const track = readJson<RcTrack>(examples.find((e) => e.name === "freeform-example.rctrack.json")!.path);
  const venue = readJson<RcVenue>(venues.find((v) => v.name === "sports-hall-b.rcvenue.json")!.path);
  const stored = readJson<RcTrack>(examples.find((e) => e.name === "freeform-at-sports-hall-b.rctrack.json")!.path);

  it("reproduces the stored adapted example", () => {
    const [fit] = fits(track, venue);
    const out = adapt(track, venue, fit, { id: stored.id });
    expect(out.design).toEqual(stored.design);
    expect(out.area).toEqual(venue.area);
    expect(out.area).toEqual(stored.area);
    expect(out.info).toEqual(stored.info);
    expect(out.info.drawnFor).toEqual({ venueTemplate: venue.id, name: venue.info.name });
    expect(out.built!.checks).toEqual([]);
    expect(venueCheck(out, venue).checks).toEqual([]);
    expect({ ...out.built!, generator: "" }).toEqual({ ...stored.built!, generator: "" });
    expect(validateTrack(out).valid).toBe(true);
  });

  it("copies none of the venue's obstacles or rostrum into the layout (1.7)", () => {
    const out = adapt(track, venue, fits(track, venue)[0]) as RcTrack & Record<string, unknown>;
    expect(out.obstacles).toBeUndefined();
    expect(out.basedOn).toBeUndefined();
    expect(out.design).not.toHaveProperty("rostrum");
    expect(out.built).not.toHaveProperty("rostrum");
    expect(JSON.stringify(out)).not.toMatch(/Pillar|Fire exit/);
  });

  it("gives the copy a new id and leaves the original alone", () => {
    const before = JSON.stringify(track);
    const out = adapt(track, venue, fits(track, venue)[0]);
    expect(out.id).not.toBe(track.id);
    expect(out.revision).toBe(1);
    expect(JSON.stringify(track)).toBe(before);
  });
});
