// Interactive 2D plan drawn from `built` (+ area, obstacles). Pan by dragging, zoom with the wheel / pinch /
// double-click / buttons, toggle layers, hover jumps, checks and obstacles for details. Two fingers pinch and pan
// wherever they land, handles included, and nothing under them gets the touch (#16).
import { niceLength, planLayers, type Area, type Built, type Check, type DesignFeature, type Obstacle, type PlanLayer, type Point2, type Side } from "@track-studio/engine";
import { Layers as LayersIcon, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FEATURE_LABEL, metres } from "../lib/format.js";
import { useElementSize } from "../lib/hooks.js";
import { areaBounds, fitView, pan, viewBox, zoomAt, type View } from "../lib/plan.js";
import { Fingers, pinchView, TAP_SLOP_PX, type Spot } from "../lib/touch.js";

export type LayerKey = PlanLayer;
export type Layers = Record<LayerKey, boolean>;

export const LAYERS: { key: LayerKey; label: string }[] = [
  { key: "lanes", label: "Lanes" },
  { key: "dividers", label: "Pipes" },
  { key: "racingLine", label: "Racing line" },
  { key: "features", label: "Jumps" },
  { key: "start", label: "Start / finish" },
  { key: "checks", label: "Checks" },
  { key: "obstacles", label: "Obstacles" },
  { key: "rostrum", label: "Rostrum" },
  { key: "grid", label: "1 m / 5 m grid" },
];

export const DEFAULT_LAYERS: Layers = { lanes: true, racingLine: true, dividers: true, features: true, start: true, checks: true, obstacles: true, grid: true, rostrum: true };

export interface PlanViewProps {
  area: Area;
  obstacles?: Obstacle[];
  built?: Built;
  /** used when there's no built (venue plans) */
  rostrum?: { side: Side; x: number; z: number };
  /** to show each jump's distance along the line */
  designFeatures?: DesignFeature[];
  layers?: Layers;
  onLayersChange?: (l: Layers) => void;
  /** plan point to centre on and mark (e.g. a selected check) */
  highlight?: Point2 | null;
  /** embed mode: smaller controls; the wheel only zooms with Ctrl/⌘ so the page still scrolls */
  compact?: boolean;
  /** static picture, no pan/zoom/hover */
  interactive?: boolean;
  label: string;
  className?: string;
  /** extra content in plan space (svg units = metres, y = -z) */
  children?: ReactNode;
  /** the editor overlay draws the check marks (with their data-tip hooks), so the plan leaves them out but keeps their
   * hover details */
  checksInOverlay?: boolean;
  /** editor layer drawn on top; gets the size of one screen pixel in metres (for constant-size handles) */
  overlay?: (mPerPx: number) => ReactNode;
  /** wheel over an element marked data-wheel: return true if handled (then it doesn't zoom) */
  onHandleWheel?: (e: WheelEvent, el: Element) => boolean;
  /** click (no drag) on the plan where there's no handle; the event says where */
  onBackgroundClick?: (e: React.PointerEvent<SVGSVGElement>) => void;
  /** a second finger landed: whatever the first finger started (a drag, painting) should be taken back */
  onSecondFinger?: () => void;
  /** changing it fits the plan to the box again (an outside zoom-to-fit button) */
  fitRequest?: number;
  /** the zoom / fit / layers buttons on the plan (off where the page has its own) */
  controls?: boolean;
}

const MAX_SCALE = 400; // px per metre

