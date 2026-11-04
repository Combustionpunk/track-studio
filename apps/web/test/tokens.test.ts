// The web app takes every colour and font from tokens: the synced forum colours and fonts in src/theme/tokens.css,
// the fixed plan drawing palette in src/theme/plan-palette.css and src/lib/plan.ts. Nothing else may name a colour.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { faviconFromLogo } from "../brand.js";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_FILES = ["src/theme/tokens.css", "src/theme/plan-palette.css", "src/lib/plan.ts"];

const files = (dir: string): string[] =>
  readdirSync(join(WEB, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(css|tsx?|html)$/.test(e.name) ? [join(dir, e.name)] : []));

const NAMED =
  "(?:light|dark|medium|pale|deep)?(?:white|black|red|green|blue|yellow|orange|purple|pink|magenta|cyan|grey|gray|silver|gold|navy|teal|maroon|lime|olive|aqua|fuchsia|crimson|coral|salmon|tomato|violet|indigo|khaki|beige|ivory|tan|brown|chocolate|orchid|plum|turquoise|whitesmoke|slategr[ae]y|steelblue|skyblue)";
/** hex, rgb()/hsl()/…, or a named colour used as a CSS value / SVG paint */
const LITERAL = new RegExp(String.raw`#[0-9a-fA-F]{3,8}\b|\b0x[0-9a-fA-F]{6}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?:[:=]\s*["']?|\b(?:fill|stroke|color|background)\s*[:=]\s*["']?)(?:${NAMED})\b`);

describe("colours come from tokens only", () => {
  const sources = [...files("src"), "index.html"].filter((f) => !TOKEN_FILES.includes(f));

  it("finds the app's sources", () => {
    expect(sources).toContain("src/styles.css");
    expect(sources).toContain("src/components/PlanView.tsx");
  });

  /** comments blanked out (line numbers kept) */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:"'])\/\/.*$/gm, "$1");

  it("no literal colours outside the token files", () => {
    const offenders = sources.flatMap((f) =>
      code(readFileSync(join(WEB, f), "utf8"))
        .split("\n")
        .map((line, i) => ({ line, at: `${f}:${i + 1}` }))
        .filter(({ line }) => LITERAL.test(line.replace(/&#\d+;/g, "")))
        .map(({ at, line }) => `${at}: ${line.trim().slice(0, 120)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the check catches the usual ways of writing a colour", () => {
    for (const bad of ["color: #fff;", "fill: rgb(0 0 0 / 0.5);", "background: hsl(0 0% 0%);", 'fill="white"', "stroke: black;", "{ color: \"#123456\" }", "color: crimson;", "fill: lightgrey;", "new Color(0xff0000)"]) expect(bad).toMatch(LITERAL);
    for (const ok of ["color: var(--text);", "fill: currentColor;", "background: transparent;", "border: 1px solid var(--border);", "id=\"#main\"", "href=\"#main\""]) expect(ok).not.toMatch(LITERAL);
  });

  it("every var(--x) the app uses is defined", () => {
    const defined = new Set(TOKEN_FILES.filter((f) => f.endsWith(".css")).flatMap((f) => [...readFileSync(join(WEB, f), "utf8").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
    const runtime = new Set(["--plan-ratio", "--screen-zoom", "--print-zoom"]); // set inline by PlanView and the build sheet
    const missing = sources.flatMap((f) => [...readFileSync(join(WEB, f), "utf8").matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((v) => !defined.has(v) && !runtime.has(v)).map((v) => `${f}: ${v}`));
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("fonts", () => {
  const tokens = readFileSync(join(WEB, "src/theme/tokens.css"), "utf8");

  it("Inter and Oswald load from the app itself, with system fallbacks", () => {
    const urls = [...tokens.matchAll(/url\(["']?([^"')]+)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const u of urls) {
      expect(u).not.toMatch(/^(https?:)?\/\//);
      expect(u).toMatch(/\.woff2$/);
      expect(existsSync(join(WEB, "src/theme", u)), u).toBe(true);
    }
    expect(tokens).toMatch(/font-family:\s*"Inter"/);
    expect(tokens).toMatch(/font-family:\s*"Oswald"/);
    expect(tokens).toMatch(/--font-body:\s*"Inter",[^;]*sans-serif;/);
    expect(tokens).toMatch(/--font-heading:\s*"Oswald",[^;]*sans-serif;/);
  });

  it("no stylesheet or page pulls from a third-party font host", () => {
    for (const f of [...files("src"), "index.html"]) expect(readFileSync(join(WEB, f), "utf8"), f).not.toMatch(/fonts\.(googleapis|gstatic)|use\.typekit|fonts\.bunny/);
  });
});

describe("logo", () => {
  const logo = readFileSync(join(WEB, "src/brand/logo.svg"), "utf8");

  it("is one SVG with the wordmark and a 'mark' view for the favicon", () => {
    expect(logo).toContain('<view id="mark"');
    expect(logo).toMatch(/aria-label="RC Misfits"/);
  });

  it("the favicon is the logo cropped to its mark", () => {
    const fav = faviconFromLogo(logo);
    const markBox = /<view id="mark" viewBox="([^"]+)"/.exec(logo)![1];
    expect(fav).toMatch(new RegExp(`^<svg[^>]* viewBox="${markBox}"`));
    expect(fav).toMatch(/ width="32" height="32"/);
    expect(fav).not.toContain("var(--"); // a favicon has no page to take tokens from
    expect(faviconFromLogo('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50"><view id="mark" viewBox="0 0 50 50"/><path d="M0 0"/></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" width="32" height="32"><view id="mark" viewBox="0 0 50 50"/><path d="M0 0"/></svg>',
    );
  });

  it("the header and the favicon both use it", () => {
    expect(readFileSync(join(WEB, "src/components/Header.tsx"), "utf8")).toContain("brand/logo.svg");
    // colours from the theme tokens, with fallbacks for the standalone favicon
    for (const m of logo.matchAll(/(?:fill|stroke)(?:="|:\s*)([^";]+)/g)) if (m[1] !== "none") expect(m[1]).toMatch(/^var\(--[\w-]+, #[0-9a-f]{3,6}\)$/);
    expect(readFileSync(join(WEB, "vite.config.ts"), "utf8")).toContain("src/brand/logo.svg");
    expect(existsSync(join(WEB, "public/favicon.svg"))).toBe(false);
  });
});
