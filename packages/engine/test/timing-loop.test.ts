// rctrack 1.13 / rcvenue 1.2: the venue's timing loop, pit area and rostrum zones (#173).
import { describe, expect, it } from "vitest";
import { fits, timingLoopCheck, validateVenue, venueCheck, type RcTrack, type RcVenue } from "../src/index.js";
import { examples, readJson, venues } from "./helpers.js";

const clubA = readJson<RcTrack>(examples.find((e) => e.name === "club-a.rctrack.json")!.path);
const start = clubA.built!.startLine; // (-5.972, -4.9), heading 0
const hall = (extra: Partial<RcVenue> = {}): RcVenue => ({ format: "rcvenue", version: 1, id: "v", revision: 1, info: { name: "Hall" }, area: { length: 24, width: 14 }, ...extra });
const loop = (o: Partial<NonNullable<RcVenue["timingLoop"]>> = {}) => hall({ timingLoop: { x: start.x, z: start.z, heading: 0, length: 3, ...o } });
const code = (v: RcVenue) => timingLoopCheck(clubA, v)?.message ?? null;

describe("timing loop", () => {
  it("no loop, or no built start line: no check", () => {
    expect(code(hall())).toBeNull();
    expect(timingLoopCheck({}, loop())).toBeNull();
  });
  it("start/finish over the loop, its way: no check", () => {
    expect(code(loop())).toBeNull();
    expect(code(loop({ x: start.x + 0.5 }))).toBeNull(); // 0.5 m before or after it counts
    expect(code(loop({ z: start.z + 1.5 }))).toBeNull(); // within the loop's span
    expect(code(loop({ heading: 30 }))).toBeNull(); // up to 30° off square
  });
  it("start/finish away from the loop", () => {
    expect(code(loop({ x: start.x + 0.6 }))).toBe("Start/finish isn't over the timing loop");
    expect(code(loop({ z: start.z + 1.6 }))).toBe("Start/finish isn't over the timing loop");
    expect(code(loop({ x: 6, z: 4.9 }))).toBe("Start/finish isn't over the timing loop");
  });
  it("the wrong way, or at an angle", () => {
    expect(code(loop({ heading: 180 }))).toBe("Start/finish runs the wrong way over the timing loop");
    expect(code(loop({ heading: -170 }))).toBe("Start/finish runs the wrong way over the timing loop");
    expect(code(loop({ heading: 90 }))).toBe("Start/finish crosses the timing loop at an angle");
  });
  it("is a warning at the loop, reported by venueCheck after the area and obstacle checks", () => {
    const v = loop({ x: 6, z: 4.9 });
    expect(venueCheck(clubA, v).checks).toEqual([{ level: "warning", code: "timing-loop", x: 6, z: 4.9, message: "Start/finish isn't over the timing loop" }]);
  });
  it("never changes the fit search", () => {
    const base = readJson<RcVenue>(venues.find((v) => v.name === "club-hall.rcvenue.json")!.path);
    expect(fits(clubA, { ...base, timingLoop: { x: 3, z: 3, heading: 90, length: 3 } })).toEqual(fits(clubA, base));
  });
});

describe("pit area and rostrum zones", () => {
  it("block the fit and the venue check like any obstacle", () => {
    const pits = hall({ obstacles: [{ type: "rect", kind: "pits", x: start.x, z: start.z, length: 2, width: 1, label: "Pits" }] });
    expect(venueCheck(clubA, pits).checks.map((c) => c.code)).toEqual(["obstacle"]);
    const rostrum = hall({ area: { length: 22.2, width: 12.4 }, obstacles: [{ type: "rect", kind: "rostrum", x: 0, z: 0, length: 30, width: 0.4 }] });
    expect(fits(clubA, rostrum)).toEqual([]);
  });
});

describe("rcvenue 1.2 validation", () => {
  it("accepts surface, timing loop and zone kinds", () => {
    expect(validateVenue(loop({ heading: 45 })).valid).toBe(true);
    expect(validateVenue(hall({ surface: "astro", obstacles: [{ type: "rect", kind: "pits", x: 0, z: 0, length: 2, width: 1 }] })).valid).toBe(true);
  });
  it("refuses an unknown surface or kind, and a loop with no length", () => {
    expect(validateVenue({ ...hall(), surface: "grass" } as unknown as RcVenue).valid).toBe(false);
    expect(validateVenue(hall({ obstacles: [{ type: "rect", kind: "bar", x: 0, z: 0, length: 2, width: 1 } as never] })).valid).toBe(false);
    expect(validateVenue({ ...hall(), timingLoop: { x: 0, z: 0, heading: 0 } } as unknown as RcVenue).valid).toBe(false);
  });
  it("1.1 templates still load", () => {
    for (const v of venues) expect(validateVenue(readJson<RcVenue>(v.path)).valid).toBe(true);
  });
});

describe("surface (1.13)", () => {
  it("an adapted copy takes the template's surface; a template without one leaves the layout's", async () => {
    const { adapt } = await import("../src/index.js");
    const base = readJson<RcVenue>(venues.find((v) => v.name === "club-hall.rcvenue.json")!.path);
    const [fit] = fits(clubA, base);
    expect(adapt(clubA, { ...base, surface: "tarmac" }, fit, { id: "x" }).info.surface).toBe("tarmac");
    expect(adapt(clubA, base, fit, { id: "x" }).info.surface).toBe(clubA.info.surface);
  });
  it("a layout may name any venue surface", async () => {
    const { validateTrack } = await import("../src/index.js");
    for (const surface of ["dirt", "tarmac", "mixed", "other"]) expect(validateTrack({ ...clubA, info: { ...clubA.info, surface } }).valid).toBe(true);
  });
});

describe("plans (1.13)", () => {
  it("draw the timing loop across the track with its direction, and the pit area and rostrum as zones", async () => {
    const { planLayers } = await import("../src/index.js");
    const scene = {
      area: { length: 24, width: 14 },
      timingLoop: { x: -6, z: -4.9, heading: 0, length: 3 },
      obstacles: [
        { type: "rect" as const, kind: "pits" as const, x: 0, z: 6.6, length: 4, width: 0.6 },
        { type: "rect" as const, kind: "rostrum" as const, x: -11.7, z: 0, length: 0.5, width: 3, label: "Stand" },
        { type: "circle" as const, x: 3, z: 3, radius: 0.3 },
      ],
    };
    const svg = planLayers(scene, { px: 0.05, tips: true });
    // the loop runs north-south (across a track heading east), from z -6.4 to -3.4 at x -6
    expect(svg).toMatch(/<g class="p-timing-loop" data-tip="loop"><path d="M-6 6\.4 L-6 3\.4"/);
    expect(svg).toContain('class="p-zone p-pits"');
    expect(svg).toContain('class="p-zone p-rostrum-zone"');
    expect(svg).toContain(">Pits</text>"); // a zone with no label is named for its kind
    expect(svg).toContain(">Stand</text>");
    expect(svg.match(/class="p-obstacle"/g)).toHaveLength(1);
    expect(planLayers(scene, { px: 0.05, layers: { obstacles: false } })).not.toMatch(/p-timing-loop|p-zone/);
    expect(planLayers(scene, { px: 0.02, palette: "print" })).toContain("p-timing-loop");
  });
});
