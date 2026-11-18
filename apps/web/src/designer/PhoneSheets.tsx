// The phone designer's sheets (#123; mockups docs/design/phone/02-selected-point.html, 03-checks-sheet.html): the
// desktop's side panels as bottom sheets on `Sheet`, above the toolbar, one at a time. Selection (opens at peek when
// something is tapped), Checks (from the checks pill, at full height, in both modes), Jump (from the toolbar's Jump)
// and How to draw; and the context sheet (#126), the actions for what a finger held. The Designer owns which sheet is
// open and its height; a drag on the plan tucks it away.
import { outerStyle, type Built } from "@track-studio/engine";
import { CornerUpLeft, Hash, Square, SquareRoundCorner, Trash2 } from "lucide-react";
import { Sheet, type SheetHeight } from "../components/Sheet.js";
import { FEATURE_LABEL } from "../lib/format.js";
import type { Draft, Selection } from "./Designer.js";
import type { Live } from "./geometry.js";
import { ConeButton, JumpPalette } from "./JumpPalette.js";
import { PhoneDetails, PhoneMenu, PhoneSave, type PhoneDetailsProps, type PhoneMenuProps, type PhoneSaveProps } from "./PhoneMenu.js";
import { allows, paletteJumps, type DesignerMode } from "./mode.js";
import { MIN_CORNERS } from "./shape.js";
import { makeHairpin } from "./snap.js";
import { ChecksPanel, SelectionPanel, Stats, type PanelProps } from "./SidePanels.js";
import { SNAP_LABEL, type ToolPaletteProps } from "./ToolPalette.js";
import { VenueCheckPanel } from "./VenueCheck.js";

/** the sheets above the toolbar, and the ⋯ menu (#124), the one modal sheet, over the toolbar too */
export type PhoneSheetKind = "selection" | "context" | "checks" | "jump" | "howto" | "save" | "details" | "menu";
/** the open sheet and its height (a sheet that closes is `null`, not "closed") */
export interface PhoneSheetOpen {
  kind: PhoneSheetKind;
  height: Exclude<SheetHeight, "closed">;
}

/** The selection sheet's name: what's selected, as its panel's heading says. */
export function sheetLabel(sel: Selection, view: DesignerMode, draft: Draft): string {
  if (sel?.kind === "point") return `${view === "quick" ? "Corner" : "Corner point"} ${sel.i + 1}`;
  if (sel?.kind === "feature") {
    const f = draft.design.features?.[sel.i];
    return f ? FEATURE_LABEL[f.type] : "Jump";
  }
  if (sel?.kind === "start") return "Start line";
  if (sel?.kind === "marshal") return `Cone ${draft.design.marshals?.[sel.i]?.number ?? ""}`.trim();
  return "Selected";
}

/** what the context sheet can do to what's held (#126) */
export type ContextActionKind = "delete" | "outer" | "hairpin" | "renumber";
export interface ContextAction {
  action: ContextActionKind;
  label: string;
  /** why it can't be done here, or undefined when it can */
  why?: string;
}

/**
 * The context sheet's actions for what a finger held: Delete; for a corner, the outside corner it doesn't have now
 * (as the O key); in Advanced, Make hairpin (as the H key). Delete is listed for the start line too, disabled with the
 * reason, so a long press always shows what it can and can't do.
 */
export function contextActions(sel: Selection, view: DesignerMode, draft: Draft, live: Pick<Live, "corners">): ContextAction[] {
  if (!sel) return [];
  if (sel.kind === "start") return [{ action: "delete", label: "Delete", why: "A track always has a start line: drag it along the track to move it." }];
  if (sel.kind === "feature") return [{ action: "delete", label: "Delete" }];
  // a cone (#151): its number is set in its sheet
  if (sel.kind === "marshal") return [{ action: "delete", label: "Delete" }, { action: "renumber", label: "Change number" }];
  const pts = draft.design.points;
  const p = pts[sel.i], c = live.corners[sel.i];
  if (!p) return [];
  const out: ContextAction[] = [{ action: "delete", label: "Delete", why: pts.length <= MIN_CORNERS ? `A track needs at least ${MIN_CORNERS} corner points.` : undefined }];
  if (c && allows(view, "outer")) out.push({ action: "outer", label: outerStyle(p, c) === "square" ? "Round outside corner" : "Square outside corner" });
  if (allows(view, "hairpin")) {
    const can = makeHairpin(pts, sel.i, draft.design.laneWidth ?? 2);
    out.push({ action: "hairpin", label: "Make hairpin", why: can ? undefined : "On a straight: there's no turn to make a hairpin of." });
  }
  return out;
}

