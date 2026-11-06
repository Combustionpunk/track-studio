import { describe, expect, it } from "vitest";
import { bakeBuilt, fits, fittedScene, planSvg, rostrumPosition, transformBuilt, venueCheck, type RcTrack, type RcVenue } from "../src/index.js";
import { examples, readJson, venues } from "./helpers.js";

const ex = (n: string) => readJson<RcTrack>(examples.find((e) => e.name === n)!.path);
const venue = (n: string) => readJson<RcVenue>(venues.find((v) => v.name === n)!.path);

describe("rostrumPosition", () => {
  it("is where the venue check puts the venue's rostrum", () => {
    const v = venue("sports-hall-b.rcvenue.json");
    const { rostrum } = venueCheck(ex("freeform-at-sports-hall-b.rctrack.json"), v);
    expect([rostrum.x, rostrum.z]).toEqual(rostrumPosition(v.area, "south", 3));
    expect(rostrumPosition({ length: 20, width: 10 }, "west", 1)).toEqual([-11.5, 1]);
  });
});

describe("transformBuilt / fittedScene", () => {
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

  it("the scene uses the venue's area, obstacles and rostrum", () => {
    const track = ex("freeform-example.rctrack.json");
    const v = venue("sports-hall-b.rcvenue.json");
    const [fit] = fits(track, v);
    const scene = fittedScene({ ...track, built: bakeBuilt(track) }, v, fit);
    expect(scene.area).toEqual(v.area);
    expect(scene.obstacles).toEqual(v.obstacles);
    expect([scene.rostrum!.x, scene.rostrum!.z]).toEqual(rostrumPosition(v.area, "south", 3));
    const svg = planSvg(scene, { width: 600 });
    expect(svg).toMatch(/p-rostrum/);
    expect(svg).toMatch(/p-obstacle/);
  });
});