export function PlanView(props: PlanViewProps) {
  const { area, obstacles = [], built, layers = DEFAULT_LAYERS, onLayersChange, highlight, compact = false, interactive = true, label, className, children, overlay, onHandleWheel, onBackgroundClick, onSecondFinger, fitRequest, controls = true } = props;
  const [boxRef, box] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const bounds = useMemo(() => areaBounds(area), [area]);
  const fitted = useMemo(() => (box.width && box.height ? fitView(bounds, box.width, box.height) : null), [bounds, box.width, box.height]);
  const [view, setView] = useState<View | null>(null);
  const moved = useRef(false);
  const [tip, setTip] = useState<{ x: number; y: number; key: string } | null>(null);
  const [hint, setHint] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  // fit on first layout and whenever the box or area changes, unless the user has moved the view
  useEffect(() => {
    if (fitted && (!moved.current || !view)) setView(fitted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted]);

  const v = view ?? fitted;
  const minScale = (fitted?.s ?? 1) * 0.5;

  const reset = useCallback(() => {
    moved.current = false;
    if (fitted) setView(fitted);
  }, [fitted]);

  useEffect(() => {
    if (fitRequest) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  const zoomBy = useCallback(
    (factor: number, px = box.width / 2, py = box.height / 2) => {
      moved.current = true;
      setView((cur) => (cur ? zoomAt(cur, factor, px, py, box.width, box.height, minScale, MAX_SCALE) : cur));
    },
    [box.width, box.height, minScale],
  );

  // centre on a highlighted point
  useEffect(() => {
    if (!highlight || !fitted) return;
    moved.current = true;
    setView((cur) => ({ cx: highlight[0], cy: -highlight[1], s: Math.max(cur?.s ?? fitted.s, fitted.s * 2) }));
  }, [highlight, fitted]);

  // wheel zoom (non-passive listener so the page doesn't scroll while zooming)
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !interactive) return;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      const handle = (e.target as Element).closest?.("[data-wheel]");
      if (handle && onHandleWheel?.(e, handle)) {
        e.preventDefault();
        return;
      }
      if (compact && !(e.ctrlKey || e.metaKey)) {
        setHint(true);
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => setHint(false), 1500);
        return;
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(Math.exp(-delta * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      clearTimeout(hintTimer);
    };
  }, [zoomBy, compact, interactive, onHandleWheel]);

  // in an editor, touches on the plan are all handled as pointer events; the click a browser sends after a tap would
  // land on whatever the tap just opened under the finger (a panel's Delete button), so touches there make none
  // (plans you only look at keep it, for double-tap zoom)
  const hasView = !!v, editing = !!overlay;
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !interactive || !editing) return;
    const noClick = (e: TouchEvent) => e.cancelable && e.preventDefault();
    el.addEventListener("touchend", noClick, { passive: false });
    return () => el.removeEventListener("touchend", noClick);
  }, [interactive, hasView, editing]);

  // drag to pan (one finger or the mouse, on empty floor)
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pressedAt = useRef<Spot>({ x: 0, y: 0 });
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive || e.button > 0) return;
    if ((e.target as Element).closest("[data-handle]")) return; // the editor's handles take this pointer
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pressedAt.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
  };

  // two fingers: pinch and pan, seen in the capture phase so it works over handles too; once a second finger lands,
  // nothing else on the plan gets these fingers until they're all up
  const fingers = useRef(new Fingers());
  const spots = useRef(new Map<number, Spot>());
  const onTouchDown = (e: React.PointerEvent) => {
    if (!interactive || e.pointerType !== "touch") return;
    if (e.isPrimary) {
      // no other finger is down: forget any whose lift we never saw (it lifted off the plan after its handle went)
      fingers.current = new Fingers();
      spots.current.clear();
    }
    const second = fingers.current.press(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    spots.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (second) {
      pointers.current.clear(); // a one-finger pan stops
      dragged.current = true; // and lifting the fingers isn't a tap
      setTip(null);
      onSecondFinger?.();
    }
    if (fingers.current.multi) e.stopPropagation();
  };
  const onTouchMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const before = spots.current.get(e.pointerId);
    if (!before) return;
    const r = e.currentTarget.getBoundingClientRect();
    const now = { x: e.clientX - r.left, y: e.clientY - r.top };
    // follow a lone finger too, so a pinch that starts mid-drag starts from where the fingers are
    spots.current.set(e.pointerId, now);
    if (!fingers.current.multi) return;
    e.stopPropagation();
    const other = [...spots.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (!other) return; // the finger left after a pinch: nothing
    moved.current = true;
    setView((cur) => (cur ? pinchView(cur, [before, other], [now, other], box.width, box.height, minScale, MAX_SCALE) : cur));
  };
  const onTouchUp = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const multi = fingers.current.multi;
    fingers.current.lift(e.pointerId);
    spots.current.delete(e.pointerId);
    if (multi) {
      pointers.current.delete(e.pointerId);
      e.stopPropagation();
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (prev) {
      const next = { x: e.clientX, y: e.clientY };
      if (ps.size === 1) {
        const dx = next.x - prev.x, dy = next.y - prev.y;
        // a finger wobbles: a touch is a tap until it has moved TAP_SLOP_PX from where it landed
        const starts = e.pointerType === "mouse" ? Math.hypot(dx, dy) > 2 : Math.hypot(next.x - pressedAt.current.x, next.y - pressedAt.current.y) > TAP_SLOP_PX;
        if (dragged.current || starts) {
          dragged.current = true;
          moved.current = true;
          setTip(null);
          setView((cur) => (cur ? pan(cur, dx, dy) : cur));
        } else return;
      }
      ps.set(e.pointerId, next);
      return;
    }
    // hover details
    if (!interactive) return;
    const target = (e.target as Element).closest("[data-tip]");
    const key = target?.getAttribute("data-tip");
    setTip(key ? { x: e.clientX - r.left, y: e.clientY - r.top, key } : null);
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const ours = pointers.current.delete(e.pointerId);
    if (ours && !dragged.current && !(e.target as Element).closest("[data-handle]")) onBackgroundClick?.(e);
    // a tap (no drag) on a touch screen shows the details too
    if (!dragged.current && e.pointerType !== "mouse") {
      const r = e.currentTarget.getBoundingClientRect();
      const key = (e.target as Element).closest("[data-tip]")?.getAttribute("data-tip");
      setTip(key ? { x: e.clientX - r.left, y: e.clientY - r.top, key } : null);
    }
  };
  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const r = e.currentTarget.getBoundingClientRect();
    zoomBy(e.shiftKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive) return;
    const step = 60;
    const keys: Record<string, () => void> = {
      "+": () => zoomBy(1.5),
      "=": () => zoomBy(1.5),
      "-": () => zoomBy(1 / 1.5),
      "0": reset,
      ArrowLeft: () => setView((c) => (c ? pan(c, step, 0) : c)),
      ArrowRight: () => setView((c) => (c ? pan(c, -step, 0) : c)),
      ArrowUp: () => setView((c) => (c ? pan(c, 0, step) : c)),
      ArrowDown: () => setView((c) => (c ? pan(c, 0, -step) : c)),
    };
    const f = keys[e.key];
    if (f) {
      e.preventDefault();
      moved.current = true;
      f();
    }
  };

  // ---------------------------------------------------------------- tooltips
  const tips = useMemo(() => {
    const t = new Map<string, ReactNode>();
    built?.features.forEach((f, i) => {
      const d = props.designFeatures?.[i];
      t.set(
        `f${i}`,
        <>
          <strong>{FEATURE_LABEL[f.type] ?? f.type}</strong>
          <span>
            {metres(f.length)} long · {Math.round(f.height * 100)} cm high
          </span>
          {d && <span>{metres(d.distance)} from point 0</span>}
        </>,
      );
    });
    built?.checks.forEach((c: Check, i) =>
      t.set(
        `c${i}`,
        <>
          <strong className={`lvl-${c.level}`}>{c.level === "error" ? "Error" : c.level === "warning" ? "Warning" : "Note"}</strong>
          <span>{c.message}</span>
        </>,
      ),
    );
    obstacles.forEach((o, i) =>
      t.set(
        `o${i}`,
        <>
          <strong>{o.label || (o.type === "circle" ? "Obstacle" : "Keep-out area")}</strong>
          <span>{o.type === "circle" ? `${metres(o.radius * 2)} across` : `${metres(o.length)} × ${metres(o.width)}`}</span>
        </>,
      ),
    );
    if (built?.startLine)
      t.set(
        "start",
        <>
          <strong>Start / finish</strong>
          <span>{metres(built.startLine.distance)} from point 0</span>
        </>,
      );
    const r = props.rostrum;
    if (r)
      t.set(
        "rostrum",
        <>
          <strong>Rostrum</strong>
          <span>{r.side} side</span>
        </>,
      );
    return t;
  }, [built, obstacles, props.designFeatures, props.rostrum]);

  // ---------------------------------------------------------------- drawing
  // The plan itself comes from the engine's shared renderer (the same drawing as the PNG previews and the embed);
  // this component adds the view, hover details, controls and editor overlays on top.
  const px = v ? 1 / v.s : 0.05; // one screen pixel in metres
  const pxStep = 2 ** (Math.round(Math.log2(px) * 4) / 4); // redraw hairlines in ~19% zoom steps, not on every wheel tick
  const uid = useId().replace(/[^\w-]/g, "");
  const scene = useMemo(() => ({ area, obstacles, built, rostrum: props.rostrum }), [area, obstacles, built, props.rostrum]);
  const drawn = useMemo(() => (props.checksInOverlay ? { ...layers, checks: false } : layers), [layers, props.checksInOverlay]);
  const drawing = useMemo(() => planLayers(scene, { px: pxStep, layers: drawn, tips: interactive, id: `plan${uid}` }), [scene, pxStep, drawn, interactive, uid]);
  const scaleBar = v ? niceLength(120 / v.s) : 1;

  return (
    <div
      ref={boxRef}
      className={`plan ${compact ? "plan-compact" : ""} ${className ?? ""}`}
      style={{ "--plan-ratio": `${bounds.x1 - bounds.x0} / ${bounds.y1 - bounds.y0}` } as React.CSSProperties}
      onPointerDownCapture={onTouchDown}
      onPointerMoveCapture={onTouchMove}
      onPointerUpCapture={onTouchUp}
      onPointerCancelCapture={onTouchUp}
    >
      {v && (
        <svg
          ref={svgRef}
          className="plan-svg"
          viewBox={viewBox(v, box.width, box.height)}
          role="img"
          aria-label={label}
          tabIndex={interactive ? 0 : -1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => !pointers.current.size && setTip(null)}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
        >
          <g className="plan-drawing" dangerouslySetInnerHTML={{ __html: drawing }} />
          {children}
          {overlay?.(px)}
          {highlight && (
            <circle cx={highlight[0]} cy={-highlight[1]} r={Math.max(0.8, 14 * px)} className="plan-highlight" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      )}

      {interactive && v && controls && (
        <>
          <div className="plan-controls" role="toolbar" aria-label="Plan view">
            <button type="button" onClick={() => zoomBy(1.5)} aria-label="Zoom in" title="Zoom in (+)">
              <ZoomIn size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out (−)">
              <ZoomOut size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={reset} aria-label="Fit to view" title="Fit (0)">
              <Scan size={18} aria-hidden="true" />
            </button>
            {onLayersChange && (
              <button type="button" onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} aria-label="Layers" title="Layers" className={layersOpen ? "on" : ""}>
                <LayersIcon size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          {layersOpen && onLayersChange && (
            <div className="plan-layers" role="group" aria-label="Layers">
              {LAYERS.filter((l) => built || ["obstacles", "grid", "rostrum"].includes(l.key)).map((l) => (
                <label key={l.key}>
                  <input type="checkbox" checked={layers[l.key]} onChange={(e) => onLayersChange({ ...layers, [l.key]: e.target.checked })} />
                  {l.label}
                </label>
              ))}
            </div>
          )}
        </>
      )}
      {v && (
        <div className="plan-scale" aria-hidden="true">
          <span style={{ width: scaleBar * v.s }} />
          {scaleBar} m
        </div>
      )}
      {tip && tips.get(tip.key) && (
        <div className="plan-tip" style={{ left: Math.min(tip.x + 14, box.width - 230), top: tip.y + 14 > box.height - 80 ? tip.y - 70 : tip.y + 14 }} role="status">
          {tips.get(tip.key)}
        </div>
      )}
      {hint && <div className="plan-hint">Use Ctrl + scroll to zoom</div>}
    </div>
  );
}
