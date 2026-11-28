import { describe, expect, it } from "vitest";
import { venueRevisionMeta } from "../src/lib/format.js";

describe("venue revision line", () => {
  const r = { createdAt: "2026-11-06T10:00:00Z", createdBy: { id: 1, username: "Yetidragon" }, area: { length: 22, width: 12 }, obstacles: 0 };
  it("separates the revision number from the date", () => {
    const text = `r1${venueRevisionMeta(r, true)}`;
    expect(text).toMatch(/^r1 · 6 Nov 2026 · /);
    expect(text).not.toMatch(/r16 Nov/);
    expect(text).toMatch(/ · 0 obstacles · latest$/);
  });
  it("omits latest for older revisions", () => {
    expect(venueRevisionMeta(r, false)).not.toContain("latest");
  });
});
