// The conformance fixtures consumers test against (#155, rctrack-SPEC "Compatibility for consumers"): every reference
// example has the keys the spec says are always there, and between them they keep a jump and a crossover bridge.
import { describe, expect, it } from "vitest";
import { bake, FEATURE_INSET, laneMask, PIPE_SIZE, type Line, type RcTrack } from "../src/index.js";
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

  // the spec states a 0.065 m square (1.12); its text isn't read here, because the Docker image runs these tests without docs/
  it("the spec's fixed pipe size is the engine's: 0.065 m square, and a ramp is still 0.08 m narrower than its lane", () => {
    expect(PIPE_SIZE).toBe(0.065);
    expect(FEATURE_INSET).toBe(0.08);
  });

  // 1.12: the footprint is the lanes plus half a pipe, 0.0325 m. A 2 m lane along x on a 1 cm grid: the cell centred
  // 1.025 m off the line is covered and the one at 1.035 m is not (1.11's 0.04 m covered both)
  it("the footprint pads the lanes by half the pipe's width", () => {
    const n = 100;
    const line: Line = { n, x: Float64Array.from({ length: n }, (_, i) => -0.495 + 0.01 * i), z: new Float64Array(n), width: new Float64Array(n).fill(2), curvature: new Float64Array(n) };
    const m = laneMask(line, [], [], 0.01, { origin: [-1, -2], rows: 400, cols: 200 });
    const covered = (x: number, z: number) => m.mask[Math.floor((z + 2) / 0.01) * 200 + Math.floor((x + 1) / 0.01)] === 1;
    expect(covered(0.005, 1.025)).toBe(true);
    expect(covered(0.005, 1.035)).toBe(false);
    expect(covered(0.005, -1.025)).toBe(true);
    expect(covered(0.005, -1.035)).toBe(false);
    // and the stored examples carry that footprint
    for (const { doc } of docs) expect(bake(doc).built!.footprint).toEqual(doc.built!.footprint);
  });

  it("keep a clean set of marshal points (club-a, 1 to 6) and an untidy one (freeform-example)", () => {
    const of = (name: string) => docs.find((d) => d.name === name)!.doc.built!;
    expect(of("club-a.rctrack.json").marshals!.map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(of("club-a.rctrack.json").checks.filter((c) => c.code.startsWith("marshal-"))).toEqual([]);
    const untidy = of("freeform-example.rctrack.json");
    expect(untidy.marshals!.length).toBeGreaterThan(0);
    // every marshal check code, so a reader sees each of them (one is an error on purpose: a cone on a pipe)
    expect([...new Set(untidy.checks.filter((c) => c.code.startsWith("marshal-")).map((c) => c.code))].sort()).toEqual(["marshal-far", "marshal-number-gap", "marshal-number-repeated", "marshal-on-track"]);
    expect(untidy.checks.find((c) => c.code === "marshal-on-track")!.level).toBe("error");
    // and a layout without cones has no built.marshals key at all
    expect(docs.some(({ doc }) => !("marshals" in doc.built!))).toBe(true);
  });
});
