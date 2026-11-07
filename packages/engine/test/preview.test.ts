import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { previewSvg, type RcTrack } from "../src/index.js";
import { allTracks, examples, extraDir, readJson } from "./helpers.js";

describe("previewSvg", () => {
  it.each(examples)("$name matches the reference preview byte for byte", ({ path }) => {
    const svg = previewSvg(readJson<RcTrack>(path));
    expect(svg).toBe(readFileSync(path.replace(".rctrack.json", ".preview.svg"), "utf8"));
  });

  it.each(allTracks)("$name is well-formed", ({ path }) => {
    const svg = previewSvg(readJson<RcTrack>(path));
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  // #91: forum previews circle errors and warnings only; a jump into a corner (info) is a technical section, not a fault
  it("draws no ring for info checks", async () => {
    const doc = readJson<RcTrack>(join(extraDir, "jump-across-start.rctrack.json"));
    expect(doc.built!.checks.map((c) => c.level)).toEqual(["info"]);
    const svg = previewSvg(doc);
    expect(svg).not.toContain("<circle");
    await expect(svg).toMatchFileSnapshot("__snapshots__/jump-across-start.preview.svg");
    // warnings and errors still get theirs
    const warned = { ...doc, built: { ...doc.built!, checks: doc.built!.checks.map((c) => ({ ...c, level: "warning" as const })) } };
    expect(previewSvg(warned).match(/<circle /g)).toHaveLength(1);
  });

  it("escapes text", () => {
    const doc = readJson<RcTrack>(examples[0].path);
    const svg = previewSvg({ ...doc, info: { ...doc.info, name: 'Tom & Jerry <"fast">' } });
    expect(svg).toContain("Tom &amp; Jerry &lt;&quot;fast&quot;&gt;");
  });

  it("needs built", () => {
    const { built: _, ...doc } = readJson<RcTrack>(examples[0].path);
    expect(() => previewSvg(doc as RcTrack)).toThrow(/built/);
  });
});
