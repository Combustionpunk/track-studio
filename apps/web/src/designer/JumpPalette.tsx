// The designer's jump palette: one button per jump, each with its plan symbol (28 × 16, plan-jump / plan-jump-edge,
// as in docs/design/mockups/Designer.dc.html) and its name. Pick one, then click on the racing line to place it.
import type { FeatureType } from "@track-studio/engine";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  crossover: "M1 14 L8 4 H20 L27 14 H21 V9 H7 V14 Z", // ramp up, flat top, ramp down, with the under pass beneath
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
          title={t === "crossover" ? `${verb} where the track crosses itself to bridge it with a crossover` : `${verb} on the racing line to place a ${FEATURE_LABEL[t].toLowerCase()}`}
        >
          <JumpSymbol type={t} />
          {FEATURE_LABEL[t]}
        </button>
      ))}
    </>
  );
}

/** A traffic cone, in the jump symbols' 28 × 16 box: base, body and a band (#151). */
export function ConeSymbol() {
  return (
    <svg className="jump-symbol cone-symbol" width="28" height="16" viewBox="0 0 28 16" aria-hidden="true" focusable="false">
      <path d="M7 15 H21 V13.5 H7 Z M10.5 13 L13 2 H15 L17.5 13 Z" />
      <path className="cone-band" d="M11.8 7.5 H16.2 L16.7 9.5 H11.3 Z" />
    </svg>
  );
}

/** a press on the Cone button that moves this far (px) is a drag from the palette, not a click */
const DRAG_PX = 8;

/**
 * The Cone button (#151): a click (or tap) arms it, then a click or tap on the plan places a marshal point, as a jump
 * is placed; or press it and drag a cone onto the plan, letting go where the marshal stands. `onDrop` says whether the
 * drop landed on the plan (and placed a cone); `onDrag` follows the pointer, so the plan can show where it would go.
 */
export function ConeButton({ armed, onPick, onDrop, onDrag, className = "palette-btn", verb = "Click" }: { armed: boolean; onPick: () => void; onDrop?: (clientX: number, clientY: number) => boolean; onDrag?: (clientX: number, clientY: number) => void; className?: string; verb?: "Click" | "Tap" }) {
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  /** the click that ends a drag from the palette isn't a pick */
  const dragged = useRef(false);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!onDrop || e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
    let moving = false;
    dragged.current = false;
    // keep the pointer's events coming to the page while it's dragged over the plan (a finger's go to the button)
    if (e.pointerType !== "mouse") (e.currentTarget as Element).releasePointerCapture?.(id);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
      moving = true;
      ev.preventDefault();
      setGhost({ x: ev.clientX, y: ev.clientY });
      onDrag?.(ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      end();
      if (!moving) return;
      // the drop is the cone's, not a tap on what's under it (the plan would take it as a tap on the floor)
      ev.stopPropagation();
      dragged.current = true;
      if (ev.type === "pointerup") onDrop(ev.clientX, ev.clientY);
      else onDrag?.(-1, -1);
    };
    const end = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      setGhost(null);
      stop.current = () => {};
    };
    stop.current = end;
    // in the capture phase, ahead of the page's own handlers: the drop is seen before anything it lands on can react
    window.addEventListener("pointermove", move, { passive: false, capture: true });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  };
  return (
    <>
      <button
        type="button"
        className={`${className} cone-btn`}
        aria-pressed={armed}
        data-cone-tool
        onPointerDown={down}
        onClick={() => {
          if (dragged.current) return void (dragged.current = false);
          onPick();
        }}
        title={`${verb} where a marshal stands to put a numbered cone there, or drag a cone onto the plan`}
      >
        <ConeSymbol />
        Cone
      </button>
      {ghost &&
        createPortal(
          <div className="cone-drag-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
            <ConeSymbol />
          </div>,
          document.body,
        )}
    </>
  );
}
