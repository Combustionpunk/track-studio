import { validateVenue, type RcVenue } from "@track-studio/engine";
import { describe, expect, it } from "vitest";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import {
  addObstacle,
  blankVenue,
  draftFromDoc,
  draftProblems,
  fromCorner,
  moveObstacle,
  obstacleOutside,
  outsideObstacles,
  resizeHandle,
  resizeObstacle,
  rostrumOffsetAt,
  setRostrumSide,
  toCorner,
  venueBody,
  type VenueDraft,
} from "../src/venues/model.js";

const hall = (): VenueDraft => ({
  info: { name: "Misfits Main Hall", venue: { id: 12 }, notes: "" },
  area: { length: 22, width: 12 },
  rostrum: { side: "south", offset: 0 },
  obstacles: [
    { type: "circle", x: 9, z: 2, radius: 0.5, label: "Pillar" },
    { type: "rect", x: -10, z: 5, length: 2, width: 1, rotation: 0, label: "Fire door keep-clear" },
  ],
});

describe("venue documents", () => {
  it("a blank venue saves as a valid rcvenue file", () => {
    const body = venueBody({ ...blankVenue(), info: { name: "New hall" } });
    expect(validateVenue({ format: "rcvenue", version: 1, id: "x", revision: 1, ...body })).toEqual({ valid: true, errors: [] });
  });

  it("round-trips a stored venue, keeping the forum venue's name", () => {
    const doc: RcVenue = { format: "rcvenue", version: 1, id: "venue-2", revision: 4, ...hall(), info: { name: "Hall", venue: { id: 12, name: "Main Hall" }, notes: "n" } };
    const d = draftFromDoc(doc);
    expect(d).not.toHaveProperty("revision");
    expect(venueBody(d)).toEqual({ info: { name: "Hall", venue: { id: 12, name: "Main Hall" }, notes: "n" }, area: doc.area, rostrum: doc.rostrum, obstacles: doc.obstacles });
    expect(draftFromDoc({ ...doc, rostrum: undefined, obstacles: undefined })).toMatchObject({ rostrum: { side: "south", offset: 0 }, obstacles: [] });
  });

  it("no forum venue id → info.venue is null; empty notes are dropped; names are trimmed", () => {
    const body = venueBody({ ...hall(), info: { name: "  Hall  ", venue: null, notes: "   " } });
    expect(body.info).toEqual({ name: "Hall", venue: null });
  });

  it("validates what the server would refuse, in plain words", () => {
    expect(draftProblems(hall())).toEqual({});
    expect(draftProblems({ ...hall(), info: { name: " " } }).name).toBe("Give the venue a name.");
    expect(draftProblems({ ...hall(), area: { length: 0, width: 12 } }).length).toBe("Length must be more than 0 m.");
    expect(draftProblems({ ...hall(), area: { length: 22, width: 101 } }).width).toBe("Width can be at most 100 m.");
    // a new template linked to a forum venue must pick the track; an older one (only the venue id) can still save
    expect(draftProblems({ ...hall(), info: { name: "Hall", venue: { id: 12, name: "Main Hall" } } }, { isNew: true }).forumTrack).toBe("Pick the track at this forum venue.");
    expect(draftProblems({ ...hall(), info: { name: "Hall", venue: { id: 12, name: "Main Hall" } } }).forumTrack).toBeUndefined();
    expect(draftProblems({ ...hall(), info: { name: "Hall", venue: { id: 12, name: "Main Hall", trackId: 31, trackName: "Carpet" } } }, { isNew: true })).toEqual({});
    expect(draftProblems({ ...hall(), obstacles: [{ type: "circle", x: 0, z: 0, radius: 0 }] })["obstacle-0"]).toBe("Radius must be more than 0 m.");
    expect(draftProblems({ ...hall(), obstacles: [{ type: "rect", x: 0, z: Number.NaN, length: 1, width: 1 }] })["obstacle-0"]).toBe("Position must be a number.");
    // the rostrum stays on its wall, also when the area shrinks under it
    expect(draftProblems({ ...hall(), rostrum: { side: "south", offset: 11 } }).rostrum).toBeUndefined();
    expect(draftProblems({ ...hall(), rostrum: { side: "south", offset: 19 } }).rostrum).toBe("The rostrum must be on its wall: 0 to 22 m from the west corner.");
    expect(draftProblems({ ...hall(), area: { length: 22, width: 8 }, rostrum: { side: "east", offset: -5 } }).rostrum).toBe("The rostrum must be on its wall: 0 to 8 m from the south corner.");
    expect(Object.keys(draftProblems({ ...hall(), obstacles: Array.from({ length: 101 }, () => hall().obstacles[0]) }))).toEqual(["obstacles"]);
  });
});

