import { describe, expect, it } from "vitest";
import { rctrackSchema, validateTrack, validateVenue, type RcTrack, type RcVenue } from "../src/index.js";
import { allTracks, allVenues, readJson, referenceDir } from "./helpers.js";
import { join } from "node:path";

describe("validate", () => {
  it("bundled rctrack schema is the reference schema", () => {
    expect(rctrackSchema).toEqual(readJson(join(referenceDir, "rctrack.schema.json")));
  });

  it.each(allTracks)("$name is a valid rctrack", ({ path }) => {
    expect(validateTrack(readJson(path))).toEqual({ valid: true, errors: [] });
  });

  it.each(allVenues)("$name is a valid rcvenue", ({ path }) => {
    expect(validateVenue(readJson(path))).toEqual({ valid: true, errors: [] });
  });

  it("rejects broken tracks with a path to the problem", () => {
    const doc = readJson<RcTrack>(allTracks[0].path);
    const r = validateTrack({ ...doc, design: { ...doc.design, points: doc.design.points.slice(0, 2) } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "/design/points")).toBe(true);
    expect(validateTrack({ ...doc, format: "rcvenue" }).valid).toBe(false);
    expect(validateTrack({ ...doc, area: { length: 0, width: 10 } }).valid).toBe(false);
    expect(validateTrack({ ...doc, info: { ...doc.info, created: "yesterday" } }).valid).toBe(false);
  });

  it("rejects broken venues", () => {
    const v = readJson<RcVenue>(allVenues[0].path);
    expect(validateVenue({ ...v, format: "rctrack" }).valid).toBe(false);
    expect(validateVenue({ ...v, rostrum: { side: "up" } }).valid).toBe(false);
    expect(validateVenue({ ...v, obstacles: [{ type: "circle", x: 0, z: 0 }] }).valid).toBe(false);
    expect(validateVenue({ ...v, obstacles: [{ type: "rect", x: 0, z: 0, length: 1 }] }).valid).toBe(false);
    expect(validateVenue({ ...v, obstacles: [{ type: "rect", x: 0, z: 0, length: 1, width: 2, rotation: 15 }] }).valid).toBe(true);
  });
});
