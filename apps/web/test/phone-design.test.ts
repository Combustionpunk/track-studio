// The phone designer design (#117): the plan in docs/design/phone-designer.md and the static mockups in
// docs/design/phone/. Design only, no app code; these checks keep the mockups on the app's tokens (no new colours or
// fonts), at 375 px with 44 px controls and Lucide icons, and the plan complete enough for the Board to sign off.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DESIGN = join(ROOT, "docs", "design");
const PHONE = join(DESIGN, "phone");
const read = (p: string) => readFileSync(p, "utf8");

/** the mockups the issue asks for */
const MOCKUPS = ["01-plan-toolbar.html", "02-selected-point.html", "03-checks-sheet.html", "04-overflow-menu.html", "05-quick-mode.html"];

interface Tokens {
  color: { tokens: { name: string; value: string }[] };
  shadow: { tokens: { name: string; value: string }[] };
}
const tokens = JSON.parse(read(join(DESIGN, "tokens.json"))) as Tokens;
/** token name → value, for the colours and the shadows (the only tokens that carry a colour) */
const byName = new Map([...tokens.color.tokens, ...tokens.shadow.tokens].map((t) => [t.name, t.value.toLowerCase()]));

const NAMED = "(?:white|black|red|green|blue|yellow|orange|purple|pink|grey|gray|silver|gold|navy|teal|lime|olive|aqua|crimson|coral|salmon|tomato|violet|indigo|khaki|beige|ivory|tan|brown)";
const LITERAL = new RegExp(String.raw`#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:fill|stroke|color|background)\s*[:=]\s*["']?${NAMED}\b`);
/** a font family list: the app's two faces, their system fallbacks, or a font token */
const FAMILIES = /^(inherit|Oswald|Inter|Arial Narrow|Roboto Condensed|system-ui|-apple-system|Segoe UI|sans-serif|ui-monospace|SF Mono|Menlo|Consolas|monospace|var\(--font-[\w-]+\)|,|\s)+$/;

const html = (f: string) => read(join(PHONE, f)).replace(/<!--[\s\S]*?-->/g, "");
const css = () => read(join(PHONE, "phone.css")).replace(/\/\*[\s\S]*?\*\//g, "");

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

  it("agrees with the code it describes", () => {
    const designer = read(join(ROOT, "apps/web/src/designer/Designer.tsx"));
    const md = read(plan);
    for (const [name, value] of [
      ["PHONE_QUERY", "(max-width: 640px)"],
      ["TOUCH_QUERY", "(pointer: coarse)"],
    ]) {
      expect(designer).toContain(`export const ${name} = "${value}"`);
      expect(md).toContain(name);
      expect(md).toContain(value.replace(/\(|\)/g, "").replace(":", ":"));
    }
    expect(read(join(ROOT, "apps/web/src/lib/touch.ts"))).toContain("LONG_PRESS_MS = 500");
    expect(md).toContain("500 ms");
    // ADR 0005: a long press on touch never deletes
    expect(md).toContain("ADR 0005");
  });
});

