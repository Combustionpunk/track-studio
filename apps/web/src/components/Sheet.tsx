// A bottom sheet for the phone designer (#121, plan in docs/design/phone-designer.md). It slides up from the bottom of
// the screen, above a bottom toolbar if there is one, at one of two heights: peek (its content, up to about a third of
// the screen) and full (up to 72 px below the top, scrolling inside). Pull the grab bar to change height, pull it
// down past peek to close, or tap Close. The tablet's floating `.designer-sheet` is a different thing and stays so.
//
// The parent owns the height (`height` / `onHeight`), so:
// - one sheet at a time is the parent's job: keep one "which sheet" state and render one open `Sheet`;
// - `tucked` slides the sheet down to its grab bar (ticket 4 sets it while a finger drags on the plan) and, set back
//   to false, brings it back at the height it had, because the height never changed;
// - `modal` puts a scrim behind it that covers everything else (the overflow menu); a tap on the scrim closes it.
// Focus stays inside while it is full or modal; Escape closes it. With reduced motion it shows without sliding.
import { X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

export type SheetHeight = "closed" | "peek" | "full";

/** how far down from the top of the screen a full sheet reaches */
export const SHEET_TOP = 72;
/** a pull ends at the height it would reach this long after the finger lifts, so a flick carries */
const FLICK_MS = 150;
/** a pull that ends below this share of the peek height closes the sheet */
const CLOSE_AT = 0.6;
/** a finger that rests this long before it lifts has stopped: no flick */
const REST_MS = 100;
/** a grab bar touch that moves less than this is a tap (it toggles peek and full) */
const SLOP = 8;
/** the height of a tucked sheet: its grab bar */
export const TUCKED = 24;

/**
 * Where a pull of the grab bar ends: the sheet is `h` px tall when the finger lifts, moving at `v` px/ms (positive:
 * growing). Below 60 % of the peek height it closes; otherwise it goes to whichever of peek and full is nearer.
 */
export function settleSheet(h: number, v: number, peek: number, full: number): SheetHeight {
  const to = h + v * FLICK_MS;
  if (to < peek * CLOSE_AT) return "closed";
  return to - peek < full - to ? "peek" : "full";
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Pull {
  id: number;
  y0: number;
  h0: number;
  /** the last two samples, for the speed when the finger lifts */
  last: { y: number; t: number };
  prev: { y: number; t: number };
  moved: boolean;
}

export function Sheet({
  label,
  height,
  onHeight,
  tucked = false,
  modal = false,
  below = 0,
  className,
  children,
}: {
  /** the dialog's accessible name */
  label: string;
  height: SheetHeight;
  /** asked for a new height: a pull, Close, Escape, the scrim, a tap on the grab bar */
  onHeight: (h: SheetHeight) => void;
  /** slid down to its grab bar, keeping its height for when it comes back */
  tucked?: boolean;
  /** over a scrim that covers the rest of the screen; a tap on the scrim closes it */
  modal?: boolean;
  /** the height of the bottom toolbar the sheet sits above, in px (the home-indicator inset is added to it) */
  below?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const pull = useRef<Pull | null>(null);
  /** the sheet's height in px while the grab bar is being pulled */
  const [drag, setDrag] = useState<number | null>(null);
  const open = height !== "closed";
  // tucking doesn't let focus go: the sheet is back under the same finger a moment later
  const trap = open && (modal || height === "full");

  // full or modal: focus moves into the sheet, and goes back where it was when the sheet closes or lets go
  useEffect(() => {
    if (!trap) return;
    const before = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(before)) ref.current?.focus();
    return () => {
      if (before?.isConnected && (!document.activeElement || document.activeElement === document.body || ref.current?.contains(document.activeElement))) before.focus();
    };
  }, [trap]);

  // closed in the middle of a pull (Escape, another sheet): the next open starts from its own height
  useEffect(() => {
    if (open) return;
    pull.current = null;
    setDrag(null);
  }, [open]);

  if (!open) return null;

  const inset = "env(safe-area-inset-bottom, 0px)";
  const fullCss = `calc(100dvh - ${SHEET_TOP + below}px - ${inset})`;
  const style: CSSProperties = {
    bottom: `calc(${below}px + ${inset})`,
    maxHeight: drag !== null || height === "full" ? fullCss : `min(calc(100dvh / 3), ${fullCss})`,
    height: tucked ? TUCKED : (drag ?? (height === "full" ? fullCss : undefined)),
  };

  /**
   * The peek and full heights in px, as they are on screen right now: full from the bottom (which includes the
   * home-indicator inset), peek the content's own height up to a third of the screen, so a short sheet isn't closed by
   * a pull that ends above its own peek height.
   */
  const heights = () => {
    const vh = window.innerHeight, el = ref.current!;
    const full = vh - SHEET_TOP - (parseFloat(getComputedStyle(el).bottom) || below);
    const body = el.querySelector(".bottom-sheet-body")!;
    const content = el.offsetHeight - body.clientHeight + body.scrollHeight;
    return { peek: Math.min(vh / 3, content, full), full };
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || tucked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = { y: e.clientY, t: e.timeStamp };
    pull.current = { id: e.pointerId, y0: e.clientY, h0: ref.current!.getBoundingClientRect().height, last: now, prev: now, moved: false };
  };
  const move = (e: PointerEvent) => {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.abs(e.clientY - p.y0) < SLOP) return;
    p.moved = true;
    p.prev = p.last;
    p.last = { y: e.clientY, t: e.timeStamp };
    setDrag(Math.max(0, Math.min(heights().full, p.h0 - (e.clientY - p.y0))));
  };
  const up = (e: PointerEvent) => {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    pull.current = null;
    setDrag(null);
    if (e.type !== "pointerup") return;
    if (!p.moved) return onHeight(height === "full" ? "peek" : "full");
    const { peek, full } = heights();
    // the speed of the last move, unless the finger rested before it lifted
    const dt = p.last.t - p.prev.t;
    const v = dt > 0 && e.timeStamp - p.last.t < REST_MS ? -(p.last.y - p.prev.y) / dt : 0;
    const h = Math.max(0, Math.min(full, p.h0 - (e.clientY - p.y0)));
    const to = settleSheet(h, v, peek, full);
    if (to !== height) onHeight(to);
  };

  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return onHeight("closed");
    }
    if (e.key !== "Tab" || !trap) return;
    const all = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!all.length) return e.preventDefault();
    const first = all[0], last = all[all.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const cls = ["bottom-sheet", `bottom-sheet--${height}`, tucked && "bottom-sheet--tucked", drag !== null && "bottom-sheet--dragging", modal && "bottom-sheet--modal", className].filter(Boolean).join(" ");
  return (
    <>
      {modal && <div className="bottom-sheet-scrim" aria-hidden="true" onClick={() => onHeight("closed")} />}
      <section ref={ref} className={cls} style={style} role="dialog" aria-label={label} aria-modal={modal || undefined} tabIndex={-1} onKeyDown={keys}>
        <div className="bottom-sheet-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
          <button type="button" className="bottom-sheet-handle" aria-label={height === "full" ? "Peek height" : "Full height"} tabIndex={tucked ? -1 : undefined} onClick={(e) => e.detail === 0 && onHeight(height === "full" ? "peek" : "full")}>
            <span className="bottom-sheet-bar" aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-quiet bottom-sheet-close" aria-label="Close" tabIndex={tucked ? -1 : undefined} onPointerDown={(e) => e.stopPropagation()} onClick={() => onHeight("closed")}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="bottom-sheet-body" inert={tucked || undefined}>
          {children}
        </div>
      </section>
    </>
  );
}
