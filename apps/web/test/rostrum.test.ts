// The 3D viewer's rostrum view (#84): pure, no WebGL. The camera stands where the spec puts the drivers (Sim
// integration: 1.5 m outside the middle of a side, eyes 2.8 m up, looking at the middle); the default side is the
// drawn-for venue's rostrum, else south; the URL keeps the choice.
import { venueCheck, type RcTrack, type RcVenue, type Side } from "@track-studio/engine";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FOV_MAX, FOV_MIN, headPose, rostrumHead, rostrumPose, ROSTRUM_FOV, turnHead, zoomHead } from "../src/viewer3d/camera.js";
import { defaultRostrumSide, readRostrum, writeRostrum } from "../src/viewer3d/rostrum.js";
import { DECK_HEIGHT, RAIL_HEIGHT, rostrumMeshes, type MeshData } from "../src/viewer3d/scene.js";

const REF = join(__dirname, "../../../reference");
const read = <T,>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;
const venues = readdirSync(join(REF, "venues")).map((f) => read<RcVenue>(join(REF, "venues", f)));
const club = read<RcTrack>(join(REF, "examples/club-a.rctrack.json"));

const area = { length: 22, width: 12 }; // not square
const SIDES: [Side, number, number][] = [
  ["north", 0, 7.5],
  ["east", 12.5, 0],
  ["south", 0, -7.5],
  ["west", -12.5, 0],
];
/** three.js position back to plan terms: [x, z, height]. */
const plan = ([x, y, z]: number[]): [number, number, number] => [x, -z, y];
const verts = (m: MeshData) => Array.from({ length: m.positions.length / 3 }, (_, k) => plan([m.positions[3 * k], m.positions[3 * k + 1], m.positions[3 * k + 2]]));

describe("the camera at the rostrum", () => {
  it.each(SIDES)("%s: 1.5 m outside the middle of that side, eyes 2.8 m up, looking at the middle", (side, x, z) => {
    const p = rostrumPose(area, side);
    const [px, pz, py] = plan(p.position);
    expect(px).toBeCloseTo(x, 6);
    expect(pz).toBeCloseTo(z, 6);
    expect(py).toBeCloseTo(2.8, 6);
    // the target lies on the line from the eye to the middle of the floor
    const d = [p.target[0] - p.position[0], p.target[1] - p.position[1], p.target[2] - p.position[2]];
    const m = [0 - p.position[0], 0 - p.position[1], 0 - p.position[2]];
    const cos = (d[0] * m[0] + d[1] * m[1] + d[2] * m[2]) / (Math.hypot(...d) * Math.hypot(...m));
    expect(cos).toBeCloseTo(1, 9);
  });

  it("turning the head moves where it looks, never where it stands", () => {
    const h0 = rostrumHead(area, "south");
    const h1 = turnHead(h0, 30, -10);
    expect(h1.yaw).toBeCloseTo(h0.yaw + 30);
    expect(h1.pitch).toBeCloseTo(h0.pitch - 10);
    expect(headPose(area, "south", h1).position).toEqual(headPose(area, "south", h0).position);
    expect(headPose(area, "south", h1).target).not.toEqual(headPose(area, "south", h0).target);
  });

  it("can't look past straight up or straight down", () => {
    const h = rostrumHead(area, "west");
    expect(turnHead(h, 0, 500).pitch).toBeLessThan(90);
    expect(turnHead(h, 0, -500).pitch).toBeGreaterThan(-90);
  });

  it("zoom narrows the field of view, within limits", () => {
    const h = rostrumHead(area, "north");
    expect(h.fov).toBe(ROSTRUM_FOV);
    expect(zoomHead(h, 1 / 1.25).fov).toBeCloseTo(ROSTRUM_FOV / 1.25);
    expect(zoomHead(h, 0.001).fov).toBe(FOV_MIN);
    expect(zoomHead(h, 1000).fov).toBe(FOV_MAX);
  });
});

describe("the default side", () => {
  it("is the rostrum of the venue the layout is drawn for, as venueCheck reports it", () => {
    for (const v of venues) expect(defaultRostrumSide(v)).toBe(venueCheck(club, v).rostrum.side);
    expect(venues.map(defaultRostrumSide)).toEqual(expect.arrayContaining(["north", "west"])); // not all south
  });

  it("is south when there is no venue (none drawn for, or the template is gone)", () => {
    expect(defaultRostrumSide(null)).toBe("south");
    expect(defaultRostrumSide(undefined)).toBe("south");
  });
});

describe("the URL keeps the choice", () => {
  it("reads ?view=rostrum&side=w", () => {
    expect(readRostrum(new URLSearchParams("view=rostrum&side=w"))).toEqual({ at: true, side: "west" });
    expect(readRostrum(new URLSearchParams("view=rostrum&side=n"))).toEqual({ at: true, side: "north" });
    expect(readRostrum(new URLSearchParams("view=rostrum"))).toEqual({ at: true, side: undefined });
    expect(readRostrum(new URLSearchParams("side=e"))).toEqual({ at: false, side: "east" });
    expect(readRostrum(new URLSearchParams("view=rostrum&side=x"))).toEqual({ at: true, side: undefined });
    expect(readRostrum(new URLSearchParams("r=2"))).toEqual({ at: false, side: undefined });
  });

  it("writes it, keeping the other parameters", () => {
    const p = new URLSearchParams("r=2");
    expect(writeRostrum(p, { at: true, side: "west" }).toString()).toBe("r=2&view=rostrum&side=w");
    expect(writeRostrum(new URLSearchParams("r=2&view=rostrum&side=w"), { at: false, side: "west" }).toString()).toBe("r=2&side=w");
    expect(writeRostrum(new URLSearchParams("view=rostrum&side=w"), { at: false }).toString()).toBe("");
    expect(p.toString()).toBe("r=2"); // a copy
  });
});

describe("the rostrum in the scene", () => {
  it.each(SIDES)("%s: a platform and rail at the rostrum, outside the area", (side, x, z) => {
    const ms = rostrumMeshes(area, side);
    expect(ms.map((m) => m.part).sort()).toEqual(["rail", "rostrum"]);
    const [deck, rail] = [ms.find((m) => m.part === "rostrum")!, ms.find((m) => m.part === "rail")!];
    const all = [...verts(deck), ...verts(rail)];
    // nothing over the track area
    for (const [vx, vz] of all) expect(Math.abs(vx) > 11 - 1e-6 || Math.abs(vz) > 6 - 1e-6).toBe(true);
    // the deck is centred on the spot, its top 1.7 m under the eyes
    const dv = verts(deck);
    const cx = (Math.min(...dv.map((v) => v[0])) + Math.max(...dv.map((v) => v[0]))) / 2;
    const cz = (Math.min(...dv.map((v) => v[1])) + Math.max(...dv.map((v) => v[1]))) / 2;
    expect(cx).toBeCloseTo(x, 6);
    expect(cz).toBeCloseTo(z, 6);
    expect(Math.max(...dv.map((v) => v[2]))).toBeCloseTo(DECK_HEIGHT, 6);
    expect(DECK_HEIGHT).toBeCloseTo(2.8 - 1.7, 6);
    // the rail is on the track's side of the eyes, up to rail height over the deck
    const rv = verts(rail);
    expect(Math.max(...rv.map((v) => v[2]))).toBeCloseTo(DECK_HEIGHT + RAIL_HEIGHT, 6);
    const out = (v: number[]) => (x ? Math.abs(v[0]) : Math.abs(v[1])); // how far out from the middle, across the side
    for (const v of rv) expect(out(v)).toBeLessThan(Math.abs(x || z));
  });
});
