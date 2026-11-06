// Lap time figures (#76): formatting, the estimate from the lap length, and the class speed editor's rows.
import { describe, expect, it } from "vitest";
import { designerEstimate, estimateSeconds, lapTime, parseSpeedRows, recordTime } from "../src/lib/laps.js";

describe("lap times", () => {
  it("the estimate is the lap length over the class speed", () => {
    expect(estimateSeconds(94.9, 6.5)).toBeCloseTo(14.6, 2);
  });

  it("typical laps read to a tenth, records to a hundredth", () => {
    expect(lapTime(14.83)).toBe("14.8 s");
    expect(lapTime(14.6, true)).toBe("≈ 14.6 s est.");
    expect(recordTime(13921)).toBe("13.92 s");
  });

  it("designer: ≈ 14.6 s lap (2WD Buggy, est.) from the first class; nothing without a speed or a lap", () => {
    expect(designerEstimate(94.9, [{ class: "2WD Buggy", speed: 6.5 }, { class: "4WD Buggy", speed: 7 }])).toBe("≈ 14.6 s lap (2WD Buggy, est.)");
    expect(designerEstimate(94.9, [])).toBeNull();
    expect(designerEstimate(0, [{ class: "2WD Buggy", speed: 6.5 }])).toBeNull();
  });

  it("speed rows: trimmed, blank rows dropped, and each problem named", () => {
    expect(parseSpeedRows([{ class: " 2WD Buggy ", speed: "6.5" }, { class: "", speed: "" }])).toEqual({ classes: [{ class: "2WD Buggy", speed: 6.5 }] });
    expect(parseSpeedRows([{ class: "2WD Buggy", speed: "fast" }])).toEqual({ error: "2WD Buggy: the speed must be 0.5 to 30 m/s" });
    expect(parseSpeedRows([{ class: "", speed: "6" }])).toEqual({ error: "Every class with a speed needs a name" });
    expect(parseSpeedRows([{ class: "A", speed: "6" }, { class: "a", speed: "7" }])).toEqual({ error: "a is listed twice" });
  });
});
