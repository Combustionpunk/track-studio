// The conformance fixtures consumers test against (#155, rctrack-SPEC "Compatibility for consumers"): every reference
// example has the keys the spec says are always there, and between them they keep a jump and a crossover bridge.
import { describe, expect, it } from "vitest";
import { PIPE_R, PIPE_THICKNESS, type RcTrack } from "../src/index.js";
import { examples, readJson } from "./helpers.js";

const docs = examples.map(({ name, path }) => ({ name, doc: readJson<RcTrack>(path) }));
const ALWAYS_TOP = ["format", "version", "id", "revision", "info", "design", "built"];
const ALWAYS_BUILT = ["generator", "lapLength", "racingLine", "dividers", "features", "startLine", "checks", "stats", "lanes", "size", "footprint"];
const JUMPS = ["tabletop", "double", "kicker", "stepup", "stepdown", "whoops", "bump"];

describe("conformance fixtures (reference/examples)", () => {
  it.each(docs)("$name is rctrack version 1 with every always-present key", ({ doc }) => {
    expect(doc.format).toBe("rctrack");
    expect(doc.version).toBe(1);
    expect(Object.keys(doc)).toEqual(expect.arrayContaining(ALWAYS_TOP));
    expect(typeof doc.info.name).toBe("string");
    expect(Object.keys(doc.built!)).toEqual(expect.arrayContaining(ALWAYS_BUILT));
  });

  it("keep a layout with a jump and one with a crossover bridge", () => {
    expect(docs.some(({ doc }) => doc.built!.features.some((f) => JUMPS.includes(f.type)))).toBe(true);
    const bridged = docs.filter(({ doc }) => doc.built!.crossings?.some((c) => c.bridge?.type === "crossover"));
    expect(bridged.map((d) => d.name)).toContain("figure-eight-crossover.rctrack.json");
  });

  // the spec states 0.08 m; its text isn't read here, because the Docker image runs these tests without docs/
  it("the spec's fixed pipe size is the engine's", () => {
    expect(PIPE_THICKNESS).toBe(0.08);
    expect(2 * PIPE_R).toBe(PIPE_THICKNESS);
  });
});
