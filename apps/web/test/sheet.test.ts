// The build sheet page's figures and rules (src/lib/sheet.ts): every value as printed, from the engine's buildSheet.
import { buildSheet, fromSouthWest, PRINT_PALETTE, type RcTrack } from "@track-studio/engine";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cornerRows, figures, jumpRows, metres1, paperFrom, PAPER, qrModules, sheetPlan, sheetStatus, shortLink, startText } from "../src/lib/sheet.js";

const REF = join(__dirname, "..", "..", "..", "reference", "examples");
const fixtures = readdirSync(REF).filter((f) => f.endsWith(".rctrack.json")).map((name) => ({ name, doc: JSON.parse(readFileSync(join(REF, name), "utf8")) as RcTrack }));
const club = fixtures.find((f) => f.name === "club-a.rctrack.json")!.doc;

describe("build sheet tables", () => {
  it.each(fixtures)("$name: corner rows are the corner points, measured from the south-west corner", ({ doc }) => {
    const s = buildSheet(doc);
    const rows = cornerRows(s);
    expect(rows).toHaveLength(s.cornerPoints.length);
    rows.forEach((r, i) => {
      const c = s.cornerPoints[i];
      const sw = fromSouthWest(doc.area, c.x, c.z);
      expect(r).toMatchObject({ label: c.label, fromWest: metres1(sw.fromWest), fromSouth: metres1(sw.fromSouth) });
    });
  });

  it.each(fixtures)("$name: jump rows match built.features", ({ doc }) => {
    const rows = jumpRows(buildSheet(doc));
    expect(rows).toHaveLength(doc.built!.features.length);
    rows.forEach((r, i) => {
      const f = doc.built!.features[i];
      const sw = fromSouthWest(doc.area, f.x, f.z);
      expect(r.position).toBe(`${metres1(sw.fromWest)}, ${metres1(sw.fromSouth)}`);
      expect(r.size).toBe(`${Math.round(f.length * 100) / 100} × ${Math.round(f.height * 100) / 100} m`);
    });
  });

  it("club-a, as printed", () => {
    const s = buildSheet(club);
    const rows = cornerRows(s);
    // design point 0 is (10, -4.9) in a 22 × 12 m area
    expect(rows[0]).toEqual({ label: "1", fromWest: "21.0 m", fromSouth: "1.1 m", turn: "Left" });
    expect(rows[4]).toEqual({ label: "5a", fromWest: "3.0 m", fromSouth: "6.9 m", turn: "Right, hairpin" });
    expect(jumpRows(s)[0]).toEqual({ type: "Tabletop", position: "12.0 m, 1.1 m", size: `${club.built!.features[0].length} × ${club.built!.features[0].height} m` });
    const f = Object.fromEntries(figures(s).map((x) => [x.label, x.value]));
    expect(f).toEqual({
      "Lap length": metres1(club.built!.lapLength),
      Corners: "12",
      "Track size": "22 × 11.8 m",
      "Track area": "22 × 12 m",
      [`Pipe, in ${club.built!.stats.dividerRuns} runs`]: metres1(club.built!.stats.dividerLength),
      "Lane width": "1.8–2.0 m",
    });
    expect(startText(s)).toBe("Start line 5.0 m from the west wall, 1.1 m from the south wall, cars heading east. Travel is anticlockwise, shown by the arrows on the racing line. Rostrum on the north side.");
  });

  it("metres1: one decimal, always", () => {
    expect(metres1(2)).toBe("2.0 m");
    expect(metres1(4.964)).toBe("5.0 m");
    expect(metres1(0.04)).toBe("0.0 m");
    expect(metres1(-0.04)).toBe("0.0 m");
  });
});

describe("watermark", () => {
  const track = (status: "draft" | "submitted" | "approved" | "archived", revision: number, approvedRevision: number | null) => ({ status, revision, approvedRevision });

  it("draft and submitted revisions carry the DRAFT watermark", () => {
    expect(sheetStatus(track("draft", 1, null), 1)).toEqual({ status: "draft", watermark: true, banner: "DRAFT · NOT YET APPROVED" });
    expect(sheetStatus(track("submitted", 2, null), 2)).toEqual({ status: "submitted", watermark: true, banner: "SUBMITTED · NOT YET APPROVED" });
  });

  it("the approved revision has none", () => {
    expect(sheetStatus(track("approved", 3, 3), 3)).toEqual({ status: "approved", watermark: false, banner: "APPROVED" });
    // approved 3 with a newer draft 4: printing 3 is approved, printing 4 is a draft
    expect(sheetStatus(track("draft", 4, 3), 3).watermark).toBe(false);
    expect(sheetStatus(track("draft", 4, 3), 4)).toMatchObject({ status: "draft", watermark: true });
    // an older, never-approved revision
    expect(sheetStatus(track("approved", 3, 3), 2)).toMatchObject({ status: "draft", watermark: true });
  });

  it("archived: the approved revision stays unwatermarked, anything else is a draft", () => {
    expect(sheetStatus(track("archived", 3, 3), 3)).toEqual({ status: "archived", watermark: false, banner: "ARCHIVED" });
    expect(sheetStatus(track("archived", 2, null), 2)).toMatchObject({ watermark: true });
  });
});

describe("paper", () => {
  it("A3 landscape by default, A4 landscape when asked", () => {
    expect(paperFrom(null)).toBe("a3");
    expect(paperFrom("a4")).toBe("a4");
    expect(paperFrom("A4")).toBe("a4");
    expect(paperFrom("letter")).toBe("a3");
    expect(PAPER.a3.page).toBe("A3 landscape");
    expect(PAPER.a4.page).toBe("A4 landscape");
    // the A3 layout scaled down to A4 keeps the proportions (both are √2)
    expect(PAPER.a4.scale).toBeCloseTo(297 / 420, 4);
    expect(PAPER.a3.scale).toBe(1);
  });
});

describe("plan and link", () => {
  it("sheetPlan: 5 m labels along the south and west edges, from the south-west corner", () => {
    const p = sheetPlan(club, 1000);
    expect(p.south.map((l) => l.text)).toEqual(["0", "5 m", "10 m", "15 m", "20 m", "22 m"]);
    expect(p.west.map((l) => l.text)).toEqual(["0", "5 m", "10 m", "12 m"]);
    expect(p.south[0].x).toBe(-11);
    expect(p.west[1].y).toBe(6 - 5); // svg y = -z: 5 m up from the south wall (z = -6) is z = -1
    expect(p.svg).toContain('class="p-jump-print-hatch"');
    expect(p.svg).not.toContain('class="p-error"'); // checks aren't printed
  });

  it("short link and QR code", () => {
    expect(shortLink("https://tracks.rcmisfits.org", "4k2x")).toEqual({ url: "https://tracks.rcmisfits.org/t/4k2x", text: "tracks.rcmisfits.org/t/4k2x" });
    expect(shortLink("http://localhost:3000", "4k2x", 2).url).toBe("http://localhost:3000/t/4k2x?r=2");
    const q = qrModules("https://tracks.rcmisfits.org/t/46897d82-0114-460f-9a75-984ee97bca0e");
    expect(q.size).toBeGreaterThanOrEqual(21);
    expect(q.path).toMatch(/^M\d+ \d+h1v1h-1z/);
  });

  it("the print colours in the web app are the engine's print palette (tokens.json print-*)", () => {
    const css = readFileSync(join(__dirname, "..", "src/theme/plan-palette.css"), "utf8");
    for (const [name, value] of Object.entries(PRINT_PALETTE)) expect(css, name).toContain(`--${name}: ${value};`);
  });
});
