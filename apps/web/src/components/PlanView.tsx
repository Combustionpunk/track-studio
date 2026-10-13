// Interactive 2D plan drawn from `built` (+ area, obstacles). Pan by dragging, zoom with the wheel / pinch /
// double-click / buttons, toggle layers, hover jumps, checks and obstacles for details.
import type { Area, Built, Check, DesignFeature, Obstacle, Point2, Side } from "@track-studio/engine";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FEATURE_LABEL, metres } from "../lib/format.js";
import { useElementSize } from "../lib/hooks.js";
import {
  areaBounds,
  arrowsAlong,
  CHECK_COLOUR,
  FEATURE_COLOUR,
  featureCorners,
  fitView,
  laneRuns,
  pan,
  pts,
  viewBox,
  zoomAt,
  type View,
} from "../lib/plan.js";

export type LayerKey = "lanes" | "racingLine" | "dividers" | "features" | "start" | "checks" | "obstacles" | "grid" | "rostrum";
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
  { key: "grid", label: "1 m grid" },
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
  /** editor layer drawn on top; gets the size of one screen pixel in metres (for constant-size handles) */
  overlay?: (mPerPx: number) => ReactNode;
  /** wheel over an element marked data-wheel: return true if handled (then it doesn't zoom) */
  onHandleWheel?: (e: WheelEvent, el: Element) => boolean;
  /** click (no drag) on the plan where there's no handle */
  onBackgroundClick?: () => void;
}

const MAX_SCALE = 400; // px per metre

