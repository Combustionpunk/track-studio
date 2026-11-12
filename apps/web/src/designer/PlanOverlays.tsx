// What the designer lays over and around the plan (#120): the live region and the lane grid's keyboard target, the
// hint, the canvas with the 3D note and the 2D / 3D switch; and the tablet's checks pill, sheet and dock. They take
// props; the state is the Designer's. Pulled out of Designer.tsx unchanged.
import type { Check } from "@track-studio/engine";
import { ArrowRightLeft, CircleCheck, CircleX, Plus, Redo2, Scan, TriangleAlert, Undo2, X } from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { shapeHint } from "./addtool.js";
import type { Selection, Tool } from "./Designer.js";
import { JumpPalette } from "./JumpPalette.js";
import { startCursor, where, type LayKeys } from "./laykeys.js";
import { TURNS_HINT, type Cell, type LaneGrid } from "./lanes.js";
import { checkCounts, paletteJumps } from "./mode.js";
import { ChecksPanel, plural, SelectionPanel, type PanelProps } from "./SidePanels.js";
import type { SnapMode, SnapTag } from "./snap.js";
import { SNAP_LABEL, type ToolsProps } from "./ToolPalette.js";
import { VenueCheckPanel } from "./VenueCheck.js";

/** the plan, or the 3D preview (#85) */
export const VIEWS = ["2d", "3d"] as const;
export type View3d = (typeof VIEWS)[number];

/** step 1's keys (#47), in the hint and the lane grid's description */
export const LAY_KEYS_HELP = "Arrows move the cursor; Enter or Space starts the lane there. Then the arrows lay it a square at a time, Shift and two arrows in turn (say Up then Right) lay a diagonal, and Backspace takes back the last square.";

export interface PlanHintProps {
  /** a drag's snapping, while it's on */
  snapInfo: { mode: SnapMode; tags: SnapTag[] } | null;
  viewing3d: boolean;
  synced3d: boolean;
  tablet: boolean;
  laying: boolean;
  /** step 1's note (a refusal, what the keys did) */
  layNote: string | null;
  gridFocus: boolean;
  /** step 1: the squares painted so far */
  cells: Cell[] | undefined;
  layKeys: LayKeys | null;
  grid: LaneGrid | null;
  tool: Tool;
  advanced: boolean;
  sel: Selection;
}

/** The hint over the plan: what to do next, or the snapping while a drag is on. */
export function PlanHint({ snapInfo, viewing3d, synced3d, tablet, laying, layNote, gridFocus, cells, layKeys, grid, tool, advanced, sel }: PlanHintProps) {
  return snapInfo ? (
    <div className="designer-hint" aria-live="polite">
      <b>{SNAP_LABEL[snapInfo.mode]}</b>
      {snapInfo.tags.length > 0 && <> · {snapInfo.tags.join(" · ")}</>}
    </div>
  ) : (
    <div className="designer-hint">
      {viewing3d
        ? `3D is view only: switch to 2D to edit.${synced3d ? ` ${tablet ? "Tap" : "Click"} a jump to select it there.` : ""}`
        : laying
        ? layNote ?? (gridFocus
          ? cells?.length
            ? LAY_KEYS_HELP
            : `Cursor on ${where(layKeys?.cursor ?? startCursor(grid!))}. ${LAY_KEYS_HELP}`
          : cells?.length
          ? `Drag on through the squares, corner to corner for a diagonal, or straight across the lane at right angles. Come back to the ring to close the loop. ${TURNS_HINT}`
          : `Press on a square and drag to lay the lane, straight or diagonally. ${TURNS_HINT}`)
        : tool.kind === "feature"
          ? tool.type === "crossover"
            ? `${tablet ? "Tap" : "Click"} where the track crosses itself: the pass you ${tablet ? "tap" : "click"} goes over.`
            : `${tablet ? "Tap" : "Click"} on the racing line to place it.`
          : shapeHint({ advanced, tablet, adding: tool.kind === "add", sel: sel?.kind === "point" ? sel.i : null })}
    </div>
  );
}

export interface PlanAreaProps {
  planWrapRef: Ref<HTMLElement>;
  /** the live region's text */
  said: string;
  laying: boolean;
  grid: LaneGrid | null;
  onGridKey: (e: KeyboardEvent<HTMLDivElement>) => void;
  onGridFocus: (focused: boolean) => void;
  hint: PlanHintProps;
  /** the Add point tool is on in Quick: the cursor says so */
  adding: boolean;
  /** the plan, or the 3D view */
  plan: ReactNode;
  shown3d: boolean;
  no3d: "none" | "lost" | undefined;
  view3d: View3d;
  onView3d: (k: View3d) => void;
  /** after the canvas: the tablet's pill, sheet and dock */
  children?: ReactNode;
}

