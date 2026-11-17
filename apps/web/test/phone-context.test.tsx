// The phone's long-press context sheet (#126): a small sheet of actions for the corner, corner point, jump or start
// line a finger held. Static renders per item type and mode; the long press itself, the actions and their undo are in
// e2e/phone-context.e2e.ts.
import { outerStyle, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { draftFromDoc, type Selection } from "../src/designer/Designer.js";
import { liveGeometry } from "../src/designer/geometry.js";
import { contextActions, PhoneContext, PhoneSheets } from "../src/designer/PhoneSheets.js";
import type { PanelProps } from "../src/designer/SidePanels.js";
import type { ToolPaletteProps } from "../src/designer/ToolPalette.js";

const clubA = () => JSON.parse(readFileSync(join(__dirname, "../../../reference/examples/club-a.rctrack.json"), "utf8")) as RcTrack;
const nop = () => {};

const setup = (view: "quick" | "advanced", sel: Selection, doc = clubA()) => {
  const draft = draftFromDoc(doc);
  return { sel, view, draft, live: liveGeometry(draft.design) };
};
const labels = (view: "quick" | "advanced", sel: Selection, doc?: RcTrack) => {
  const s = setup(view, sel, doc);
  return contextActions(s.sel, s.view, s.draft, s.live).map((a) => a.label);
};

describe("the context sheet's actions", () => {
  it("Quick, a corner: Delete and the other outside corner; no hairpin", () => {
    const s = setup("quick", { kind: "point", i: 2 });
    const now = outerStyle(s.draft.design.points[2], s.live.corners[2]);
    expect(labels("quick", { kind: "point", i: 2 })).toEqual(["Delete", now === "square" ? "Round outside corner" : "Square outside corner"]);
  });

  it("Advanced, a corner point: Delete, the other outside corner, Make hairpin", () => {
    const s = setup("advanced", { kind: "point", i: 2 });
    const now = outerStyle(s.draft.design.points[2], s.live.corners[2]);
    expect(labels("advanced", { kind: "point", i: 2 })).toEqual(["Delete", now === "square" ? "Round outside corner" : "Square outside corner", "Make hairpin"]);
  });

  it("offers the opposite of what the corner looks like now", () => {
    const doc = clubA();
    doc.design.points[2] = { ...doc.design.points[2], outer: "square" };
    expect(labels("quick", { kind: "point", i: 2 }, doc)).toContain("Round outside corner");
    doc.design.points[2] = { ...doc.design.points[2], outer: "round" };
    expect(labels("quick", { kind: "point", i: 2 }, doc)).toContain("Square outside corner");
  });

  it.each(["quick", "advanced"] as const)("%s, a jump: Delete only", (view) => {
    expect(labels(view, { kind: "feature", i: 0 })).toEqual(["Delete"]);
  });

  it.each(["quick", "advanced"] as const)("%s, the start line: Delete, but it can't go, and says why", (view) => {
    const s = setup(view, { kind: "start" });
    const [del, ...rest] = contextActions(s.sel, s.view, s.draft, s.live);
    expect(rest).toEqual([]);
    expect(del.action).toBe("delete");
    expect(del.why).toMatch(/start line/i);
  });

  it("a corner of a three-corner loop can't be deleted, and says why", () => {
    const doc = clubA();
    doc.design.points = doc.design.points.slice(0, 3);
    const s = setup("quick", { kind: "point", i: 0 }, doc);
    expect(contextActions(s.sel, s.view, s.draft, s.live)[0].why).toMatch(/at least 3/);
  });

  it("a point on a straight can't be made a hairpin, and says why", () => {
    const doc = clubA();
    const [a, b] = doc.design.points;
    doc.design.points.splice(1, 0, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    const s = setup("advanced", { kind: "point", i: 1 }, doc);
    const hp = contextActions(s.sel, s.view, s.draft, s.live).find((a) => a.action === "hairpin");
    expect(hp?.why).toMatch(/straight/);
  });

  it("nothing held: no actions", () => {
    expect(labels("quick", null)).toEqual([]);
  });
});

describe("the context sheet", () => {
  const html = (view: "quick" | "advanced", sel: Selection) => {
    const s = setup(view, sel);
    return renderToStaticMarkup(<PhoneContext actions={contextActions(s.sel, s.view, s.draft, s.live)} label="X" onAction={nop} />);
  };

  it.each([
    ["quick", { kind: "point", i: 2 }, 2],
    ["advanced", { kind: "point", i: 2 }, 3],
    ["quick", { kind: "feature", i: 0 }, 1],
    ["advanced", { kind: "feature", i: 1 }, 1],
    ["quick", { kind: "start" }, 1],
    ["advanced", { kind: "start" }, 1],
  ] as const)("%s, %j: a menu of %i 44 px rows with Lucide icons", (view, sel, n) => {
    const out = html(view, sel);
    expect(out).toMatch(/^<ul class="phone-menu phone-context" role="menu" aria-label="X">/);
    const rows = out.match(/<button[^>]*role="menuitem"[^>]*class="phone-menu-item[^"]*"/g) ?? [];
    expect(rows).toHaveLength(n);
    expect(out.match(/<svg[^>]*class="lucide/g)).toHaveLength(n);
    // fingers, not the mouse or keys
    expect(out).not.toMatch(/right-click|click|<kbd/i);
  });

  it("an action that can't be done is disabled, with the reason under it", () => {
    const out = html("quick", { kind: "start" });
    expect(out).toMatch(/<button[^>]*role="menuitem"[^>]*disabled=""/);
    expect(out).toMatch(/<small>[^<]*start line[^<]*<\/small>/i);
  });

  it("Delete is the danger row", () => {
    expect(html("quick", { kind: "feature", i: 0 })).toMatch(/class="phone-menu-item phone-menu-danger"[^>]*>.*Delete/);
  });
});

describe("the context sheet on PhoneSheets", () => {
  const doc = clubA();
  const draft = draftFromDoc(doc);
  const panels = (view: "quick" | "advanced", sel: Selection) =>
    ({ view, checks: [], bakedFeatures: [], pending: false, showSubmit: false, blocked: null, onShow: nop, onMakeCrossover: nop, onBridge: nop, draft, drawn: draft, sel, live: liveGeometry(draft.design), update: nop, onDelete: nop, venueName: undefined, inCorner: new Map(), checksHeading: { current: null } }) as PanelProps;
  const others = {
    jumps: {} as ToolPaletteProps,
    menu: { view: "quick" as const, onView: nop, save: { label: "Save revision", state: "Saved", disabled: true, loginUrl: null, onSave: nop }, submit: { why: null, onSubmit: nop, onSeeChecks: null }, reverse: { onReverse: nop, canReverse: true }, onFit: nop, onDetails: nop, onHowTo: nop, backTo: { to: "/t/x", label: "Back to track" } },
    save: { mode: "edit" as const, note: "", setNote: nop, onSave: nop, saving: false, revision: 1, approvedRevision: null },
    details: { name: "X", onName: nop, description: undefined, onDescription: nop, venueName: undefined, area: { length: 22, width: 12 }, status: undefined },
  };
  const sheet = (view: "quick" | "advanced", sel: Selection) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <PhoneSheets sheet={{ kind: "context", height: "peek" }} onHeight={nop} tucked={false} panels={panels(view, sel)} built={doc.built!} context={{ onAction: nop }} {...others} />
      </MemoryRouter>,
    );

  it.each([
    ["quick", { kind: "point", i: 2 }, "Corner 3"],
    ["advanced", { kind: "point", i: 2 }, "Corner point 3"],
    ["quick", { kind: "feature", i: 0 }, "Tabletop"],
    ["advanced", { kind: "start" }, "Start line"],
  ] as const)("%s, %j: a peek sheet named %s above the toolbar, not modal, its actions and no panel", (view, sel, name) => {
    const out = sheet(view, sel);
    expect(out).toMatch(new RegExp(`<section class="bottom-sheet bottom-sheet--peek[^"]*phone-sheet-context[^"]*"[^>]*role="dialog" aria-label="${name}"`));
    expect(out).not.toContain("bottom-sheet-scrim");
    expect(out).toContain(`role="menu" aria-label="${name}"`);
    expect(out).toContain(">Delete<");
    // the actions only: no fields from the selection sheet
    expect(out).not.toContain("<input");
    expect(out).not.toContain('class="sel-panel');
  });
});
