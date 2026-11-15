// The phone designer's sheets (#123; mockups docs/design/phone/02-selected-point.html, 03-checks-sheet.html): the
// desktop's side panels as bottom sheets on `Sheet`, above the toolbar, one at a time. Selection (opens at peek when
// something is tapped), Checks (from the checks pill, at full height, in both modes), Jump (from the toolbar's Jump)
// and How to draw. The Designer owns which sheet is open and its height; a drag on the plan tucks it away.
import type { Built } from "@track-studio/engine";
import { Sheet, type SheetHeight } from "../components/Sheet.js";
import { FEATURE_LABEL } from "../lib/format.js";
import type { Draft, Selection } from "./Designer.js";
import { JumpPalette } from "./JumpPalette.js";
import { paletteJumps, type DesignerMode } from "./mode.js";
import { ChecksPanel, SelectionPanel, Stats, type PanelProps } from "./SidePanels.js";
import { SNAP_LABEL, type ToolPaletteProps } from "./ToolPalette.js";
import { VenueCheckPanel } from "./VenueCheck.js";

export type PhoneSheetKind = "selection" | "checks" | "jump" | "howto";
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
  return "Selected";
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
export function PhoneJumps({ view, tool, onJump, startOn, onStartLine, laneSnap, onLaneSnap, snap, onSnap }: ToolPaletteProps) {
  const advanced = view === "advanced";
  return (
    // no heading or help line, so it fits at peek height: the sheet is named "Jumps", and the hint over the plan says
    // what to do once one is picked
    <div className="phone-jump-sheet">
      <div className="phone-jumps">
        <div className="phone-jumps-group" role="group" aria-label="Jumps">
          <JumpPalette jumps={paletteJumps(view)} armed={tool.kind === "feature" ? tool.type : null} onPick={onJump} className="phone-chip" verb="Tap" />
        </div>
        <button type="button" className="phone-chip phone-chip-start" aria-pressed={startOn} onClick={onStartLine}>
          Start line
        </button>
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
}

/** the toolbar's height: the sheets sit above it */
const TOOLBAR = 64;

/** The open sheet, if any, above the toolbar. */
export function PhoneSheets({ sheet, onHeight, tucked, panels, built, jumps }: PhoneSheetsProps) {
  if (!sheet) return null;
  const { kind, height } = sheet;
  const p = panels;
  const label = kind === "selection" ? sheetLabel(p.sel, p.view, p.draft) : kind === "checks" ? "Checks" : kind === "jump" ? "Jumps" : "How to draw";
  return (
    // one Sheet per kind (keyed), so a new kind starts at its own top and slides in
    <Sheet key={kind} label={label} height={height} onHeight={onHeight} tucked={tucked} below={TOOLBAR} className={`phone-sheet phone-sheet-${kind}`}>
      {kind === "selection" ? (
        <SelectionPanel sel={p.sel} view={p.view} draft={p.drawn} live={p.live} update={p.update} onDelete={p.onDelete} fromVenue={p.venueName} inCorner={p.inCorner} touch phone />
      ) : kind === "checks" ? (
        <PhoneChecks {...p} built={built} />
      ) : kind === "jump" ? (
        <PhoneJumps {...jumps} />
      ) : (
        <PhoneHowTo view={p.view} />
      )}
    </Sheet>
  );
}