export function PlanView(props: PlanViewProps) {
  const { area, obstacles = [], built, layers = DEFAULT_LAYERS, onLayersChange, highlight, compact = false, interactive = true, label, className, children, overlay, onHandleWheel, onBackgroundClick } = props;
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

  // drag to pan, two fingers to pinch
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive || e.button > 0) return;
    if ((e.target as Element).closest("[data-handle]")) return; // the editor's handles take this pointer
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged.current = false;
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (prev) {
      const next = { x: e.clientX, y: e.clientY };
      if (ps.size === 1) {
        const dx = next.x - prev.x, dy = next.y - prev.y;
        if (dragged.current || Math.hypot(dx, dy) > 2) {
          dragged.current = true;
          moved.current = true;
          setTip(null);
          setView((cur) => (cur ? pan(cur, dx, dy) : cur));
        } else return;
      } else if (ps.size === 2) {
        const [a, b] = [...ps.entries()].map(([id, p]) => (id === e.pointerId ? next : p));
        const [pa, pb] = [...ps.values()];
        const d0 = Math.hypot(pa.x - pb.x, pa.y - pb.y), d1 = Math.hypot(a.x - b.x, a.y - b.y);
        if (d0 > 0) zoomBy(d1 / d0, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        dragged.current = true;
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
    if (ours && !dragged.current && !(e.target as Element).closest("[data-handle]")) onBackgroundClick?.();
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
    if (built)
      t.set(
        "start",
        <>
          <strong>Start / finish</strong>
          <span>{metres(built.startLine.distance)} from point 0</span>
        </>,
      );
    const r = built?.rostrum ?? props.rostrum;
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
  const L = area.length, W = area.width;
  const lanes = useMemo(() => (built ? laneRuns(built.racingLine) : []), [built]);
  const arrows = useMemo(() => (built ? arrowsAlong(built.racingLine) : []), [built]);
  const rostrum = built?.rostrum ?? props.rostrum;
  const px = v ? 1 / v.s : 0.05; // one screen pixel in metres

  const grid: ReactNode[] = [];
  if (layers.grid) {
    for (let x = Math.ceil(-L / 2); x <= L / 2; x++)
      grid.push(<line key={`gx${x}`} x1={x} y1={-W / 2} x2={x} y2={W / 2} className={x % 5 === 0 ? "grid5" : "grid1"} vectorEffect="non-scaling-stroke" />);
    for (let z = Math.ceil(-W / 2); z <= W / 2; z++)
      grid.push(<line key={`gz${z}`} x1={-L / 2} y1={-z} x2={L / 2} y2={-z} className={z % 5 === 0 ? "grid5" : "grid1"} vectorEffect="non-scaling-stroke" />);
  }

  const scaleBar = v ? niceLength(120 / v.s) : 1;

  return (
    <div
      ref={boxRef}
      className={`plan ${compact ? "plan-compact" : ""} ${className ?? ""}`}
      style={{ "--plan-ratio": `${bounds.x1 - bounds.x0} / ${bounds.y1 - bounds.y0}` } as React.CSSProperties}
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
          <rect x={-L / 2} y={-W / 2} width={L} height={W} className="plan-area" />
          {grid}
          {layers.obstacles &&
            obstacles.map((o, i) =>
              o.type === "circle" ? (
                <circle key={i} data-tip={`o${i}`} cx={o.x} cy={-o.z} r={o.radius} className="plan-obstacle" />
              ) : (
                <rect
                  key={i}
                  data-tip={`o${i}`}
                  x={o.x - o.length / 2}
                  y={-o.z - o.width / 2}
                  width={o.length}
                  height={o.width}
                  transform={`rotate(${-(o.rotation ?? 0)} ${o.x} ${-o.z})`}
                  className="plan-keepout"
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
          {layers.lanes && (
            <g className="plan-lanes">
              {lanes.map((r, i) => (
                <polyline key={i} points={r.points} strokeWidth={r.w} />
              ))}
            </g>
          )}
          {layers.racingLine && built && (
            <g className="plan-racing">
              <polygon points={pts(built.racingLine)} vectorEffect="non-scaling-stroke" />
              {arrows.map((a, i) => (
                <path key={i} d="M -0.25 -0.22 L 0.2 0 L -0.25 0.22" transform={`translate(${a.x} ${a.y}) rotate(${a.angle})`} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {layers.features &&
            built?.features.map((f, i) => (
              <g key={i} data-tip={`f${i}`} className="plan-feature">
                <polygon points={pts(featureCorners(f))} fill={FEATURE_COLOUR[f.type] ?? "#c9a0ff"} />
                <path
                  d="M -0.18 -0.25 L 0.18 0 L -0.18 0.25"
                  transform={`translate(${f.x} ${-f.z}) rotate(${-f.heading})`}
                  className="plan-feature-arrow"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          {layers.dividers && built && (
            <g className="plan-pipes">
              {built.dividers.map((d, i) =>
                d.closed ? (
                  <polygon key={i} points={pts(d.points)} className={d.shared ? "shared" : undefined} />
                ) : (
                  <polyline key={i} points={pts(d.points)} className={d.shared ? "shared" : undefined} />
                ),
              )}
            </g>
          )}
          {layers.start && built && <StartLine built={built} />}
          {layers.rostrum && rostrum && (
            <g data-tip="rostrum" className="plan-rostrum" transform={`translate(${rostrum.x} ${-rostrum.z})`}>
              <rect x={rostrum.side === "east" || rostrum.side === "west" ? -0.6 : -2.5} y={rostrum.side === "east" || rostrum.side === "west" ? -2.5 : -0.6} width={rostrum.side === "east" || rostrum.side === "west" ? 1.2 : 5} height={rostrum.side === "east" || rostrum.side === "west" ? 5 : 1.2} rx={0.2} />
              <text
                x={0}
                y={0}
                dy="0.35em"
                textAnchor="middle"
                fontSize={0.6}
                transform={rostrum.side === "east" || rostrum.side === "west" ? "rotate(-90)" : undefined}
              >
                ROSTRUM
              </text>
            </g>
          )}
          {layers.obstacles &&
            obstacles.map((o, i) =>
              o.label ? (
                <text key={`l${i}`} x={o.x} y={-o.z} dy="0.35em" textAnchor="middle" fontSize={0.4} className="plan-label">
                  {o.label}
                </text>
              ) : null,
            )}
          {layers.checks &&
            built?.checks.map((c, i) =>
              c.x !== undefined && c.z !== undefined ? (
                <circle
                  key={i}
                  data-tip={`c${i}`}
                  cx={c.x}
                  cy={-c.z}
                  r={0.45}
                  className="plan-check"
                  stroke={CHECK_COLOUR[c.level]}
                  fill={CHECK_COLOUR[c.level]}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
          {children}
          {overlay?.(px)}
          {highlight && (
            <circle cx={highlight[0]} cy={-highlight[1]} r={Math.max(0.8, 14 * px)} className="plan-highlight" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      )}

      {interactive && v && (
        <>
          <div className="plan-controls" role="toolbar" aria-label="Plan view">
            <button type="button" onClick={() => zoomBy(1.5)} aria-label="Zoom in" title="Zoom in (+)">
              +
            </button>
            <button type="button" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out (−)">
              −
            </button>
            <button type="button" onClick={reset} aria-label="Fit to view" title="Fit (0)">
              ⤢
            </button>
            {onLayersChange && (
              <button type="button" onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} aria-label="Layers" title="Layers" className={layersOpen ? "on" : ""}>
                ≡
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
          <div className="plan-scale" aria-hidden="true">
            <span style={{ width: scaleBar * v.s }} />
            {scaleBar} m
          </div>
        </>
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

function StartLine({ built }: { built: Built }) {
  const s = built.startLine;
  const h = (s.heading * Math.PI) / 180;
  const nx = -Math.sin(h), nz = Math.cos(h);
  const a = [s.x + (nx * s.width) / 2, s.z + (nz * s.width) / 2], b = [s.x - (nx * s.width) / 2, s.z - (nz * s.width) / 2];
  return (
    <g data-tip="start" className="plan-start">
      <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} />
      <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} className="checker" />
      {/* direction of travel */}
      <line x1={s.x + Math.cos(h) * 0.4} y1={-(s.z + Math.sin(h) * 0.4)} x2={s.x + Math.cos(h) * 1.6} y2={-(s.z + Math.sin(h) * 1.6)} className="plan-start-dir" />
      <path d="M -0.3 -0.25 L 0.1 0 L -0.3 0.25" transform={`translate(${s.x + Math.cos(h) * 1.6} ${-(s.z + Math.sin(h) * 1.6)}) rotate(${-s.heading})`} className="plan-start-dir" />
    </g>
  );
}

/** 1, 2 or 5 × 10^n, close to `m`. */
function niceLength(m: number): number {
  const p = 10 ** Math.floor(Math.log10(m));
  const f = m / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