describe("rostrum", () => {
  it("the form shows its position from the west (north/south walls) or south corner (east/west walls)", () => {
    const area = { length: 22, width: 12 };
    expect(toCorner(area, "south", -4)).toBe(7);
    expect(fromCorner(area, "south", 7)).toBe(-4);
    expect(toCorner(area, "east", 0)).toBe(6);
    expect(fromCorner(area, "west", 12)).toBe(6);
    // what's typed comes back exactly, so the field doesn't rewrite itself mid-entry
    for (const typed of [5.55, 0.01, 21.99]) expect(toCorner(area, "south", fromCorner(area, "south", typed))).toBe(typed);
  });

  it("dragging slides it along its wall, kept on the wall, to 0.1 m", () => {
    const area = { length: 22, width: 12 };
    expect(rostrumOffsetAt(area, "south", [3.04, -40])).toBe(3);
    expect(rostrumOffsetAt(area, "north", [30, 0])).toBe(11);
    expect(rostrumOffsetAt(area, "east", [0, -2.26])).toBe(-2.3);
    expect(rostrumOffsetAt(area, "west", [0, 9])).toBe(6);
  });

  it("changing the wall keeps the offset when it fits, else centres it", () => {
    expect(setRostrumSide({ length: 22, width: 12 }, { side: "south", offset: 4 }, "east")).toEqual({ side: "east", offset: 4 });
    expect(setRostrumSide({ length: 22, width: 12 }, { side: "south", offset: 9 }, "west")).toEqual({ side: "west", offset: 0 });
  });
});

describe("obstacles", () => {
  it("added obstacles are inside the area and selected-ready at the end of the list", () => {
    const d = addObstacle(hall(), "circle");
    expect(d.obstacles).toHaveLength(3);
    expect(d.obstacles[2]).toEqual({ type: "circle", x: 0, z: 0, radius: 0.5, label: "Obstacle 3" });
    const r = addObstacle(blankVenue(), "rect").obstacles[0];
    expect(r).toEqual({ type: "rect", x: 0, z: 0, length: 2, width: 1, rotation: 0, label: "Keep-out area 1" });
    expect(outsideObstacles(addObstacle(blankVenue(), "rect"))).toEqual([]);
  });

  it("inside-area check: circles by their radius, rectangles by their turned corners", () => {
    const area = { length: 22, width: 12 };
    expect(obstacleOutside(area, { type: "circle", x: 10.5, z: 0, radius: 0.5 })).toBe(false);
    expect(obstacleOutside(area, { type: "circle", x: 10.6, z: 0, radius: 0.5 })).toBe(true);
    expect(obstacleOutside(area, { type: "rect", x: 0, z: 5.5, length: 4, width: 1 })).toBe(false);
    expect(obstacleOutside(area, { type: "rect", x: 0, z: 5.5, length: 4, width: 1, rotation: 90 })).toBe(true);
    expect(obstacleOutside(area, { type: "rect", x: 0, z: 0, length: 30, width: 1, rotation: 90 })).toBe(true);
    expect(outsideObstacles({ ...hall(), area: { length: 18, width: 12 } })).toEqual([0, 1]);
  });

  it("dragging moves an obstacle's centre, to 0.1 m", () => {
    expect(moveObstacle(hall().obstacles[0], [3.33, -1.26])).toMatchObject({ x: 3.3, z: -1.3, radius: 0.5 });
  });

  it("the resize handle sits on the edge; dragging it sets the radius or the size", () => {
    const [circle, rect] = hall().obstacles;
    expect(resizeHandle(circle)).toEqual([9.5, 2]);
    expect(resizeObstacle(circle, [9, 3.24])).toMatchObject({ radius: 1.2 });
    expect(resizeObstacle(circle, [9, 2])).toMatchObject({ radius: 0.1 });
    expect(resizeHandle(rect)).toEqual([-9, 5.5]);
    expect(resizeObstacle(rect, [-8, 4])).toMatchObject({ length: 4, width: 2, x: -10, z: 5 });
    const turned = { ...rect, rotation: 90 };
    const h = resizeHandle(turned);
    expect(h[0]).toBeCloseTo(-10.5);
    expect(h[1]).toBeCloseTo(6);
    expect(resizeObstacle(turned, [-11, 8])).toMatchObject({ length: 6, width: 2 });
  });
});

describe("undo and redo", () => {
  it("form edits and drags are steps in one history", () => {
    const start: HistoryState<VenueDraft> = { past: [], present: hall(), future: [], group: null, at: 0, travels: 0 };
    const set = (s: HistoryState<VenueDraft>, next: VenueDraft, group?: string, now = 1000) => historyReducer(s, { type: "set", next, group, now });
    // a drag is one step however many moves it makes
    let s = set(start, { ...s0(start), obstacles: [moveObstacle(s0(start).obstacles[0], [1, 1]), s0(start).obstacles[1]] }, "drag:o0:1");
    s = set(s, { ...s.present, obstacles: [moveObstacle(s.present.obstacles[0], [2, 2]), s.present.obstacles[1]] }, "drag:o0:1", 5000);
    // then a form edit
    s = set(s, { ...s.present, area: { length: 24, width: 12 } }, "area.length", 6000);
    expect(s.past).toHaveLength(2);
    s = historyReducer(s, { type: "undo" });
    expect(s.present.area.length).toBe(22);
    expect(s.present.obstacles[0]).toMatchObject({ x: 2, z: 2 });
    s = historyReducer(s, { type: "undo" });
    expect(s.present).toEqual(hall());
    s = historyReducer(historyReducer(s, { type: "redo" }), { type: "redo" });
    expect(s.present.area.length).toBe(24);
  });
});

const s0 = (s: HistoryState<VenueDraft>) => s.present;
