import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { previewSvg, type RcTrack } from "../src/index.js";
import { allTracks, examples, readJson } from "./helpers.js";

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
