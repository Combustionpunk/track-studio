// The laptop's left-hand column (#120): step 1's help, or the jumps and the track tools (Add point, Start line, the
// snapping). The tablet's dock shows the same tools, so they share ToolsProps.
import type { FeatureType } from "@track-studio/engine";
import { Plus } from "lucide-react";
import * as fmt from "../lib/format.js";
import type { Tool } from "./Designer.js";
import { JumpPalette } from "./JumpPalette.js";
import { TURNS_HINT } from "./lanes.js";
import { paletteJumps, type DesignerMode } from "./mode.js";
import type { SnapMode } from "./snap.js";

export const SNAP_LABEL: Record<SnapMode, string> = { lanes: "Lanes", fine: "Fine", free: "Free" };

/** The tools the palette and the tablet's dock share. */
export interface ToolsProps {
  view: DesignerMode;
  laying: boolean;
  /** step 1: there's a lane to take up */
  canStartAgain: boolean;
  onStartAgain: () => void;
  tool: Tool;
  /** a jump picked: armed, or let go if it was armed already */
  onJump: (t: FeatureType) => void;
  /** the Add point tool on, or off again */
  onAdd: () => void;
  /** the start line is selected */
  startOn: boolean;
  onStartLine: () => void;
  /** Quick: corners snap to lane lines */
  laneSnap: boolean;
  onLaneSnap: () => void;
}

export type ToolPaletteProps = ToolsProps & { snap: SnapMode; onSnap: (m: SnapMode) => void };

export function ToolPalette({ view, laying, canStartAgain, onStartAgain, tool, onJump, onAdd, startOn, onStartLine, laneSnap, onLaneSnap, snap, onSnap }: ToolPaletteProps) {
  const advanced = view === "advanced";
  if (laying)
    return (
      <aside className="designer-palette" aria-label="Lay the lanes">
        <span className="label">1 · Lay the lanes</span>
        <p className="lay-help">Press on a square and drag through the squares in driving order, straight or corner to corner for a diagonal. Drag back to take squares up.</p>
        <p className="lay-help">To cross the lane (a figure of eight), go straight across it at right angles. Add a crossover there once the loop is closed.</p>
        <p className="lay-help">Come back to the first square (the ring) to close the loop.</p>
        <p className="lay-help">Keyboard: Tab to the plan's lane grid; the hint over the plan lists the keys.</p>
        <p className="lay-help">{TURNS_HINT}</p>
        <button type="button" className="palette-btn" disabled={!canStartAgain} onClick={onStartAgain} title="Take up the whole lane (Undo brings it back)">
          Start again
        </button>
      </aside>
    );
  return (
    <aside className="designer-palette" aria-label="Add to the track">
      <span className="label">Jumps</span>
      <JumpPalette jumps={paletteJumps(view)} armed={tool.kind === "feature" ? tool.type : null} onPick={onJump} />
      <span className="label label-gap">Track</span>
      <button
        type="button"
        className="palette-btn"
        aria-pressed={tool.kind === "add"}
        aria-keyshortcuts="A"
        data-add-tool
        onClick={onAdd}
        title={advanced ? "Add a point: click a straight (A; Esc to stop)" : "Add a corner: click the track or the floor (A; Esc to stop)"}
      >
        <Plus size={18} aria-hidden="true" />
        Add point
      </button>
      <button type="button" className="palette-btn" aria-pressed={startOn} onClick={onStartLine} title="Select the start line, then drag it along the track">
        Start line
      </button>
      {!advanced && (
        <button type="button" className="palette-btn" aria-pressed={laneSnap} onClick={onLaneSnap} title="Corners snap to a lane line within 0.2 m. Turn it off (or hold Alt) to place them freely.">
          Snap to lanes
        </button>
      )}
      {advanced && (
        <div className="seg seg-snap" role="radiogroup" aria-label="Snap">
          <span className="label">Snap</span>
          {(["lanes", "fine", "free"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={snap === m}
              className={snap === m ? "on" : ""}
              onClick={() => onSnap(m)}
              title={m === "lanes" ? "Lanes: points on the lane grid, lanes against the walls and beside each other" : m === "fine" ? "Fine: 25 cm grid and 45° (hold Shift)" : "Free: no snapping (hold Alt)"}
            >
              {SNAP_LABEL[m]}
            </button>
          ))}
          <span className="snap-info">Shift: fine · Alt: free</span>
        </div>
      )}
      <p className="palette-help">
        {tool.kind === "feature"
          ? tool.type === "crossover"
            ? "Click where the track crosses itself to bridge it: the pass you click goes over. Esc to cancel."
            : `Click on the racing line to place the ${fmt.FEATURE_LABEL[tool.type].toLowerCase()}. Esc to cancel.`
          : tool.kind === "add"
            ? advanced
              ? "Click a straight to add a point there. Esc or A to stop. Keys: N / P pick a corner, Enter adds a point halfway to the next."
              : "Click the track or the floor to add a corner. Esc or A to stop. Keys: N / P pick a corner, Enter adds one halfway to the next."
            : "Pick a jump, then click on the racing line to place it. Add point (A) adds a corner point."}
      </p>
    </aside>
  );
}
