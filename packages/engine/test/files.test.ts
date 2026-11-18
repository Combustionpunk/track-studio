// Download file names (#155): the track page shows the name the server's content-disposition gives.
import { describe, expect, it } from "vitest";
import { fileSlug, rctrackFileName, rcvenueFileName } from "../src/index.js";

describe("download file names", () => {
  it("is <slug>-r<n>.rctrack.json", () => {
    expect(rctrackFileName("Club A — winter layout", 3)).toBe("club-a-winter-layout-r3.rctrack.json");
    expect(rcvenueFileName("Sports hall B", 2)).toBe("sports-hall-b-r2.rcvenue.json");
  });

  it("slugs accents, punctuation and long names; an empty slug is 'track'", () => {
    expect(fileSlug("Café  Rêve_2")).toBe("cafe-reve-2");
    expect(fileSlug("x".repeat(80))).toHaveLength(60);
    expect(fileSlug("!!!")).toBe("track");
    expect(rctrackFileName("", 1)).toBe("track-r1.rctrack.json");
  });
});
