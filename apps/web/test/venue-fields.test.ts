// #173: the venue template's surface, timing loop and pit area / rostrum zones in the editor's model, a layout started
// from a template taking its surface, and who sees the editor (organisers and clubs' committees).
import { validateVenue, type RcVenue } from "@track-studio/engine";
import { describe, expect, it } from "vitest";
import { toDoc } from "../src/designer/Designer.js";
import { venueDraft } from "../src/designer/start.js";
import { mayEditVenues } from "../src/lib/session.js";
import { addTimingLoop, addZone, blankVenue, draftFromDoc, draftProblems, loopEnds, obstacleName, setKind, turnTimingLoop, venueBody, type VenueDraft } from "../src/venues/model.js";

const hall = (): VenueDraft => ({ ...blankVenue(), info: { name: "Hall", venue: null }, area: { length: 22, width: 12 } });
const saved = (d: VenueDraft): RcVenue => ({ format: "rcvenue", version: 1, id: "v", revision: 1, ...venueBody(d) }) as RcVenue;

describe("venue model, rcvenue 1.2", () => {
  it("a 1.1 template opens with no surface or loop and saves without them", () => {
    const doc: RcVenue = { format: "rcvenue", version: 1, id: "v", revision: 1, info: { name: "Old" }, area: { length: 20, width: 10 }, obstacles: [] };
    const d = draftFromDoc(doc);
    expect(d.surface).toBeUndefined();
    expect(d.timingLoop).toBeUndefined();
    const body = venueBody(d);
    expect("surface" in body).toBe(false);
    expect("timingLoop" in body).toBe(false);
  });

  it("surface and loop round-trip through the body, which the schema accepts", () => {
    const d = addTimingLoop({ ...hall(), surface: "astro" });
    expect(d.timingLoop).toEqual({ x: 0, z: -5, heading: 0, length: 3 }); // 1 m in from the south wall, running east
    const back = draftFromDoc(saved(d));
    expect(back.surface).toBe("astro");
    expect(back.timingLoop).toEqual(d.timingLoop);
    expect(validateVenue(saved(d)).valid).toBe(true);
  });

  it("adds a pit area and a rostrum zone, named for their kind", () => {
    const d = addZone(addZone(hall(), "pits"), "rostrum");
    expect(d.obstacles.map((o) => [o.kind, o.type, obstacleName(o)])).toEqual([["pits", "rect", "Pits"], ["rostrum", "rect", "Rostrum"]]);
    expect(validateVenue(saved(d)).valid).toBe(true);
  });

  it("changing what a zone is renames it only when it had its kind's default name", () => {
    const [pits] = addZone(hall(), "pits").obstacles;
    expect(obstacleName(setKind(pits, "rostrum"))).toBe("Rostrum");
    expect(setKind(pits, undefined).label).toBeUndefined(); // a plain obstacle is unlabelled until given one
    expect(setKind(pits, undefined).kind).toBeUndefined();
    expect(obstacleName(setKind({ ...pits, label: "Pit tables" }, "rostrum"))).toBe("Pit tables");
  });

  it("the loop turns towards the pointer in 15° steps, its ends square to its direction", () => {
    const l = { x: 0, z: 0, heading: 0, length: 2 };
    expect(turnTimingLoop(l, [0, 3]).heading).toBe(90);
    expect(turnTimingLoop(l, [-1, -0.05]).heading).toBe(180);
    expect(turnTimingLoop(l, [1, -1.1]).heading).toBe(315);
    expect(loopEnds(l).map((p) => p.map((v) => Math.round(v * 1e9) / 1e9))).toEqual([[0, -1], [0, 1]]);
  });

  it("a loop must have a length and lie within the limits", () => {
    expect(draftProblems({ ...hall(), timingLoop: { x: 0, z: 0, heading: 0, length: 0 } }).timingLoop).toMatch(/length/i);
    expect(draftProblems({ ...hall(), timingLoop: { x: 500, z: 0, heading: 0, length: 3 } }).timingLoop).toMatch(/100 m/);
    expect(draftProblems({ ...hall(), timingLoop: { x: 0, z: 0, heading: 90, length: 3 } }).timingLoop).toBeUndefined();
  });
});

describe("a layout started from a template", () => {
  it("takes the template's surface into info.surface", () => {
    const v = saved({ ...hall(), surface: "tarmac" });
    const d = venueDraft(v);
    expect(d.info.surface).toBe("tarmac");
    expect(toDoc(d).info.surface).toBe("tarmac");
    expect(toDoc(venueDraft(saved(hall()))).info.surface).toBeUndefined();
  });
});

describe("who may edit venue templates", () => {
  const me = (o: Partial<{ organiser: boolean; clubs: string[] }>) => ({ id: 1, username: "u", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false, clubs: [], ...o });
  it("organisers and a club's committee; not members, not visitors", () => {
    expect(mayEditVenues(me({ organiser: true }))).toBe(true);
    expect(mayEditVenues(me({ clubs: ["soar"] }))).toBe(true);
    expect(mayEditVenues(me({}))).toBe(false);
    expect(mayEditVenues({ ...me({}), clubs: undefined })).toBe(false); // an older server sends no clubs
    expect(mayEditVenues(null)).toBe(false);
  });
});