/** The plan's section: the live region, the lane grid's keyboard target, the hint, the canvas with the 3D note and the 2D / 3D switch. */
export function PlanArea({ planWrapRef, said, laying, grid, onGridKey, onGridFocus, hint, adding, plan, shown3d, no3d, view3d, onView3d, children }: PlanAreaProps) {
  return (
    <section className="designer-plan-wrap" aria-label="Plan" ref={planWrapRef}>
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      {laying && grid && (
        <div
          className="sr-only lay-keys"
          tabIndex={0}
          role="application"
          aria-label="Lane grid"
          aria-describedby="lay-keys-help"
          onKeyDown={onGridKey}
          onFocus={() => onGridFocus(true)}
          onBlur={() => onGridFocus(false)}
        >
          <span id="lay-keys-help">{LAY_KEYS_HELP}</span>
        </div>
      )}
      <PlanHint {...hint} />
      <div className={`designer-canvas ${adding ? "designer-adding" : ""}`}>
        {plan}
        {/* there while 3D is picked (an alert, so it's heard even when it comes with the region), so the plan's own
            status stays the only one */}
        {shown3d && (
          <p className={no3d ? "designer-3d-note" : "sr-only"} role="alert">
            {no3d === "lost"
              ? "The 3D view stopped: the browser lost its graphics. Here's the 2D plan; press 3D to try again."
              : no3d
                ? "The 3D view needs WebGL, which this browser doesn't have or has turned off. Here's the 2D plan."
                : ""}
          </p>
        )}
        {!laying && (
          <div className="plan-viewswitch designer-viewswitch" role="group" aria-label="View">
            {VIEWS.map((k) => (
              <button key={k} type="button" aria-pressed={view3d === k} className={view3d === k ? "on" : ""} onClick={() => onView3d(k)} title={k === "3d" ? "See the track in 3D (view only)" : "Back to the plan, to edit"}>
                {k.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** Tablet: the checks in a word, top right of the plan; tap for the list. */
export function ChecksPill({ checks, pending, open, onToggle }: { checks: Check[]; pending: boolean; open: boolean; onToggle: () => void }) {
  const { errors, warnings } = checkCounts(checks);
  const lvl = errors ? "error" : warnings ? "warning" : "ok";
  const Icon = errors ? CircleX : warnings ? TriangleAlert : CircleCheck;
  const text = pending && !errors && !warnings ? "Checking…" : errors ? plural(errors, "error") : warnings ? plural(warnings, "warning") : "No problems";
  return (
    <button type="button" className={`checks-pill checks-pill-${lvl}`} aria-expanded={open} onClick={onToggle}>
      <Icon size={18} aria-hidden="true" />
      {text}
    </button>
  );
}

/** Tablet: the sheet over the plan, with the checks or the selected thing's panel. */
export function TabletSheet({ sheet, onClose, panels }: { sheet: "selection" | "checks"; onClose: () => void; panels: PanelProps }) {
  const { view, checks, bakedFeatures, pending, showSubmit, blocked, onShow, onMakeCrossover, onBridge, draft, drawn, sel, live, update, onDelete, venueName, inCorner } = panels;
  return (
    <div className="designer-sheet" role="dialog" aria-label={sheet === "checks" ? "Checks" : "Selected"}>
      <button type="button" className="btn btn-quiet btn-icon sheet-close" aria-label="Close" onClick={onClose}>
        <X size={20} aria-hidden="true" />
      </button>
      {sheet === "checks" ? (
        <>
          <ChecksPanel checks={checks} features={bakedFeatures} view={view} pending={pending} blocked={showSubmit ? blocked : null} ready={showSubmit && !blocked} onShow={onShow} onMakeCrossover={onMakeCrossover} onBridge={onBridge} />
          <VenueCheckPanel design={draft.design} drawnFor={draft.info.drawnFor} onShow={onShow} />
        </>
      ) : (
        <SelectionPanel sel={sel} view={view} draft={drawn} live={live} update={update} onDelete={onDelete} fromVenue={venueName} inCorner={inCorner} touch />
      )}
    </div>
  );
}

export type TabletDockProps = ToolsProps & {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reverse: () => void;
  canReverse: boolean;
  reverseTitle: string;
  onFit: () => void;
};

/** Tablet: the dock of 44 px controls under the plan (#16). */
export function TabletDock({ view, laying, canStartAgain, onStartAgain, tool, onJump, onAdd, startOn, onStartLine, laneSnap, onLaneSnap, undo, redo, canUndo, canRedo, reverse, canReverse, reverseTitle, onFit }: TabletDockProps) {
  return (
    <div className="designer-dock" role="toolbar" aria-label="Designer tools">
      <button type="button" className="dock-btn dock-icon" onClick={undo} disabled={!canUndo} aria-label="Undo">
        <Undo2 size={20} aria-hidden="true" />
      </button>
      <button type="button" className="dock-btn dock-icon" onClick={redo} disabled={!canRedo} aria-label="Redo">
        <Redo2 size={20} aria-hidden="true" />
      </button>
      <span className="dock-sep" aria-hidden="true" />
      {laying ? (
        <button type="button" className="dock-btn" disabled={!canStartAgain} onClick={onStartAgain}>
          Start again
        </button>
      ) : (
        <>
          <JumpPalette jumps={paletteJumps(view)} armed={tool.kind === "feature" ? tool.type : null} onPick={onJump} className="dock-btn" verb="Tap" />
          <button type="button" className="dock-btn" aria-pressed={tool.kind === "add"} aria-keyshortcuts="A" data-add-tool onClick={onAdd} title="Add a corner: tap Add point, then tap the track or the floor">
            <Plus size={18} aria-hidden="true" />
            Add point
          </button>
          <button type="button" className="dock-btn" aria-pressed={startOn} onClick={onStartLine}>
            Start line
          </button>
          <button type="button" className="dock-btn" aria-pressed={laneSnap} onClick={onLaneSnap} title="Corners snap to a lane line within 0.2 m. Turn it off to place them freely.">
            Snap
          </button>
        </>
      )}
      {/* in the dock, not the bar, so the tablet's bar stays one row at 1024 px */}
      <button type="button" className="dock-btn" onClick={reverse} disabled={!canReverse} aria-label="Reverse direction" title={reverseTitle}>
        <ArrowRightLeft size={18} aria-hidden="true" />
        Reverse
      </button>
      <button type="button" className="dock-btn dock-icon dock-fit" onClick={onFit} aria-label="Zoom to fit">
        <Scan size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
