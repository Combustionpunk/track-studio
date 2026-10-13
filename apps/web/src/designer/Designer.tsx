// The track designer: drag corner points, click a straight to add one, wheel for radius / Ctrl+wheel for lane width,
// place and slide jumps and the start line, live checks, undo/redo, save as a new revision, local auto-save.
import {
  FEATURE_DEFAULTS,
  outerStyle,
  rostrumPosition,
  type Area,
  type BasedOn,
  type Built,
  type DesignFeature,
  type DesignPoint,
  type FeatureType,
  type Obstacle,
  type Point2,
  type RcTrack,
  type Side,
} from "@track-studio/engine";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useNavigate } from "react-router-dom";
import { Message, StatusBadge } from "../components/bits.js";
import { DEFAULT_LAYERS, PlanView, type Layers } from "../components/PlanView.js";
import { ApiError, api, post, type Permissions, type TrackResponse, type TrackSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useStored } from "../lib/hooks.js";
import { featureCorners, laneRuns, pts } from "../lib/plan.js";
import { useSession } from "../lib/session.js";
import { clampToArea, insertionFor, liveGeometry, nearestOnLine, newPointBetween, placeFeature, roundTo, snapPoint, tooClose, wheelRadius, wrapDistance, type Guide, type Live } from "./geometry.js";
import { useHistory } from "./history.js";
import { useBake } from "./useBake.js";

// ---------------------------------------------------------------------------------------------- tuning
/** wheel delta (pixels) per step = one mouse-wheel notch; trackpads add up their small deltas */
export const WHEEL_PX_PER_STEP = 100;
export const WHEEL_STEP = 0.05; // m: radius / width resolution; a radius step is ~10% (at least this)
export const WHEEL_WIDTH_STEP = 0.1; // m of lane width per notch
export const RADIUS_RANGE: [number, number] = [0, 15];
export const WIDTH_RANGE: [number, number] = [0.8, 5];
const HANDLE_PX = 7; // corner point handle radius on screen
const GRAB_PX = 14; // a press on the track this close to a corner point grabs the point (instead of adding one)
const DRAG_START_PX = 3; // movement before a press on a straight becomes a drag

export const FEATURE_TYPES: FeatureType[] = ["tabletop", "double", "kicker", "stepup", "stepdown", "whoops", "bump"];

export interface Draft {
  info: { name: string; description?: string };
  area: Area;
  obstacles: Obstacle[];
  basedOn: BasedOn | null;
  design: RcTrack["design"];
}

export interface DesignerBase {
  id: string;
  revision: number;
  doc: RcTrack;
  track: TrackSummary;
  can: Permissions;
}

type Selection = { kind: "point"; i: number } | { kind: "feature"; i: number } | { kind: "start" } | null;
type Tool = { kind: "select" } | { kind: "feature"; type: FeatureType };

export interface DesignerProps {
  mode: "new" | "edit";
  initial: Draft;
  base?: DesignerBase;
  /** new tracks started from a venue template */
  fromVenue?: { id: string; name: string };
  storageKey: string;
}

export function toDoc(d: Draft, base?: { id: string; revision: number; doc: RcTrack }): RcTrack {
  const info = { ...(base?.doc.info ?? {}), name: d.info.name };
  if (d.info.description) (info as RcTrack["info"]).description = d.info.description;
  else delete (info as RcTrack["info"]).description;
  return { format: "rctrack", version: 1, id: base?.id ?? "new", revision: (base?.revision ?? 0) + 1, info, area: d.area, obstacles: d.obstacles, basedOn: d.basedOn, design: d.design };
}

export function draftFromDoc(doc: RcTrack): Draft {
  return {
    info: { name: doc.info.name, ...(doc.info.description ? { description: doc.info.description } : {}) },
    area: doc.area,
    obstacles: doc.obstacles ?? [],
    basedOn: doc.basedOn ?? null,
    design: { laneWidth: 2, features: [], start: { distance: 0 }, rostrum: { side: "south" }, ...doc.design },
  };
}

interface Autosave {
  draft: Draft;
  baseRevision: number | null;
  savedAt: string;
}

function svgOf(el: Element): SVGSVGElement {
  return (el instanceof SVGSVGElement ? el : (el as SVGElement).ownerSVGElement)!;
}

