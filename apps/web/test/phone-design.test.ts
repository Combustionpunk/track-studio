// The phone designer design (#117): the plan in docs/design/phone-designer.md and the static mockups in
// docs/design/phone/. Design only, no app code; these checks keep the mockups on the app's tokens (no new colours or
// fonts), at 375 px, and the plan complete enough for the Board to sign off.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DESIGN = join(ROOT, "docs", "design");
const PHONE = join(DESIGN, "phone");
const read = (p: string) => readFileSync(p, "utf8");

/** the mockups the issue asks for */
const MOCKUPS = ["01-plan-toolbar.html", "02-selected-point.html", "03-checks-sheet.html", "04-overflow-menu.html", "05-quick-mode.html"];

const tokens = JSON.parse(read(join(DESIGN, "tokens.json"))) as { color: { tokens: { name: string; value: string }[] } };
const tokenHex = new Set(tokens.color.tokens.map((t) => t.value.toLowerCase()).filter((v) => v.startsWith("#")));

const NAMED = "(?:white|black|red|green|blue|yellow|orange|purple|pink|grey|gray|silver|gold|navy|teal|lime|olive|aqua|crimson|coral|salmon|tomato|violet|indigo|khaki|beige|ivory|tan|brown)";
const LITERAL = new RegExp(String.raw`#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:fill|stroke|color|background)\s*[:=]\s*["']?${NAMED}\b`);

describe("the plan", () => {
  const plan = join(DESIGN, "phone-designer.md");

  it("exists", () => {
    expect(existsSync(plan)).toBe(true);
  });

  it("covers everything the issue asks for", () => {
    const md = read(plan);
    for (const heading of ["Scope by stage", "Layout at 375", "Touch interactions", "Tablet", "What the code needs", "Build tickets"]) {
      expect(md, heading).toMatch(new RegExp(`^##+ .*${heading}`, "mi"));
    }
    // stage 2's difficulties, the toolbar, sheets, the one overflow menu, the gestures, and nothing on hover
    for (const word of ["stage 1", "stage 2", "precision", "bottom toolbar", "bottom sheet", "overflow menu", "pinch", "two-finger", "loupe", "long press", "hover"]) {
      expect(md.toLowerCase(), word).toContain(word);
    }
    // links every mockup
    for (const f of MOCKUPS) expect(md, f).toContain(`phone/${f}`);
  });

  it("keeps the constraints: no track format change, branding stays with the forum", () => {
    const md = read(plan).toLowerCase();
    expect(md).toContain("track format");
    expect(md).toContain("brand");
  });
});

describe("the mockups", () => {
  it("are the five the issue asks for, on one shared stylesheet", () => {
    const files = readdirSync(PHONE).filter((f) => f.endsWith(".html")).sort();
    expect(files).toEqual(MOCKUPS);
    expect(existsSync(join(PHONE, "phone.css"))).toBe(true);
    for (const f of MOCKUPS) expect(read(join(PHONE, f)), f).toContain('href="phone.css"');
  });

  it("are drawn at 375 px", () => {
    const css = read(join(PHONE, "phone.css"));
    expect(css).toMatch(/\.phone\s*\{[^}]*width:\s*375px/);
    for (const f of MOCKUPS) expect(read(join(PHONE, f)), f).toMatch(/<div class="phone[" ]/);
  });

  it("take every colour from tokens.json, by custom property", () => {
    const css = read(join(PHONE, "phone.css"));
    // the stylesheet declares the tokens as --name: #hex, each one a value from tokens.json
    const declared = [...css.matchAll(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/gm)];
    expect(declared.length).toBeGreaterThan(10);
    for (const [, name, hex] of declared) expect(tokenHex.has(hex.toLowerCase()), `${name}: ${hex}`).toBe(true);
    // and nothing else in it names a colour
    const rest = css.replace(/^\s*--[\w-]+:\s*#[0-9a-fA-F]{3,8}\s*;/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rest.split("\n").filter((l) => LITERAL.test(l))).toEqual([]);
    // the pages use var(--x) only, and every var is declared
    const defined = new Set(declared.map((d) => d[1]));
    for (const line of css.matchAll(/^\s*(--[\w-]+):/gm)) defined.add(line[1]);
    for (const f of MOCKUPS) {
      const html = read(join(PHONE, f)).replace(/<!--[\s\S]*?-->/g, "");
      expect(html.split("\n").filter((l) => LITERAL.test(l)), f).toEqual([]);
      const missing = [...html.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((v) => !defined.has(v));
      expect(missing, f).toEqual([]);
    }
  });

  it("use only Inter and Oswald, with system fallbacks", () => {
    for (const f of [...MOCKUPS, "phone.css"]) {
      const src = read(join(PHONE, f));
      for (const m of src.matchAll(/font-family:\s*([^;}"]+)/g)) {
        expect(m[1].replace(/["']/g, ""), `${f}: ${m[0]}`).toMatch(/^(Oswald|Inter|Arial Narrow|Roboto Condensed|system-ui|-apple-system|Segoe UI|sans-serif|ui-monospace|SF Mono|Menlo|Consolas|monospace|var\(--font-[\w-]+\)|,|\s)+$/);
      }
    }
  });

  it("every control is a 44 px touch target and icon-only buttons are labelled", () => {
    const css = read(join(PHONE, "phone.css"));
    expect(css).toMatch(/--touch-target:\s*44px/);
    for (const f of MOCKUPS) {
      const html = read(join(PHONE, f));
      for (const btn of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const text = btn[2].replace(/<[^>]+>/g, "").trim();
        if (!text) expect(btn[1], `${f}: ${btn[0].slice(0, 80)}`).toMatch(/aria-label="[^"]+"/);
      }
    }
  });

  it("stay on the designer's words: Checks, Add point, Quick and Advanced", () => {
    const all = MOCKUPS.map((f) => read(join(PHONE, f))).join("\n");
    for (const word of ["Checks", "Add point", "Quick", "Advanced", "Submit track"]) expect(all).toContain(word);
  });
});
