// #179: orientations are shown by name, and a list of them reads cleanly (the commas in "mirrored, rotated 180" ran
// into the commas between list items). The stored labels (ORIENTS, derivedFrom.orientation) don't change.
import { describe, expect, it } from "vitest";
import { ORIENTS, orientationList, orientationName } from "../src/index.js";

describe("orientationName", () => {
  it("names every orientation fits() reports", () => {
    expect(ORIENTS.map(([label]) => orientationName(label))).toEqual([
      "as designed",
      "mirrored",
      "turned round",
      "mirrored and turned round",
      "turned a quarter left",
      "turned a quarter right",
      "mirrored and turned a quarter left",
      "mirrored and turned a quarter right",
    ]);
  });

  it("no name has a comma in it, and every name is different", () => {
    const names = ORIENTS.map(([label]) => orientationName(label));
    for (const n of names) expect(n).not.toContain(",");
    expect(new Set(names).size).toBe(names.length);
  });

  it("shows a label it doesn't know as it is", () => {
    expect(orientationName("sideways")).toBe("sideways");
  });
});

describe("orientationList", () => {
  it("one orientation", () => {
    expect(orientationList(["rotated 180"])).toBe("turned round");
  });
  it("two orientations", () => {
    expect(orientationList(["as designed", "mirrored, rotated 180"])).toBe("as designed or mirrored and turned round");
  });
  it("three orientations", () => {
    expect(orientationList(["as designed", "mirrored", "rotated 180"])).toBe("as designed, mirrored, or turned round");
  });
  it("four orientations", () => {
    expect(orientationList(["as designed", "mirrored", "rotated 180", "mirrored, rotated 180"])).toBe(
      "as designed, mirrored, turned round, or mirrored and turned round",
    );
  });
  it("none", () => {
    expect(orientationList([])).toBe("");
  });
});
