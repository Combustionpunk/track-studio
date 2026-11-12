// The phone's bottom sheet (#121): what it renders in each state, where a pull of the grab bar ends, and the
// stylesheet rules it relies on (above the toolbar, the home-indicator inset, reduced motion, the tablet sheet left alone).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { settleSheet, Sheet, SHEET_TOP, TUCKED, type SheetHeight } from "../src/components/Sheet.js";

const render = (height: SheetHeight, more: { tucked?: boolean; modal?: boolean; below?: number } = {}) =>
  renderToStaticMarkup(
    <Sheet label="Corner 7" height={height} onHeight={() => {}} {...more}>
      <p>Content</p>
    </Sheet>,
  );
const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");
const rule = (sel: string) => css.split("\n").find((l) => l.startsWith(`${sel} {`)) ?? "";

describe("Sheet: each state", () => {
  it("closed: nothing at all", () => {
    expect(render("closed")).toBe("");
    expect(render("closed", { modal: true })).toBe("");
  });

  it("peek: a labelled dialog with the grab bar, a Close button and the content, up to a third of the screen", () => {
    const html = render("peek", { below: 64 });
    expect(html).toMatch(/<section class="bottom-sheet bottom-sheet--peek"[^>]*role="dialog"[^>]*aria-label="Corner 7"/);
    expect(html).not.toContain("aria-modal");
    expect(html).toContain('class="bottom-sheet-bar"');
    expect(html).toMatch(/<button type="button" class="btn btn-quiet bottom-sheet-close" aria-label="Close">/);
    expect(html).toContain('aria-label="Full height"');
    expect(html).toContain("<p>Content</p>");
    expect(html).toContain(`max-height:min(calc(100dvh / 3), calc(100dvh - ${SHEET_TOP + 64}px - env(safe-area-inset-bottom, 0px)))`);
    expect(html).not.toMatch(/style="[^"]*;height:/);
    expect(html).not.toContain("bottom-sheet-scrim");
  });

  it("full: up to 72 px below the top of the screen, above the toolbar and the home-indicator strip", () => {
    const html = render("full", { below: 64 });
    expect(html).toContain("bottom-sheet--full");
    expect(html).toContain("bottom:calc(64px + env(safe-area-inset-bottom, 0px))");
    expect(html).toContain("height:calc(100dvh - 136px - env(safe-area-inset-bottom, 0px))");
    expect(html).toContain('aria-label="Peek height"');
  });

  it("with no toolbar it sits on the home-indicator inset", () => {
    expect(render("peek")).toContain("bottom:calc(0px + env(safe-area-inset-bottom, 0px))");
  });

  it("tucked: down to its grab bar, the content out of reach, and the height it had kept", () => {
    for (const h of ["peek", "full"] as const) {
      const html = render(h, { tucked: true });
      expect(html).toContain(`bottom-sheet--${h} bottom-sheet--tucked`);
      expect(html).toContain(`height:${TUCKED}px`);
      expect(html).toMatch(/class="bottom-sheet-body" inert=""/);
    }
    expect(render("peek")).not.toContain("inert");
  });

  it("modal: over a scrim, marked aria-modal", () => {
    const html = render("peek", { modal: true });
    expect(html).toMatch(/^<div class="bottom-sheet-scrim" aria-hidden="true"><\/div><section class="bottom-sheet bottom-sheet--peek bottom-sheet--modal"/);
    expect(html).toContain('aria-modal="true"');
  });
});

describe("settleSheet: where a pull of the grab bar ends", () => {
  const peek = 270, full = 610;
  it("goes to the nearer of peek and full when the finger stops", () => {
    expect(settleSheet(300, 0, peek, full)).toBe("peek");
    expect(settleSheet(500, 0, peek, full)).toBe("full");
    expect(settleSheet(full, 0, peek, full)).toBe("full");
  });
  it("closes when pulled down past peek", () => {
    expect(settleSheet(150, 0, peek, full)).toBe("closed");
    expect(settleSheet(170, 0, peek, full)).toBe("peek");
  });
  it("a flick carries: up to full, down to closed", () => {
    expect(settleSheet(320, 2, peek, full)).toBe("full");
    expect(settleSheet(240, -1, peek, full)).toBe("closed");
  });
});

describe("the stylesheet", () => {
  it("fixed to the bottom of the screen, the grab bar owns its touches (no scroll, no pull-to-refresh)", () => {
    expect(rule(".bottom-sheet")).toContain("position: fixed");
    expect(rule(".bottom-sheet-grab")).toContain("touch-action: none");
    expect(rule(".bottom-sheet-body")).toContain("overscroll-behavior: contain");
    expect(rule(".bottom-sheet-close")).toMatch(/width: var\(--touch-target\); height: var\(--touch-target\)/);
  });
  it("reduced motion: no slide, no height animation", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .bottom-sheet { animation: none; transition: none; } }");
  });
  it("the tablet's floating sheet is not on it", () => {
    expect(css).not.toMatch(/\.designer-sheet[^{}\n]*\.bottom-sheet|\.bottom-sheet[^{}\n]*\.designer-sheet/);
    expect(rule(".designer-sheet")).toContain("position: absolute; top: 72px; right: 16px;");
  });
});
