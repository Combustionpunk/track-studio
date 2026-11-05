// The designer's jump palette: one button per jump, each with its plan symbol (28 × 16, plan-jump / plan-jump-edge,
// as in docs/design/mockups/Designer.dc.html) and its name. Pick one, then click on the racing line to place it.
import type { FeatureType } from "@track-studio/engine";
import { FEATURE_LABEL } from "../lib/format.js";

/** Side-on outline of each jump, in a 28 × 16 box with the ground at y = 14 */
const SYMBOL: Record<FeatureType, string> = {
  tabletop: "M2 14 L8 4 H20 L26 14 Z",
  double: "M1 14 L7 3 L12 14 Z M16 14 L21 3 L27 14 Z",
  kicker: "M4 14 L22 3 V14 Z",
  stepup: "M2 14 L10 6 H26 V14 Z",
  stepdown: "M2 14 V6 H18 L26 14 Z",
  whoops: "M1 14 Q4 6 7 14 Q10 6 13 14 Q16 6 19 14 Q22 6 25 14 Z",
  bump: "M6 14 Q14 4 22 14 Z",
};

export function JumpSymbol({ type }: { type: FeatureType }) {
  return (
    <svg className="jump-symbol" width="28" height="16" viewBox="0 0 28 16" aria-hidden="true" focusable="false">
      <path d={SYMBOL[type]} />
    </svg>
  );
}

export function JumpPalette({ jumps, armed, onPick, className = "palette-btn", verb = "Click" }: { jumps: FeatureType[]; armed: FeatureType | null; onPick: (t: FeatureType) => void; className?: string; verb?: "Click" | "Tap" }) {
  return (
    <>
      {jumps.map((t) => (
        <button
          key={t}
          type="button"
          className={className}
          aria-pressed={armed === t}
          onClick={() => onPick(t)}
          title={`${verb} on the racing line to place a ${FEATURE_LABEL[t].toLowerCase()}`}
        >
          <JumpSymbol type={t} />
          {FEATURE_LABEL[t]}
        </button>
      ))}
    </>
  );
}