describe("the mockups", () => {
  it("are the five the issue asks for, on one shared stylesheet", () => {
    const files = readdirSync(PHONE).filter((f) => f.endsWith(".html")).sort();
    expect(files).toEqual(MOCKUPS);
    expect(existsSync(join(PHONE, "phone.css"))).toBe(true);
    for (const f of MOCKUPS) expect(html(f), f).toContain('href="phone.css"');
  });

  it("are drawn at 375 px", () => {
    expect(css()).toMatch(/\.phone\s*\{[^}]*width:\s*375px/);
    for (const f of MOCKUPS) expect(html(f), f).toMatch(/<div class="phone[" ]/);
  });

  it("take every colour from tokens.json, by token name, as a custom property", () => {
    const sheet = css();
    // the stylesheet declares the tokens as --name: value; each name is a token and each value is that token's
    const declared = [...sheet.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].filter(([, , v]) => LITERAL.test(v));
    expect(declared.length).toBeGreaterThan(10);
    for (const [, name, value] of declared) {
      const token = byName.get(name.slice(2));
      expect(token, `${name} is not a token`).toBeDefined();
      expect(value.trim().toLowerCase(), name).toBe(token);
    }
    // and nothing else in it names a colour
    const rest = sheet.replace(/^\s*--[\w-]+:\s*[^;]+;/gm, "");
    expect(rest.split("\n").filter((l) => LITERAL.test(l))).toEqual([]);
    // the pages use var(--x) only, and every var is declared
    const defined = new Set([...sheet.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
    for (const f of MOCKUPS) {
      const src = html(f);
      expect(src.split("\n").filter((l) => LITERAL.test(l)), f).toEqual([]);
      const missing = [...src.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((v) => !defined.has(v));
      expect(missing, f).toEqual([]);
    }
  });

  it("use only Inter and Oswald, with system fallbacks", () => {
    let seen = 0;
    for (const f of [...MOCKUPS, "phone.css"]) {
      const src = f.endsWith(".css") ? css() : html(f);
      for (const m of src.matchAll(/font-family:\s*([^;}"]+)/g)) {
        seen++;
        expect(m[1].replace(/["']/g, ""), `${f}: ${m[0]}`).toMatch(FAMILIES);
      }
      // the font shorthand: the family list is what follows the size (and line height)
      for (const m of src.matchAll(/\bfont:\s*([^;}]+)/g)) {
        const family = m[1].replace(/^.*?\d+px(?:\/\d+px)?\s*/, "");
        seen++;
        expect(family.replace(/["']/g, ""), `${f}: ${m[0]}`).toMatch(FAMILIES);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("every control is a 44 px touch target and icon-only buttons are labelled", () => {
    const sheet = css();
    expect(sheet).toMatch(/--touch-target:\s*44px/);
    // no rule for a control sets a height under 44 px
    for (const rule of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const [, selector, body] = rule;
      if (!/button|\.tool|\.chip|\.link|\.icon-btn|\.pill|\.menu-item|\.minimap/.test(selector)) continue;
      for (const h of body.matchAll(/(?:min-)?height:\s*(\d+)px/g)) expect(Number(h[1]), `${selector.trim()}: ${h[0]}`).toBeGreaterThanOrEqual(44);
    }
    for (const f of MOCKUPS) {
      for (const el of html(f).matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        const text = el[3].replace(/<[^>]+>/g, "").trim();
        if (!text) expect(el[2], `${f}: ${el[0].slice(0, 80)}`).toMatch(/aria-label="[^"]+"/);
      }
    }
  });

  it("icons are Lucide's, by name", () => {
    const pascal = (name: string) => name.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase());
    for (const f of MOCKUPS) {
      const names = new Set<string>();
      for (const svg of html(f).matchAll(/<svg\b([^>]*)>/g)) {
        if (/class="(plan|minimap-plan)"/.test(svg[1])) continue; // the plan drawing and the mini-map are not icons
        const m = /data-lucide="([\w-]+)"/.exec(svg[1]);
        expect(m, `${f}: an svg without a Lucide name: ${svg[0].slice(0, 80)}`).not.toBeNull();
        names.add(m![1]);
      }
      expect(names.size, f).toBeGreaterThan(3);
      for (const n of names) expect(pascal(n) in lucide, `${f}: ${n} is not a Lucide icon`).toBe(true);
    }
  });

  it("stay on the designer's words: Checks, Add point, Quick and Advanced", () => {
    const all = MOCKUPS.map((f) => html(f)).join("\n");
    for (const word of ["Checks", "Add point", "Quick", "Advanced", "Submit track", "Zoom to fit"]) expect(all).toContain(word);
    expect(all).not.toMatch(/\d ?(ft|feet)\b/); // metres only
  });
});
