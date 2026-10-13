import { describe, expect, it } from "vitest";
import { bakeBuilt, fits, fittedPreviewDoc, previewSvg, rostrumPosition, transformBuilt, type RcTrack, type RcVenue } from "../src/index.js";
import { examples, readJson, venues } from "./helpers.js";

const ex = (n: string) => readJson<RcTrack>(examples.find((e) => e.name === n)!.path);
const venue = (n: string) => readJson<RcVenue>(venues.find((v) => v.name === n)!.path);

describe("rostrumPosition", () => {
  it("is where bake puts the rostrum", () => {
    const t = ex("freeform-at-sports-hall-b.rctrack.json");
    const [x, z] = rostrumPosition(t.area, "south", 3);
    expect([x, z]).toEqual([t.built!.rostrum.x, t.built!.rostrum.z]);
    expect(rostrumPosition({ length: 20, width: 10 }, "west", 1)).toEqual([-11.5, 1]);
  });
});

describe("transformBuilt / fittedPreviewDoc", () => {
  it("moved geometry lands where the re-baked adapted copy is", () => {
    const track = ex("freeform-example.rctrack.json");
    const adapted = ex("freeform-at-sports-hall-b.rctrack.json");
    const [fit] = fits(track, venue("sports-hall-b.rcvenue.json"));
    const moved = transformBuilt(track.built!, fit);
    const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const worst = Math.max(...moved.racingLine.map((p) => Math.min(...adapted.built!.racingLine.map((q) => near(p, q)))));
    expect(worst).toBeLessThan(0.15); // same line, sampled from a different start point
    moved.features.forEach((f, i) => {
      expect(near([f.x, f.z], [adapted.built!.features[i].x, adapted.built!.features[i].z])).toBeLessThan(0.02);
      expect(Math.abs(((f.heading - adapted.built!.features[i].heading + 540) % 360) - 180)).toBeLessThan(0.5);
    });
  });

  it("the preview doc uses the venue's area, obstacles and rostrum", () => {
    const track = ex("freeform-example.rctrack.json");
    const v = venue("sports-hall-b.rcvenue.json");
    const [fit] = fits(track, v);
    const doc = fittedPreviewDoc({ ...track, built: bakeBuilt(track) }, v, fit);
    expect(doc.area).toEqual(v.area);
    expect(doc.obstacles).toEqual(v.obstacles);
    expect([doc.built!.rostrum.x, doc.built!.rostrum.z]).toEqual(rostrumPosition(v.area, "south", 3));
    expect(doc.info.name).toBe("Freeform example · rotated 180 in Sports hall B");
    expect(previewSvg(doc)).toContain("area 25 x 14 m");
  });
});
