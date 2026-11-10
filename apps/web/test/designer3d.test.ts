// The 3D preview in the designer (#85), the pure parts: the guide's obstacles as plain blocks, the selected item's
// highlight, what a click in 3D lands on, and which meshes a new bake leaves as they were (so only those are rebuilt).
import { bake, PLAN_PALETTE, type RcTrack, type RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScene, featureAt, GUIDE_HEIGHT, guideMesh, highlightMesh, sameMesh, type MeshData } from "../src/viewer3d/scene.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const hall = ref<RcVenue>("venues/sports-hall-b.rcvenue.json");
const doc = ref<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json");
const built = doc.built!;

/** Vertices of a mesh in plan terms: [x, z, height]. */
const verts = (m: MeshData) => Array.from({ length: m.positions.length / 3 }, (_, k): [number, number, number] => [m.positions[3 * k], -m.positions[3 * k + 2], m.positions[3 * k + 1]]);
const bounds = (m: MeshData) => {
  const v = verts(m);
  return { x0: Math.min(...v.map((p) => p[0])), x1: Math.max(...v.map((p) => p[0])), z0: Math.min(...v.map((p) => p[1])), z1: Math.max(...v.map((p) => p[1])), y0: Math.min(...v.map((p) => p[2])), y1: Math.max(...v.map((p) => p[2])) };
};

describe("the guide's obstacles in 3D", () => {
  it("are blocks over each obstacle, from the floor up to GUIDE_HEIGHT, in the plan's obstacle colour", () => {
    const m = guideMesh(hall.obstacles!);
    expect(m.part).toBe("guide");
    expect(m.colour).toBe(PLAN_PALETTE["plan-obstacle"]);
    const b = bounds(m);
    expect(b.y0).toBeCloseTo(0, 6);
    expect(b.y1).toBeCloseTo(GUIDE_HEIGHT, 6);
    // the pillars (r 0.35 at ±6, 1) and the fire exit (2 × 3 at 11.5, −5.5)
    expect(b.x0).toBeCloseTo(-6.35, 2);
    expect(b.x1).toBeCloseTo(12.5, 6);
    expect(b.z0).toBeCloseTo(-7, 6);
    expect(b.z1).toBeCloseTo(1.35, 2);
    expect(verts(m).every(([x, z]) => Number.isFinite(x) && Number.isFinite(z))).toBe(true);
  });

  it("a rotated keep-out area turns with its rotation", () => {
    const m = guideMesh([{ type: "rect", x: 0, z: 0, length: 4, width: 2, rotation: 90 }]);
    const b = bounds(m);
    expect(b.x1 - b.x0).toBeCloseTo(2, 6);
    expect(b.z1 - b.z0).toBeCloseTo(4, 6);
  });

  it("are in the scene only when given, as their own mesh, apart from the layout's", () => {
    const without = buildScene({ area: hall.area, built });
    const withGuide = buildScene({ area: hall.area, built, obstacles: hall.obstacles });
    expect(without.meshes.some((m) => m.part === "guide")).toBe(false);
    expect(withGuide.meshes.filter((m) => m.part === "guide")).toHaveLength(1);
    // everything else is the same
    const others = withGuide.meshes.filter((m) => m.part !== "guide");
    expect(others.map((m) => m.part)).toEqual(without.meshes.map((m) => m.part));
    others.forEach((m, i) => expect(sameMesh(m, without.meshes[i])).toBe(true));
    expect(buildScene({ area: hall.area, built, obstacles: [] }).meshes.some((m) => m.part === "guide")).toBe(false);
  });
});

describe("the selected item's highlight", () => {
  it("a jump: a box round its footprint, a little bigger than it and higher than its top", () => {
    const f = built.features[0];
    const m = highlightMesh(built, { kind: "feature", i: 0 })!;
    expect(m.part).toBe("highlight");
    const b = bounds(m);
    const top = Math.max(...f.profile.map((p) => p[1]), f.height);
    expect(b.y1).toBeGreaterThan(top);
    // heading 180: length along x, width along z
    expect(b.x1 - b.x0).toBeGreaterThan(f.length);
    expect(b.z1 - b.z0).toBeGreaterThan(f.width);
    expect((b.x0 + b.x1) / 2).toBeCloseTo(f.x, 6);
    expect((b.z0 + b.z1) / 2).toBeCloseTo(f.z, 6);
  });

  it("a corner: a post standing on the corner's point", () => {
    const m = highlightMesh(built, { kind: "point", at: [3, -2] })!;
    const b = bounds(m);
    expect((b.x0 + b.x1) / 2).toBeCloseTo(3, 6);
    expect((b.z0 + b.z1) / 2).toBeCloseTo(-2, 6);
    expect(b.y0).toBeCloseTo(0, 6);
    expect(b.y1).toBeGreaterThan(0.5);
  });

  it("the start line: across the lane at built.startLine", () => {
    const s = built.startLine!;
    const b = bounds(highlightMesh(built, { kind: "start" })!);
    expect((b.x0 + b.x1) / 2).toBeCloseTo(s.x, 1);
    expect((b.z0 + b.z1) / 2).toBeCloseTo(s.z, 1);
    expect(Math.max(b.x1 - b.x0, b.z1 - b.z0)).toBeGreaterThanOrEqual(s.width);
  });

  it("nothing for no selection, or a jump the bake hasn't caught up with yet", () => {
    expect(highlightMesh(built, null)).toBeNull();
    expect(highlightMesh(built, { kind: "feature", i: built.features.length })).toBeNull();
  });
});

describe("a click in 3D", () => {
  it("on a jump's footprint picks that jump; off every jump, none", () => {
    built.features.forEach((f, i) => {
      expect(featureAt(built, [f.x, f.z])).toBe(i);
      const h = (f.heading * Math.PI) / 180;
      // just inside the far corner along its heading and to its left
      const along = f.length / 2 - 0.05, across = f.width / 2 - 0.05;
      expect(featureAt(built, [f.x + Math.cos(h) * along - Math.sin(h) * across, f.z + Math.sin(h) * along + Math.cos(h) * across])).toBe(i);
    });
    expect(featureAt(built, [-11, 6])).toBeNull();
  });
});

describe("a new bake rebuilds only what changed", () => {
  it("moving a jump changes the jump meshes; the floor, carpet and pipes are the same", () => {
    const moved: RcTrack = { ...doc, design: { ...doc.design, features: doc.design.features!.map((f, i) => (i === 1 ? { ...f, distance: f.distance + 2 } : f)) } };
    const a = buildScene({ area: hall.area, built: bake(doc).built! });
    const b = buildScene({ area: hall.area, built: bake(moved).built! });
    const part = (s: typeof a, p: string) => s.meshes.find((m) => m.part === p)!;
    for (const p of ["area", "carpet", "pipe", "startA", "startB", "line"]) expect(sameMesh(part(a, p), part(b, p)), p).toBe(true);
    expect(sameMesh(part(a, "jump"), part(b, "jump"))).toBe(false);
  });

  it("sameMesh compares the data, not the object", () => {
    const m = guideMesh(hall.obstacles!);
    expect(sameMesh(m, guideMesh(hall.obstacles!))).toBe(true);
    expect(sameMesh(m, guideMesh(hall.obstacles!.slice(1)))).toBe(false);
    expect(sameMesh(m, { ...m, colour: "#000000" })).toBe(false);
  });
});
