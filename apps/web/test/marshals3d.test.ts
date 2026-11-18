// #151: marshal points in the 3D preview, a small traffic cone each with its number on a plate beside it.
import { PLAN_PALETTE, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScene, CONE_HEIGHT, digitSegments, type MeshData } from "../src/viewer3d/scene.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const club = ref<RcTrack>("examples/club-a.rctrack.json");
const area = club.area!;
const verts = (m: MeshData) => Array.from({ length: m.positions.length / 3 }, (_, k): [number, number, number] => [m.positions[3 * k], -m.positions[3 * k + 2], m.positions[3 * k + 1]]);
const part = (meshes: MeshData[], p: string) => meshes.find((m) => m.part === p);

describe("cones in 3D", () => {
  const scene = buildScene({ area, built: club.built! });

  it("draws a cone, a plate and the number for each marshal point, in the plan's jump colours", () => {
    const cone = part(scene.meshes, "cone")!, plate = part(scene.meshes, "conePlate")!, number = part(scene.meshes, "coneNumber")!;
    expect(cone.colour).toBe(PLAN_PALETTE["plan-jump"]);
    expect(plate.colour).toBe(PLAN_PALETTE["plan-jump-edge"]);
    expect(number.colour).toBe(PLAN_PALETTE["plan-pipe"]);
    // each cone's tip stands CONE_HEIGHT over its spot
    for (const m of club.built!.marshals!) {
      const tip = verts(cone).filter(([x, z]) => Math.hypot(x - m.x, z - m.z) < 1e-4).map((v) => v[2]);
      expect(Math.max(...tip)).toBeCloseTo(CONE_HEIGHT, 4);
    }
  });

  it("has none when the layout has no marshal points", () => {
    const { marshals: _m, ...plain } = club.built!;
    const parts = buildScene({ area, built: plain }).meshes.map((m) => m.part);
    expect(parts).not.toContain("cone");
    expect(parts).not.toContain("coneNumber");
  });

  it("draws numbers as seven-segment digits", () => {
    expect(digitSegments(8)).toHaveLength(7);
    expect(digitSegments(1)).toHaveLength(2);
    expect(digitSegments(7)).toHaveLength(3);
    // 12: two digits' segments, 2 + 5
    const one = buildScene({ area, built: { ...club.built!, marshals: [{ ...club.built!.marshals![0], number: 12 }] } });
    expect(part(one.meshes, "coneNumber")!.indices.length / 6).toBe(7); // a quad (2 triangles) per segment
  });
});
