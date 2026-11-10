// #104: tight corners as Quick mode's step 1 now lays them (a 135° turn, a diagonal past the lane's own square, a lane
// beside a V's point, V points on the area's edge) bake as the Python reference does, and the bake decides what they
// mean: clean where the lanes share a pipe, a lane-squeeze warning where one is squeezed.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeBuilt, venueCheck, type RcTrack, type RcVenue } from "../src/index.js";
import { extraDir, readJson } from "./helpers.js";

const extra = (name: string) => readJson<RcTrack>(join(extraDir, `${name}.rctrack.json`));
const hall = readJson<RcVenue>(join(__dirname, "../../../reference/venues/club-hall.rcvenue.json"));
const codes = (name: string) => bakeBuilt(extra(name)).checks.map((c) => [c.level, c.code, c.message]);

describe("tight corners from step 1 (#104)", () => {
  it.each(["closing-past-start", "lane-beside-v-point", "v-points-at-edge"])("%s bakes clean, and fits the hall it was laid in", (name) => {
    expect(codes(name)).toEqual([]);
    expect(venueCheck(extra(name), hall).checks).toEqual([]);
  });

  it("a diagonal past the lane's own square: the lanes share a pipe, one squeezed by 8 cm (a warning)", () => {
    expect(codes("diagonal-past-lane").filter(([l]) => l !== "info")).toEqual([
      ["warning", "tight-corner", "Corner radius 0.59 m is tighter than a buggy can turn (0.6 m)"],
      ["warning", "tight-corner", "Corner radius 0.59 m is tighter than a buggy can turn (0.6 m)"],
      ["warning", "lane-squeeze", "Lane narrows by 0.08 m at this corner"],
    ]);
  });

  it("matches the Python reference's checks", () => {
    for (const name of ["closing-past-start", "lane-beside-v-point", "diagonal-past-lane", "v-points-at-edge"])
      expect(extra(name).built!.checks.map((c) => [c.level, c.code, c.message])).toEqual(codes(name));
  });
});
