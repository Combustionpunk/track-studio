// #151: marshal points in the 3D preview, a small traffic cone each with its number on a plate beside it.
import { PLAN_PALETTE, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScene, CONE_HEIGHT, digitSegments, PIPE_CLEAR, type MeshData } from "../src/viewer3d/scene.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const club = ref<RcTrack>("examples/club-a.rctrack.json");
const area = club.area!;
const verts = (m: MeshData) => Array.from({ length: m.positions.length / 3 }, (_, k): [number, number, number] => [m.positions[3 * k], -m.positions[3 * k + 2], m.positions[3 * k + 1]]);
const part = (meshes: MeshData[], p: string) => meshes.find((m) => m.part === p);

describe("cones in 3D", () => {
  const scene = buildScene({ area, built: club.built! });

  it("draws a cone, a plate and the number for each marshal point: the cone traffic-cone orange (plan-cone, #157)", () => {
    const cone = part(scene.meshes, "cone")!, plate = part(scene.meshes, "conePlate")!, number = part(scene.meshes, "coneNumber")!;
    expect(cone.colour).toBe(PLAN_PALETTE["plan-cone"]);
    expect(plate.colour).toBe(PLAN_PALETTE["plan-jump-edge"]);
    expect(number.colour).toBe(PLAN_PALETTE["plan-pipe"]);
    // each cone's tip stands CONE_HEIGHT over its spot
    for (const m of club.built!.marshals!) {
      const tip = verts(cone).filter(([x, z]) => Math.hypot(x - m.x, z - m.z) < 1e-4).map((v) => v[2]);
      expect(Math.max(...tip)).toBeCloseTo(CONE_HEIGHT, 4);
    }
  });

  it("keeps the number plate off the pipe: towards the track only when it fits in the gap, else on the far side (#157)", () => {
    const m0 = { ...club.built!.marshals![0], x: 0, z: 0, number: 7 };
    /** how far the plate reaches towards the track (along `facing`); negative: it lies on the far side */
    const reach = (gap: number, facing: number) => {
      const s = buildScene({ area, built: { ...club.built!, marshals: [{ ...m0, gap, facing }] } });
      const f = (facing * Math.PI) / 180;
      return Math.max(...verts(part(s.meshes, "conePlate")!).map(([x, z]) => x * Math.cos(f) + z * Math.sin(f)));
    };
    for (const facing of [0, 45, 90, 200, 315]) {
      // far from the track: the plate is between the cone and the track, clear of it
      expect(reach(1.5, facing)).toBeGreaterThan(0.2);
      expect(reach(1.5, facing)).toBeLessThan(1.5);
      // close to the track (a cone 0.3 m from the lane edge): the plate would lie on the pipe, so it goes behind the cone
      expect(reach(0.3, facing)).toBeLessThan(0.3 - PIPE_CLEAR);
      expect(reach(0, facing)).toBeLessThan(0);
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
