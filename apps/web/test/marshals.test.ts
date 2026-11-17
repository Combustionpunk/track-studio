// #151: marshal points in the designer, as the designer edits design.marshals.
import { describe, expect, it } from "vitest";
import { addMarshal, clampToPlacement, deleteMarshal, MARSHAL_PLACE_MARGIN, moveMarshal, nextMarshalNumber, renumberMarshal } from "../src/designer/marshals.js";

const area = { length: 20, width: 10 };

describe("nextMarshalNumber", () => {
  it("is the lowest number no cone has", () => {
    expect(nextMarshalNumber([])).toBe(1);
    expect(nextMarshalNumber([{ number: 1, x: 0, z: 0 }, { number: 2, x: 0, z: 0 }])).toBe(3);
    expect(nextMarshalNumber([{ number: 1, x: 0, z: 0 }, { number: 4, x: 0, z: 0 }, { number: 2, x: 0, z: 0 }])).toBe(3);
    expect(nextMarshalNumber([{ number: 2, x: 0, z: 0 }])).toBe(1);
  });
});

describe("clampToPlacement", () => {
  it("allows cones up to 2 m outside the drawing area, rounded to the centimetre", () => {
    expect(MARSHAL_PLACE_MARGIN).toBe(2);
    expect(clampToPlacement([1.23456, -2.3456], area)).toEqual([1.23, -2.35]);
    expect(clampToPlacement([13, -9], area)).toEqual([12, -7]);
    expect(clampToPlacement([-50, 50], area)).toEqual([-12, 7]);
  });
});

describe("cone edits", () => {
  it("adds a cone with the lowest unused number, at the end of the list", () => {
    const r = addMarshal([{ number: 2, x: 0, z: 0 }], [3, -6.5], area);
    expect(r.index).toBe(1);
    expect(r.marshals).toEqual([{ number: 2, x: 0, z: 0 }, { number: 1, x: 3, z: -6.5 }]);
  });

  it("moves a cone (within the placement limit) and keeps its number", () => {
    const list = [{ number: 3, x: 0, z: 0 }];
    expect(moveMarshal(list, 0, [20, 1], area)).toEqual([{ number: 3, x: 12, z: 1 }]);
    expect(list[0].x).toBe(0); // not changed in place
  });

  it("deletes a cone; the others keep their numbers", () => {
    expect(deleteMarshal([{ number: 1, x: 0, z: 0 }, { number: 2, x: 1, z: 1 }], 0)).toEqual([{ number: 2, x: 1, z: 1 }]);
  });

  it("renumbers a cone without moving it, to a whole number from 1 to 99", () => {
    const list = [{ number: 1, x: 4, z: 5 }];
    expect(renumberMarshal(list, 0, 7)).toEqual([{ number: 7, x: 4, z: 5 }]);
    expect(renumberMarshal(list, 0, 0)[0].number).toBe(1);
    expect(renumberMarshal(list, 0, 150)[0].number).toBe(99);
    expect(renumberMarshal(list, 0, 2.6)[0].number).toBe(3);
  });
});