const CONTEXT_ICON = { delete: Trash2, hairpin: CornerUpLeft, renumber: Hash } as const;

/** The context sheet's rows: a menu of 44 px+ rows, one per action, each with its reason when it can't be done. */
export function PhoneContext({ actions, label, onAction }: { actions: ContextAction[]; label: string; onAction: (a: ContextActionKind) => void }) {
  return (
    <ul className="phone-menu phone-context" role="menu" aria-label={label}>
      {actions.map((a) => {
        const Icon = a.action === "outer" ? (a.label.startsWith("Round") ? SquareRoundCorner : Square) : CONTEXT_ICON[a.action];
        return (
          <li key={a.action} role="none">
            <button type="button" role="menuitem" className={`phone-menu-item${a.action === "delete" ? " phone-menu-danger" : ""}`} disabled={!!a.why} onClick={() => onAction(a.action)}>
              <Icon size={20} aria-hidden="true" />
              <span className="phone-menu-text">
                {a.label}
                {a.why && <small>{a.why}</small>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Checks, as the Advanced tab has them, then the venue check and the figures (lap, corners, jumps). */
export function PhoneChecks({ built, ...p }: PanelProps & { built: Built }) {
  const { view, checks, bakedFeatures, pending, showSubmit, blocked, onShow, onMakeCrossover, onBridge, draft, live } = p;
  return (
    <div className="phone-checks">
      <ChecksPanel checks={checks} features={bakedFeatures} view={view} pending={pending} blocked={showSubmit ? blocked : null} ready={showSubmit && !blocked} onShow={onShow} onMakeCrossover={onMakeCrossover} onBridge={onBridge} />
      <VenueCheckPanel design={draft.design} drawnFor={draft.info.drawnFor} onShow={onShow} />
      <Stats built={built} live={live} view={view} />
    </div>
  );
}

/** The jumps as 44 px chips with their plan symbols, Start line, and the snapping last (Quick: a switch; Advanced: the radio). */
export function PhoneJumps({ view, tool, onJump, onCone, onDropCone, onDragCone, onDropJump, onDragJump, startOn, onStartLine, laneSnap, onLaneSnap, snap, onSnap }: ToolPaletteProps) {
  const advanced = view === "advanced";
  return (
    // no heading or help line, so it fits at peek height: the sheet is named "Jumps", and the hint over the plan says
    // what to do once one is picked
    <div className="phone-jump-sheet">
      <div className="phone-jumps">
        <div className="phone-jumps-group" role="group" aria-label="Jumps">
          <JumpPalette jumps={paletteJumps(view)} armed={tool.kind === "feature" ? tool.type : null} onPick={onJump} onDrop={onDropJump} onDrag={onDragJump} className="phone-chip" verb="Tap" />
        </div>
        <button type="button" className="phone-chip phone-chip-start" aria-pressed={startOn} onClick={onStartLine}>
          Start line
        </button>
        <ConeButton armed={tool.kind === "marshal"} onPick={onCone} onDrop={onDropCone} onDrag={onDragCone} className="phone-chip" verb="Tap" />
      </div>
      {advanced ? (
        <div className="field-row">
          <div className="seg seg-snap" role="radiogroup" aria-label="Snap">
            <span className="seg-label">Snap</span>
            {(["lanes", "fine", "free"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={snap === m} className={snap === m ? "on" : ""} onClick={() => onSnap(m)}>
                {SNAP_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button type="button" role="switch" aria-checked={laneSnap} className="field-row phone-switch" onClick={onLaneSnap}>
          Snap to lanes
          <span className="phone-switch-track" aria-hidden="true">
            <span className="phone-switch-thumb" />
          </span>
        </button>
      )}
    </div>
  );
}

/** How to draw, for fingers: the Quick or Advanced text with the keyboard and the mouse taken out. */
export function PhoneHowTo({ view }: { view: DesignerMode }) {
  return (
    <section className="phone-howto" aria-labelledby="howto-h">
      <h2 id="howto-h">How to draw</h2>
      {view === "quick" ? (
        <ul>
          <li>
            <b>Drag</b> a corner to move it, or its inside handle to cut the corner back. With <b>Snap to lanes</b> on (under Jump), corners snap to a lane line.
          </li>
          <li>
            <b>Tap</b> a corner, jump or the start line to select it: its sheet has its sizes and settings.
          </li>
          <li>
            <b>Add point</b>, then tap the floor or the track to add a corner: after the selected corner, or into the track it's near. It stays on until you
            tap Add point again or Select.
          </li>
          <li>
            <b>Delete</b> on the toolbar removes the selected corner or jump.
          </li>
          <li>Tap Jump, pick a jump and tap the racing line to place it, then drag it along. Pick Start line to drag the start line the same way.</li>
          <li>
            <b>Cone</b> (under Jump) puts a numbered marshal point where you tap, or drag one onto the plan. The number is the order marshals fill them;
            change it in the cone's sheet.
          </li>
          <li>Drag the floor to pan; pinch to zoom. Undo and Redo are on the toolbar.</li>
          <li>The checks pill, top right, opens the Checks.</li>
        </ul>
      ) : (
        <ul>
          <li>
            <b>Drag</b> a corner point (the small dot is the racing line; the diamond is the outside corner of the pipes). Snap, under Jump: Lanes against the
            walls and beside other lanes, Fine on a 25 cm grid, Free not at all.
          </li>
          <li>
            <b>Tap</b> a point, jump or the start line to select it: its sheet has its radius, lane width and the rest.
          </li>
          <li>
            <b>Add point</b>, then tap a straight to add a point there (or press and pull). It stays on until you tap Add point again or Select.
          </li>
          <li>
            <b>Delete</b> on the toolbar removes the selected point or jump.
          </li>
          <li>Tap Jump, pick a jump and tap the track to place it, then drag it along. Drag the start line the same way.</li>
          <li>Drag empty space to pan; pinch to zoom. Undo and Redo are on the toolbar.</li>
        </ul>
      )}
    </section>
  );
}

export interface PhoneSheetsProps {
  sheet: PhoneSheetOpen | null;
  onHeight: (h: SheetHeight) => void;
  /** a finger is dragging a handle on the plan */
  tucked: boolean;
  panels: PanelProps;
  built: Built;
  jumps: ToolPaletteProps;
  menu: PhoneMenuProps;
  save: PhoneSaveProps;
  details: PhoneDetailsProps;
  /** the context sheet (#126): an action picked for what's held */
  context: { onAction: (a: ContextActionKind) => void };
}

const LABEL: Record<Exclude<PhoneSheetKind, "selection" | "context">, string> = { checks: "Checks", jump: "Jumps", howto: "How to draw", save: "Save", details: "Layout details", menu: "More" };

/** the toolbar's height: the sheets sit above it */
const TOOLBAR = 64;

/** The open sheet, if any, above the toolbar. */
export function PhoneSheets({ sheet, onHeight, tucked, panels, built, jumps, menu, save, details, context }: PhoneSheetsProps) {
  if (!sheet) return null;
  const { kind, height } = sheet;
  const p = panels;
  const label = kind === "selection" || kind === "context" ? sheetLabel(p.sel, p.view, p.draft) : LABEL[kind];
  // the menu: modal, over a scrim that covers the plan and the toolbar, as tall as its rows
  const modal = kind === "menu";
  // the context sheet: as tall as its few rows
  const hug = modal || kind === "context";
  return (
    // one Sheet per kind (keyed), so a new kind starts at its own top and slides in
    <Sheet key={kind} label={label} height={height} onHeight={onHeight} tucked={tucked && !modal} modal={modal} hug={hug} below={modal ? 0 : TOOLBAR} className={`phone-sheet phone-sheet-${kind}`}>
      {kind === "selection" ? (
        <SelectionPanel sel={p.sel} view={p.view} draft={p.drawn} live={p.live} update={p.update} onDelete={p.onDelete} fromVenue={p.venueName} inCorner={p.inCorner} touch phone />
      ) : kind === "context" ? (
        <>
          {/* what's held, as the selection sheet's heading says */}
          <h2>{label}</h2>
          <PhoneContext actions={contextActions(p.sel, p.view, p.drawn, p.live)} label={label} onAction={context.onAction} />
        </>
      ) : kind === "checks" ? (
        <PhoneChecks {...p} built={built} />
      ) : kind === "jump" ? (
        <PhoneJumps {...jumps} />
      ) : kind === "menu" ? (
        <PhoneMenu {...menu} />
      ) : kind === "save" ? (
        <PhoneSave {...save} />
      ) : kind === "details" ? (
        <PhoneDetails {...details} />
      ) : (
        <PhoneHowTo view={p.view} />
      )}
    </Sheet>
  );
}
