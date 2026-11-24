// #173: "Check against a venue" in the designer reports the venue's timing loop, and a warning alone doesn't mean the
// layout has to move.
import type { RcTrack, RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAgainstVenue, fitSummary } from "../src/designer/VenueCheck.js";

const ref = <T>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const clubA = ref<RcTrack>("examples/club-a.rctrack.json"); // start/finish at (-5.972, -4.9), heading east
const hall = (heading: number): RcVenue => ({ format: "rcvenue", version: 1, id: "loop", revision: 1, info: { name: "Loop hall" }, area: { length: 24, width: 14 }, timingLoop: { x: -6, z: -4.9, heading, length: 3 } });

describe("check against a venue with a timing loop", () => {
  it("is quiet when the start/finish is over the loop, its way", () => {
    const r = checkAgainstVenue(clubA.design, hall(0));
    expect(r.asDrawn.checks).toEqual([]);
    expect(fitSummary(r)).toBe("Fits Loop hall where it's drawn.");
  });
  it("warns when it runs the wrong way, and still fits where it's drawn", () => {
    const r = checkAgainstVenue(clubA.design, hall(180));
    expect(r.asDrawn.checks.map((c) => [c.level, c.code, c.message])).toEqual([["warning", "timing-loop", "Start/finish runs the wrong way over the timing loop"]]);
    expect(fitSummary(r)).toBe("Fits Loop hall where it's drawn.");
  });
});