/** Pointer position in plan coordinates (x, z). */
function planPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point2 {
  const m = svg.getScreenCTM();
  if (!m) return [0, 0];
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return [p.x, -p.y];
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function Designer({ mode, initial, base: initialBase, fromVenue, storageKey }: DesignerProps) {
  const navigate = useNavigate();
  const { me, loginUrl } = useSession();
  const hist = useHistory<Draft>(initial);
  const draft = hist.present;
  const [base, setBase] = useState(initialBase);
  const [savedJson, setSavedJson] = useState(() => (mode === "new" ? "" : JSON.stringify(initial)));
  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = draftJson !== savedJson;
  const [sel, setSel] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>({ kind: "select" });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hoverS, setHoverS] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<Point2 | null>(null);
  const [layers, setLayers] = useStored<Layers>("designer-layers", { ...DEFAULT_LAYERS, checks: true });
  const [saving, setSaving] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: ReactNode } | null>(null);
  const [restore, setRestore] = useState<Autosave | null>(null);

  const live = useMemo(() => liveGeometry(draft.design), [draft.design]);
  const doc = useMemo(() => toDoc(draft, base), [draft, base]);
  const bake = useBake(doc);
  const rostrum = useMemo(() => {
    const side = (draft.design.rostrum?.side ?? "south") as Side;
    const [x, z] = rostrumPosition(draft.area, side, draft.design.rostrum?.offset ?? 0);
    return { side, x, z, eyeHeight: 2.8 };
  }, [draft.area, draft.design.rostrum]);
  // what to draw: the worker's bake, with the cheap parts (line, jumps, start) taken from the live geometry
  const built: Built = useMemo(() => {
    const b = bake.built;
    return {
      generator: b?.generator ?? "",
      lapLength: live.total,
      racingLine: live.racing,
      dividers: b?.dividers ?? [],
      features: live.features,
      startLine: live.startLine,
      rostrum,
      checks: b?.checks ?? [],
      footprint: b?.footprint ?? { cell: 0.1, origin: [0, 0], rows: 0, cols: 0, bbox: [0, 0, 0, 0], rle: "" },
      lanes: live.lanes,
      size: b?.size,
      stats: b?.stats ?? { dividerLength: 0, dividerRuns: 0, corners: 0 },
    };
  }, [bake.built, live, rostrum]);
  const errors = built.checks.filter((c) => c.level === "error");

  // refs for window-level handlers
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const liveRef = useRef<Live>(live);
  liveRef.current = live;
  const selRef = useRef(sel);
  selRef.current = sel;

  const update = useCallback((fn: (d: Draft) => Draft, group?: string) => hist.set(fn(draftRef.current), group), [hist]);
  const setPoints = (fn: (p: DesignPoint[]) => DesignPoint[], group?: string) => update((d) => ({ ...d, design: { ...d.design, points: fn(d.design.points) } }), group);
  const setFeatures = (fn: (f: DesignFeature[]) => DesignFeature[], group?: string) =>
    update((d) => ({ ...d, design: { ...d.design, features: fn(d.design.features ?? []) } }), group);
  const halfWidth = (p: DesignPoint) => (p.width ?? draftRef.current.design.laneWidth ?? 2) / 2;

  // ------------------------------------------------------------------------------------ auto-save + leaving
  useEffect(() => {
    try {
      const s = localStorage.getItem(storageKey);
      if (!s) return;
      const a = JSON.parse(s) as Autosave;
      if (JSON.stringify(a.draft) !== JSON.stringify(initial)) setRestore(a);
      else localStorage.removeItem(storageKey);
    } catch {
      /* unreadable autosave: ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (restore) return; // don't overwrite what's on offer until the user decides
    const t = setTimeout(() => {
      try {
        if (dirty) localStorage.setItem(storageKey, JSON.stringify({ draft, baseRevision: base?.revision ?? null, savedAt: new Date().toISOString() } satisfies Autosave));
        else localStorage.removeItem(storageKey);
      } catch {
        /* storage full / private mode */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [draft, dirty, storageKey, base?.revision, restore]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("You have unsaved changes. Leave the designer anyway? (They're kept on this device and offered next time.)")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  // ------------------------------------------------------------------------------------ editing actions
  const deleteSelection = useCallback(() => {
    const s = selRef.current;
    if (!s) return;
    if (s.kind === "point") {
      if (draftRef.current.design.points.length <= 3) {
        setMessage({ kind: "info", text: "A track needs at least 3 corner points." });
        return;
      }
      setPoints((p) => p.filter((_, i) => i !== s.i));
      setSel(null);
    } else if (s.kind === "feature") {
      setFeatures((f) => f.filter((_, i) => i !== s.i));
      setSel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** O: flip the corner to the opposite of what it looks like now (square <-> round) */
  const toggleOuter = useCallback((i: number) => {
    const p = draftRef.current.design.points[i];
    const c = liveRef.current.corners[i];
    if (!p || !c) return;
    const now = outerStyle(p, c);
    setPoints((pts) => pts.map((q, k) => (k === i ? { ...q, outer: now === "square" ? "round" : "square" } : q)), `outer:${i}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        // save works from anywhere, also while typing in a field
        e.preventDefault();
        setSaveOpen(true);
        return;
      }
      if (isTyping(e.target)) return; // inputs keep their own undo, delete, etc.
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) hist.redo();
        else hist.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        hist.redo();
      } else if ((e.key === "o" || e.key === "O") && !mod && selRef.current?.kind === "point") {
        e.preventDefault();
        toggleOuter(selRef.current.i);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selRef.current) {
          e.preventDefault();
          deleteSelection();
        }
      } else if (e.key === "Escape") {
        setTool({ kind: "select" });
        setSel(null);
        setSaveOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hist, deleteSelection, toggleOuter]);

  // ------------------------------------------------------------------------------------ dragging
  type DragKind = { kind: "point"; i: number; offset: Point2 } | { kind: "feature"; i: number; ds: number } | { kind: "start"; ds: number };
  const startDrag = (e: React.PointerEvent, svg: SVGSVGElement, d: DragKind, opts: { threshold?: boolean; onClick?: () => void } = {}) => {
    e.stopPropagation();
    const group = `drag:${d.kind}:${Date.now()}`;
    const x0 = e.clientX, y0 = e.clientY;
    let started = !opts.threshold;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START_PX) return;
        started = true;
      }
      const p = planPoint(svg, ev.clientX, ev.clientY);
      const cur = draftRef.current;
      if (d.kind === "point") {
        const n = cur.design.points.length;
        const prev = cur.design.points[(d.i - 1 + n) % n], next = cur.design.points[(d.i + 1) % n], me = cur.design.points[d.i];
        const raw: Point2 = [p[0] + d.offset[0], p[1] + d.offset[1]];
        const snapped = snapPoint(raw, [prev.x, prev.z], [next.x, next.z], ev.shiftKey);
        const q = clampToArea(snapped.p, cur.area, halfWidth(me));
        if (tooClose(q, [prev.x, prev.z], [next.x, next.z]) || (q[0] === me.x && q[1] === me.z)) return;
        setGuides(q[0] === snapped.p[0] && q[1] === snapped.p[1] ? snapped.guides : []);
        hist.set({ ...cur, design: { ...cur.design, points: cur.design.points.map((pt, i) => (i === d.i ? { ...pt, x: q[0], z: q[1] } : pt)) } }, group);
      } else {
        const s = wrapDistance(nearestOnLine(liveRef.current, p).s - d.ds, liveRef.current.total);
        if (d.kind === "feature") {
          const f = cur.design.features ?? [];
          if (f[d.i]?.distance === s) return;
          hist.set({ ...cur, design: { ...cur.design, features: f.map((x, i) => (i === d.i ? { ...x, distance: s } : x)) } }, group);
        } else if (cur.design.start?.distance !== s) {
          hist.set({ ...cur, design: { ...cur.design, start: { ...cur.design.start, distance: s } } }, group);
        }
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGuides([]);
      if (!started) opts.onClick?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onPointDown = (e: React.PointerEvent<SVGCircleElement>, i: number) => {
    if (e.button !== 0) return;
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const pt = draftRef.current.design.points[i];
    setSel({ kind: "point", i });
    setTool({ kind: "select" });
    startDrag(e, svg, { kind: "point", i, offset: [pt.x - p[0], pt.z - p[1]] });
  };

  const onLaneDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const hit = nearestOnLine(liveRef.current, p);
    if (tool.kind === "feature") {
      e.stopPropagation();
      const distance = wrapDistance(hit.s, liveRef.current.total);
      const i = (draftRef.current.design.features ?? []).length;
      setFeatures((f) => [...f, { type: tool.type, distance }]);
      setSel({ kind: "feature", i });
      setTool({ kind: "select" });
      setHoverS(null);
      return;
    }
    const pts = draftRef.current.design.points;
    let best = 0;
    pts.forEach((q, k) => {
      if (Math.hypot(q.x - p[0], q.z - p[1]) < Math.hypot(pts[best].x - p[0], pts[best].z - p[1])) best = k;
    });
    const mPerPx = 1 / (svg.getScreenCTM()?.a ?? 1);
    const nearPoint = Math.hypot(pts[best].x - p[0], pts[best].z - p[1]) <= GRAB_PX * mPerPx;
    if (hit.curvature !== 0 || nearPoint) {
      // on a corner, or just missed a point: grab the corner point
      setSel({ kind: "point", i: best });
      startDrag(e, svg, { kind: "point", i: best, offset: [pts[best].x - p[0], pts[best].z - p[1]] }, { threshold: true });
      return;
    }
    // on a straight: add a point there (and drag it if the pointer moves)
    const { after, at } = insertionFor(pts, p);
    const i = after + 1;
    const np = newPointBetween(pts[after], pts[(after + 1) % pts.length], at);
    setPoints((list) => [...list.slice(0, i), np, ...list.slice(i)], `drag:insert:${Date.now()}`);
    setSel({ kind: "point", i });
    startDrag(e, svg, { kind: "point", i, offset: [at[0] - p[0], at[1] - p[1]] }, { threshold: true });
  };

  const onFeatureDown = (e: React.PointerEvent<SVGPolygonElement>, i: number) => {
    if (e.button !== 0) return;
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const f = draftRef.current.design.features![i];
    const s = nearestOnLine(liveRef.current, p).s;
    setSel({ kind: "feature", i });
    startDrag(e, svg, { kind: "feature", i, ds: s - f.distance }, { threshold: true });
  };

  const onStartDown = (e: React.PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const s = nearestOnLine(liveRef.current, p).s;
    setSel({ kind: "start" });
    startDrag(e, svg, { kind: "start", ds: s - (draftRef.current.design.start?.distance ?? 0) }, { threshold: true });
  };

  // wheel over a corner point: radius; Ctrl+wheel: lane width
  const wheelAcc = useRef({ key: "", px: 0 });
  const onHandleWheel = useCallback(
    (e: WheelEvent, el: Element) => {
      const i = Number(el.getAttribute("data-index"));
      const pts = draftRef.current.design.points;
      if (!(i >= 0 && i < pts.length)) return false;
      const what = e.ctrlKey || e.metaKey ? "width" : "radius";
      const key = `${what}:${i}`;
      const acc = wheelAcc.current;
      if (acc.key !== key) Object.assign(acc, { key, px: 0 });
      acc.px += -(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
      const steps = Math.trunc(acc.px / WHEEL_PX_PER_STEP);
      if (!steps) return true;
      acc.px -= steps * WHEEL_PX_PER_STEP;
      const p = pts[i];
      const next =
        what === "radius"
          ? { ...p, radius: wheelRadius(p.radius ?? 1, steps, WHEEL_STEP, RADIUS_RANGE) }
          : { ...p, width: Math.min(WIDTH_RANGE[1], Math.max(WIDTH_RANGE[0], roundTo((p.width ?? draftRef.current.design.laneWidth ?? 2) + steps * WHEEL_WIDTH_STEP, WHEEL_STEP))) };
      setSel({ kind: "point", i });
      hist.set({ ...draftRef.current, design: { ...draftRef.current.design, points: pts.map((q, k) => (k === i ? next : q)) } }, key);
      return true;
    },
    [hist],
  );

  // ------------------------------------------------------------------------------------ saving
  const save = async () => {
    if (!me) return;
    setSaving(true);
    setMessage(null);
    const { built: _b, ...unbaked } = toDoc(draft, base);
    try {
      if (mode === "new") {
        const res = await post<TrackResponse>("/api/tracks", { track: unbaked, note: note || "First version", ...(fromVenue ? { fromVenue: fromVenue.id } : {}) });
        setSavedJson(draftJson);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
        navigate(`/t/${res.track.id}/edit`, { replace: true, state: { saved: res.track.revision } });
        return;
      }
      const res = await api<TrackResponse>(`/api/tracks/${base!.id}`, { method: "PUT", json: { track: unbaked, note: note || undefined, baseRevision: base!.revision } });
      setBase({ id: res.track.id, revision: res.track.revision, doc: res.doc, track: res.track, can: res.can });
      setSavedJson(draftJson);
      setNote("");
      setSaveOpen(false);
      setMessage({ kind: "info", text: `Saved as revision ${res.track.revision}.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof ApiError && e.code === "stale" ? <>{e.message} <a href={window.location.pathname}>Reload</a></> : (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!base) return;
    setMessage(null);
    try {
      await post(`/api/tracks/${base.id}/submit`);
      const res = await api<TrackResponse>(`/api/tracks/${base.id}`);
      setBase((b) => b && { ...b, track: res.track, can: res.can });
      setMessage({ kind: "info", text: "Submitted for approval." });
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    }
  };

  // ------------------------------------------------------------------------------------ overlay
  const pointsList = draft.design.points;
  const overlay = (m: number) => {
    const selPt = sel?.kind === "point" ? pointsList[sel.i] : null;
    const corner = sel?.kind === "point" ? live.corners[sel.i] : null;
    const placing = tool.kind === "feature";
    const ghost = placing && hoverS !== null ? featureCorners(placeFeature(live, { type: tool.type, distance: hoverS })) : null;
    return (
      <g className={`ed ${placing ? "ed-placing" : ""}`}>
        <g
          data-handle="lane"
          className="ed-lane"
          onPointerDown={onLaneDown}
          onPointerMove={(e) => placing && setHoverS(nearestOnLine(live, planPoint(svgOf(e.currentTarget), e.clientX, e.clientY)).s)}
          onPointerLeave={() => setHoverS(null)}
        >
          {laneRuns(live.racing).map((r, i) => (
            <polyline key={i} points={r.points} strokeWidth={r.w} />
          ))}
        </g>
        <polygon className="ed-control" points={pts(pointsList.map((p) => [p.x, p.z]))} vectorEffect="non-scaling-stroke" />
        {guides.map((g, i) => (
          <line key={i} className="ed-guide" x1={g.from[0]} y1={-g.from[1]} x2={g.to[0]} y2={-g.to[1]} vectorEffect="non-scaling-stroke" />
        ))}
        {corner && corner.r > 0 && corner.th > 1e-6 && <CornerArc c={corner} />}
        {ghost && <polygon className="ed-ghost" points={pts(ghost)} vectorEffect="non-scaling-stroke" />}
        {built.features.map((f, i) => (
          <polygon
            key={i}
            data-handle="feature"
            className={`ed-feature ${sel?.kind === "feature" && sel.i === i ? "on" : ""}`}
            points={pts(featureCorners(f))}
            onPointerDown={(e) => onFeatureDown(e, i)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <StartHandle built={built} m={m} on={sel?.kind === "start"} onPointerDown={onStartDown} />
        {pointsList.map((p, i) => (
          <circle
            key={i}
            data-handle="point"
            data-wheel=""
            data-index={i}
            className={`ed-point ${sel?.kind === "point" && sel.i === i ? "on" : ""}`}
            cx={p.x}
            cy={-p.z}
            r={(sel?.kind === "point" && sel.i === i ? HANDLE_PX + 2 : HANDLE_PX) * m}
            onPointerDown={(e) => onPointDown(e, i)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSel({ kind: "point", i });
              selRef.current = { kind: "point", i };
              deleteSelection();
            }}
            vectorEffect="non-scaling-stroke"
          >
            <title>Corner {i + 1}: drag to move, wheel for radius, Ctrl+wheel for lane width, right-click to delete</title>
          </circle>
        ))}
        {selPt && corner && (
          <text className="ed-label" x={selPt.x} y={-selPt.z - 16 * m} fontSize={12 * m} strokeWidth={3 * m} textAnchor="middle">
            r {fmtR(selPt.radius ?? 1, corner.r)} · lane {fmt.metres(selPt.width ?? draft.design.laneWidth ?? 2, 2)}
          </text>
        )}
      </g>
    );
  };

  // ------------------------------------------------------------------------------------ layout
  const status = base?.track;
  const canSubmit = mode === "edit" && !!base?.can.submit;
  const submitBlocked = dirty ? "Save first" : errors.length ? `Fix ${errors.length === 1 ? "the error" : `the ${errors.length} errors`} first` : bake.pending ? "Checking…" : null;

  return (
    <div className="designer">
      <div className="designer-bar">
        <div className="designer-title">
          {mode === "edit" && base ? (
            <Link to={`/t/${base.id}`} className="back" title="Back to the track page">
              ←
            </Link>
          ) : (
            <Link to="/new" className="back" title="Start over">
              ←
            </Link>
          )}
          <input className="name-input" aria-label="Track name" value={draft.info.name} maxLength={80} onChange={(e) => update((d) => ({ ...d, info: { ...d.info, name: e.target.value } }), "name")} />
          {status && <StatusBadge status={status.status} />}
          <span className="save-state" aria-live="polite">
            {dirty ? "Unsaved changes · kept on this device" : base ? `Saved · revision ${base.revision}` : "Not saved yet"}
          </span>
        </div>
        <div className="designer-actions">
          <button type="button" className="btn" onClick={hist.undo} disabled={!hist.canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" className="btn" onClick={hist.redo} disabled={!hist.canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          {canSubmit && (
            <button type="button" className="btn" onClick={submit} disabled={!!submitBlocked} title={submitBlocked ?? "Send to the organisers for approval"}>
              Submit{submitBlocked ? ` (${submitBlocked.toLowerCase()})` : ""}
            </button>
          )}
          {me ? (
            <button type="button" className="btn btn-primary" onClick={() => setSaveOpen((o) => !o)} disabled={saving || (!dirty && mode === "edit")} aria-expanded={saveOpen}>
              {saving ? "Saving…" : mode === "new" ? "Save track" : "Save revision"}
            </button>
          ) : (
            <a className="btn btn-primary" href={loginUrl()}>
              Log in to save
            </a>
          )}
        </div>
        {saveOpen && me && (
          <form
            className="save-pop"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              <span>What changed? (optional)</span>
              <input autoFocus value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={mode === "new" ? "First version" : "e.g. tighter hairpin, moved the double"} />
            </label>
            {status?.approvedRevision && (
              <p className="hint">
                Revision {status.approvedRevision} stays approved — in the library and at meetings — until this new revision is approved.
              </p>
            )}
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : mode === "new" ? "Save track" : `Save as revision ${(base?.revision ?? 0) + 1}`}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {restore && (
        <Message>
          You have unsaved changes from {fmt.dateTime(restore.savedAt)}
          {base && restore.baseRevision !== base.revision ? ` (made on revision ${restore.baseRevision}; the track is at revision ${base.revision} now)` : ""}.{" "}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              hist.set(restore.draft);
              setRestore(null);
            }}
          >
            Restore them
          </button>{" "}
          ·{" "}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              try {
                localStorage.removeItem(storageKey);
              } catch {
                /* ignore */
              }
              setRestore(null);
            }}
          >
            Discard
          </button>
        </Message>
      )}
      {!me && <Message>You're not logged in: you can try the designer, and your work is kept on this device, but log in to save it.</Message>}
      {message && <Message kind={message.kind}>{message.text}</Message>}
      {status?.approvedRevision && (
        <Message>
          Revision {status.approvedRevision} is approved: it stays in the library and at meetings until a newer revision is approved. Saving here creates a new draft.
        </Message>
      )}

      <div className="designer-grid">
        <div className="designer-main">
          <div className="toolbar" role="toolbar" aria-label="Tools">
            <button type="button" className={`tool ${tool.kind === "select" ? "on" : ""}`} onClick={() => setTool({ kind: "select" })} title="Move points, jumps and the start line (Esc)">
              Select
            </button>
            <span className="tool-sep" aria-hidden="true" />
            <span className="tool-label">Add jump:</span>
            {FEATURE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`tool ${tool.kind === "feature" && tool.type === t ? "on" : ""}`}
                onClick={() => setTool(tool.kind === "feature" && tool.type === t ? { kind: "select" } : { kind: "feature", type: t })}
                title={`Click on the track to place a ${fmt.FEATURE_LABEL[t].toLowerCase()}`}
              >
                {fmt.FEATURE_LABEL[t]}
              </button>
            ))}
            <span className="tool-hint">{tool.kind === "feature" ? `Click on the track to place the ${fmt.FEATURE_LABEL[tool.type].toLowerCase()} · Esc to cancel` : "Snap 25 cm · 45° — hold Shift to place freely"}</span>
          </div>
          <PlanView
            area={draft.area}
            obstacles={draft.obstacles}
            built={built}
            designFeatures={draft.design.features}
            layers={layers}
            onLayersChange={setLayers}
            highlight={highlight}
            label={`Designer plan of ${draft.info.name}`}
            className="designer-plan"
            overlay={overlay}
            onHandleWheel={onHandleWheel}
            onBackgroundClick={() => {
              setSel(null);
              setHighlight(null);
            }}
          />
        </div>
        <aside className="designer-side">
          <Stats built={built} pending={bake.pending} live={live} />
          <SelectionPanel
            sel={sel}
            draft={draft}
            live={live}
            update={update}
            onDelete={deleteSelection}
            fromVenue={fromVenue?.name ?? (draft.basedOn ? status?.venue?.name ?? draft.basedOn.venueTemplate : undefined)}
          />
          <ChecksPanel
            built={built}
            pending={bake.pending}
            onShow={(x, z) => {
              setHighlight([x, z]);
              // select what the check is about: the nearest corner point or jump
              let best: Selection = null, bestD = 1.5;
              draft.design.points.forEach((p, i) => {
                const d = Math.hypot(p.x - x, p.z - z);
                if (d < bestD) [best, bestD] = [{ kind: "point", i }, d];
              });
              built.features.forEach((f, i) => {
                const d = Math.hypot(f.x - x, f.z - z);
                if (d < bestD) [best, bestD] = [{ kind: "feature", i }, d];
              });
              setSel(best);
            }}
          />
          <Shortcuts />
        </aside>
      </div>
    </div>
  );
}

const fmtR = (want: number, got: number) => (Math.abs(want - got) > 0.01 ? `${want.toFixed(2)}→${got.toFixed(2)} m` : `${want.toFixed(2)} m`);

function CornerArc({ c }: { c: Live["corners"][number] }) {
  // sweep flag: a left turn (counter-clockwise on the plan) is clockwise on screen (y = -z)
  const d = `M ${c.start[0]} ${-c.start[1]} A ${c.r} ${c.r} 0 0 ${c.sign > 0 ? 0 : 1} ${c.end[0]} ${-c.end[1]}`;
  return <path className="ed-arc" d={d} vectorEffect="non-scaling-stroke" />;
}

function StartHandle({ built, m, on, onPointerDown }: { built: Built; m: number; on: boolean; onPointerDown: (e: React.PointerEvent<SVGElement>) => void }) {
  const s = built.startLine;
  const h = (s.heading * Math.PI) / 180;
  const nx = -Math.sin(h), nz = Math.cos(h);
  const a = [s.x + (nx * s.width) / 2, s.z + (nz * s.width) / 2], b = [s.x - (nx * s.width) / 2, s.z - (nz * s.width) / 2];
  return (
    <g data-handle="start" className={`ed-start ${on ? "on" : ""}`} onPointerDown={onPointerDown}>
      <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} strokeWidth={Math.max(0.35, 12 * m)} />
      <circle cx={a[0]} cy={-a[1]} r={5 * m} className="grip" vectorEffect="non-scaling-stroke" />
      <title>Start / finish: drag along the track</title>
    </g>
  );
}

function Stats({ built, pending, live }: { built: Built; pending: boolean; live: Live }) {
  return (
    <section className="panel stats-panel" aria-labelledby="st-h">
      <h2 id="st-h">
        Track {pending && <span className="pending" title="Updating">…</span>}
      </h2>
      <dl className="stat-grid">
        <div>
          <dt>Lap</dt>
          <dd>{fmt.metres(live.total)}</dd>
        </div>
        <div>
          <dt>Corners</dt>
          <dd>{built.stats.corners || "—"}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{fmt.size(built.size, true)}</dd>
        </div>
        <div>
          <dt>Pipe</dt>
          <dd>{built.stats.dividerLength ? `${Math.round(built.stats.dividerLength)} m` : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

function ChecksPanel({ built, pending, onShow }: { built: Built; pending: boolean; onShow: (x: number, z: number) => void }) {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const checks = [...built.checks].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <section className="panel" aria-labelledby="ck-h">
      <h2 id="ck-h">
        Checks <span className="count-pill">{checks.length}</span>
        {pending && <span className="pending" title="Updating">…</span>}
      </h2>
      {checks.length === 0 ? (
        <p className="ok">No problems found.</p>
      ) : (
        <ul className="checks">
          {checks.map((c, i) => (
            <li key={i} className={`lvl-${c.level}`}>
              <span className="lvl">{c.level === "error" ? "Error" : c.level === "warning" ? "Warning" : "Note"}</span>
              {c.x !== undefined && c.z !== undefined ? (
                <button type="button" className="check-link" onClick={() => onShow(c.x!, c.z!)}>
                  {c.message}
                </button>
              ) : (
                <span className="msg-text">{c.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function NumberField({ label, value, step, min, max, placeholder, onChange, suffix = "m" }: { label: string; value: number | undefined; step: number; min?: number; max?: number; placeholder?: string; onChange: (v: number | undefined) => void; suffix?: string }) {
  // keep what's being typed (e.g. "1.") until it's a number
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    if (num(text) !== value) setText(value === undefined ? "" : String(Math.round(value * 1000) / 1000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="nfield">
      <span>{label}</span>
      <span className="nfield-input">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = num(e.target.value);
            if (n !== undefined || e.target.value === "") onChange(n);
          }}
        />
        <em>{suffix}</em>
      </span>
    </label>
  );
}

function SelectionPanel({
  sel,
  draft,
  live,
  update,
  onDelete,
  fromVenue,
}: {
  sel: Selection;
  draft: Draft;
  live: Live;
  update: (fn: (d: Draft) => Draft, group?: string) => void;
  onDelete: () => void;
  fromVenue?: string;
}) {
  const setPoint = (i: number, patch: Partial<DesignPoint>, key: string) =>
    update((d) => ({ ...d, design: { ...d.design, points: d.design.points.map((p, k) => (k === i ? { ...p, ...patch } : p)) } }), `${key}:${i}`);
  const setFeature = (i: number, patch: Partial<DesignFeature>, key: string) =>
    update((d) => ({ ...d, design: { ...d.design, features: (d.design.features ?? []).map((f, k) => (k === i ? { ...f, ...patch } : f)) } }), `f${key}:${i}`);

  if (sel?.kind === "point") {
    const p = draft.design.points[sel.i];
    const c = live.corners[sel.i];
    if (!p) return null;
    return (
      <section className="panel" aria-labelledby="sel-h">
        <h2 id="sel-h">Corner point {sel.i + 1}</h2>
        <div className="fields">
          <NumberField label="East (x)" value={p.x} step={0.25} onChange={(v) => v !== undefined && setPoint(sel.i, { x: v }, "x")} />
          <NumberField label="North (z)" value={p.z} step={0.25} onChange={(v) => v !== undefined && setPoint(sel.i, { z: v }, "z")} />
          <NumberField label="Radius" value={p.radius ?? 1} step={0.05} min={0} max={RADIUS_RANGE[1]} onChange={(v) => v !== undefined && setPoint(sel.i, { radius: Math.max(0, v) }, "radius")} />
          <NumberField
            label="Lane width"
            value={p.width}
            placeholder={String(draft.design.laneWidth ?? 2)}
            step={0.05}
            min={WIDTH_RANGE[0]}
            max={WIDTH_RANGE[1]}
            onChange={(v) => setPoint(sel.i, { width: v }, "width")}
          />
        </div>
        <div className="seg" role="radiogroup" aria-label="Outside corner">
          <span className="seg-label">Outside corner</span>
          {(["auto", "square", "round"] as const).map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={(p.outer ?? "auto") === o}
              className={(p.outer ?? "auto") === o ? "on" : ""}
              onClick={() => setPoint(sel.i, { outer: o === "auto" ? undefined : o }, "outer")}
              title={
                o === "auto" ? "Square up to a 120° turn, round beyond" : o === "square" ? "Two straight pipes meeting in a corner (O)" : "The pipe follows the curve (O)"
              }
            >
              {o === "auto" ? `Auto${c && (p.outer ?? "auto") === "auto" ? ` (${outerStyle(p, c)})` : ""}` : o === "square" ? "Square" : "Round"}
            </button>
          ))}
        </div>
        {c && c.th > 1e-3 && Math.abs(c.r - (p.radius ?? 1)) > 0.01 && <p className="hint">The radius is reduced to {c.r.toFixed(2)} m to fit the straights either side.</p>}
        {c && c.th <= 1e-3 && <p className="hint">This point is on a straight line — drag it to make a corner.</p>}
        <p className="hint">Wheel over the point: radius · Ctrl + wheel: lane width · O: square / round outside.</p>
        <button type="button" className="btn btn-danger" onClick={onDelete} disabled={draft.design.points.length <= 3}>
          Delete point
        </button>
      </section>
    );
  }
  if (sel?.kind === "feature") {
    const f = draft.design.features?.[sel.i];
    if (!f) return null;
    const [L0, H0] = FEATURE_DEFAULTS[f.type];
    return (
      <section className="panel" aria-labelledby="sel-h">
        <h2 id="sel-h">{fmt.FEATURE_LABEL[f.type]}</h2>
        <div className="fields">
          <label className="nfield">
            <span>Type</span>
            <select value={f.type} onChange={(e) => setFeature(sel.i, { type: e.target.value as FeatureType, length: undefined, height: undefined }, "type")}>
              {FEATURE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {fmt.FEATURE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <NumberField label="Along the line" value={f.distance} step={0.05} onChange={(v) => v !== undefined && setFeature(sel.i, { distance: wrapDistance(v, live.total) }, "distance")} />
          <NumberField label="Length" value={f.length} placeholder={String(L0)} step={0.05} min={0.2} onChange={(v) => setFeature(sel.i, { length: v }, "length")} />
          <NumberField label="Height" value={f.height} placeholder={String(H0)} step={0.01} min={0} onChange={(v) => setFeature(sel.i, { height: v }, "height")} />
        </div>
        <p className="hint">Drag it along the track. Empty length / height = the usual size.</p>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          Delete {fmt.FEATURE_LABEL[f.type].toLowerCase()}
        </button>
      </section>
    );
  }
  if (sel?.kind === "start") {
    return (
      <section className="panel" aria-labelledby="sel-h">
        <h2 id="sel-h">Start / finish</h2>
        <div className="fields">
          <NumberField
            label="Along the line"
            value={draft.design.start?.distance ?? 0}
            step={0.05}
            onChange={(v) => v !== undefined && update((d) => ({ ...d, design: { ...d.design, start: { distance: wrapDistance(v, live.total) } } }), "start")}
          />
        </div>
        <p className="hint">Drag the line along the track. Cars start towards the arrow.</p>
      </section>
    );
  }
  // nothing selected: the track's own settings
  const rostrum = draft.design.rostrum ?? { side: "south" as Side };
  return (
    <section className="panel" aria-labelledby="sel-h">
      <h2 id="sel-h">Track settings</h2>
      <div className="fields">
        <NumberField
          label="Lane width"
          value={draft.design.laneWidth ?? 2}
          step={0.05}
          min={WIDTH_RANGE[0]}
          max={WIDTH_RANGE[1]}
          onChange={(v) => v !== undefined && update((d) => ({ ...d, design: { ...d.design, laneWidth: v } }), "laneWidth")}
        />
      </div>
      {fromVenue ? (
        <p className="hint">
          Area ({fmt.size(draft.area, true)}), rostrum ({rostrum.side}) and obstacles come from the <strong>{fromVenue}</strong> template and are locked.
        </p>
      ) : (
        <div className="fields">
          <NumberField label="Area east–west" value={draft.area.length} step={0.5} min={5} max={100} onChange={(v) => v !== undefined && v >= 5 && v <= 100 && update((d) => ({ ...d, area: { ...d.area, length: v } }), "areaL")} />
          <NumberField label="Area north–south" value={draft.area.width} step={0.5} min={5} max={100} onChange={(v) => v !== undefined && v >= 5 && v <= 100 && update((d) => ({ ...d, area: { ...d.area, width: v } }), "areaW")} />
          <label className="nfield">
            <span>Rostrum side</span>
            <select value={rostrum.side} onChange={(e) => update((d) => ({ ...d, design: { ...d.design, rostrum: { ...rostrum, side: e.target.value as Side } } }), "rostrum")}>
              {(["north", "south", "east", "west"] as Side[]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <NumberField label="Rostrum offset" value={rostrum.offset ?? 0} step={0.5} onChange={(v) => update((d) => ({ ...d, design: { ...d.design, rostrum: { ...rostrum, offset: v ?? 0 } } }), "rostrumOff")} />
        </div>
      )}
      <label className="nfield wide">
        <span>Description</span>
        <textarea rows={3} value={draft.info.description ?? ""} maxLength={2000} onChange={(e) => update((d) => ({ ...d, info: { ...d.info, description: e.target.value } }), "description")} />
      </label>
      <p className="hint">Select a corner point, jump or the start line to edit it.</p>
    </section>
  );
}

function Shortcuts() {
  return (
    <details className="panel shortcuts">
      <summary>How to draw</summary>
      <ul>
        <li>
          <b>Drag</b> a corner point to move it (snaps to 25 cm and 45°; <kbd>Shift</kbd> = free).
        </li>
        <li>
          <b>Click a straight</b> to add a point there (or press and pull).
        </li>
        <li>
          <kbd>Delete</kbd> or <b>right-click</b> a point to remove it.
        </li>
        <li>
          <b>Wheel</b> over a point: corner radius · <kbd>Ctrl</kbd> + wheel: lane width · <kbd>O</kbd>: square / round outside corner.
        </li>
        <li>Pick a jump, click the track to place it, drag it along. Drag the start line the same way.</li>
        <li>
          Drag empty space to pan, wheel elsewhere to zoom. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo, <kbd>Ctrl</kbd>+<kbd>S</kbd> save.
        </li>
      </ul>
    </details>
  );
}
