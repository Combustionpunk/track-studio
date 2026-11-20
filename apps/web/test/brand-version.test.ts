// The brand package matches the forum's (#164). The forum reports the brand it is built from as `brand_version` (the
// member-theme endpoint, #141/#163); Track Studio pins the same tag, so a member's colours here are the forum's.
// 0.5.0 darkened the light palettes' accents (and the generator's light mode) so links reach 4.5:1 on `line`.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { contrast, themeIds, themes } from "@rcmisfits/brand";
import { describe, expect, it } from "vitest";
import { themeColours } from "../src/lib/theme.js";

/** The brand version the forum reports as `brand_version` (forum on brand v0.5.0 since 19 Nov 2026). */
const FORUM_BRAND_VERSION = "0.5.0";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(require.resolve("@rcmisfits/brand/package.json"), "utf8")) as { version: string };
const tokens = JSON.parse(readFileSync(require.resolve("@rcmisfits/brand/tokens.json"), "utf8")) as {
  themes: Record<string, { name: string; colours: { accent: string; line: string; text: string } }>;
};
const css = readFileSync(require.resolve("@rcmisfits/brand/tokens.css"), "utf8");
const pinned = (file: string) => (JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as { dependencies: Record<string, string> }).dependencies["@rcmisfits/brand"];

/** The brand's light themes (every `-light` palette, and Ice). */
const lightIds = themeIds.filter((id) => themes[id].mode === "light");

describe("the brand package", () => {
  it("is the version the forum reports", () => {
    expect(pkg.version).toBe(FORUM_BRAND_VERSION);
  });

  it("is pinned to that tag in the web app and the server", () => {
    expect(pinned("../package.json")).toBe(`github:Combustionpunk/brand#v${FORUM_BRAND_VERSION}`);
    expect(pinned("../../server/package.json")).toBe(`github:Combustionpunk/brand#v${FORUM_BRAND_VERSION}`);
  });
});

describe("light palettes' accents", () => {
  it("finds the light themes", () => {
    expect(lightIds).toContain("pit-lane-light");
    expect(lightIds.length).toBeGreaterThanOrEqual(9);
  });

  describe.each(lightIds)("%s", (id) => {
    const token = tokens.themes[id]!.colours;

    it("the app's theme colours (page and plan) use the tokens' accent", () => {
      expect(themeColours(id, false).accent).toBe(token.accent);
    });

    it("the served CSS gives the tokens' accent", () => {
      const rule = css.match(new RegExp(`\\[data-theme="${id}"\\] \\{([^}]*)\\}`))?.[1];
      expect(rule).toContain(`--rm-accent: ${token.accent};`);
    });

    it("links read on the forum's hover row: accent 4.5:1 on line (the 0.5.0 rule)", () => {
      expect(contrast(token.accent, token.line)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
