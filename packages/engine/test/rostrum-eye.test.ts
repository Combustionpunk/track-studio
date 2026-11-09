// Where the drivers stand (spec, Sim integration): one function for the sim and the 3D viewer (#84).
import { describe, expect, it } from "vitest";
import { EYE_HEIGHT, rostrumEye, venueRostrumOf, type RcVenue, type VenueCheck } from "../src/index.js";
import expected from "./fixtures/fit-expected.json";
import { allVenues, readJson } from "./helpers.js";

describe("rostrumEye", () => {
  const area = { length: 22, width: 12 }; // not square, so a mixed-up side or axis shows

  it.each([
    ["north", 0, 7.5],
    ["south", 0, -7.5],
    ["east", 12.5, 0],
    ["west", -12.5, 0],
  ] as const)("%s: 1.5 m outside the middle of that side, eyes 2.8 m up", (side, x, z) => {
    expect(rostrumEye(area, side)).toEqual({ side, x, z, eyeHeight: 2.8 });
  });

  it("eyes are 2.8 m up", () => expect(EYE_HEIGHT).toBe(2.8));

  it("is where the reference puts a venue's rostrum (fit.py's venue check)", () => {
    const want = expected as unknown as Record<string, { check: VenueCheck }>;
    for (const v of allVenues) {
      const venue = readJson<RcVenue>(v.path);
      const key = Object.keys(want).find((k) => k.endsWith(` | ${v.name}`))!;
      expect(rostrumEye(venue.area, venue.rostrum?.side ?? "south", venue.rostrum?.offset ?? 0)).toEqual(want[key].check.rostrum);
      expect(venueRostrumOf(venue)).toEqual(want[key].check.rostrum);
    }
  });
});
