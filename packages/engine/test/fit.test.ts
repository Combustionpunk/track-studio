// The fit search must reproduce reference/fit.py (fixture: scripts/gen_fit_fixtures.py -> test/fixtures/fit-expected.json).
import { describe, expect, it } from "vitest";
import { adapt, fits, validateTrack, type FitResult, type RcTrack, type RcVenue } from "../src/index.js";
import { allTracks, allVenues, examples, readJson, venues } from "./helpers.js";
import expected from "./fixtures/fit-expected.json";

const cases = allTracks.flatMap((t) => allVenues.map((v) => ({ key: `${t.name} | ${v.name}`, track: t.path, venue: v.path })));

describe("fit", () => {
  it("fixture covers every example x venue", () => {
    expect(Object.keys(expected).sort()).toEqual(cases.map((c) => c.key).sort());
  });

  it.each(cases)("$key", ({ key, track, venue }) => {
    const want = (expected as unknown as Record<string, FitResult[]>)[key];
    const got = fits(readJson<RcTrack>(track), readJson<RcVenue>(venue));
    expect(got.map((r) => r.orientation)).toEqual(want.map((r) => r.orientation));
    // stronger than required: same positions and spare space too
    expect(got).toEqual(want);
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
    expect(out.area).toEqual(stored.area);
    expect(out.obstacles).toEqual(stored.obstacles);
    expect(out.basedOn).toEqual(stored.basedOn);
    expect(out.info).toEqual(stored.info);
    expect(out.built!.checks).toEqual([]);
    expect({ ...out.built!, generator: "" }).toEqual({ ...stored.built!, generator: "" });
    expect(validateTrack(out).valid).toBe(true);
  });

  it("gives the copy a new id and leaves the original alone", () => {
    const before = JSON.stringify(track);
    const out = adapt(track, venue, fits(track, venue)[0]);
    expect(out.id).not.toBe(track.id);
    expect(out.revision).toBe(1);
    expect(JSON.stringify(track)).toBe(before);
  });
});
