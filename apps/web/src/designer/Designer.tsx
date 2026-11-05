// The track designer: drag corner points, click a straight to add one, wheel for radius / Ctrl+wheel for lane width,
// place and slide jumps and the start line, live checks, undo/redo, save as a new revision, local auto-save.
// Quick mode (the default) lays the lanes (step 1, lanes.ts), then shapes the corners by apex radius (step 2, shape.ts);
// Advanced shows every per-corner control. See mode.ts.
import {
  ALL_PLAN_LAYERS,
  FEATURE_DEFAULTS,
  outerStyle,
  planLayers,
  rostrumPosition,
  type Area,
  type BasedOn,
  type Built,
  type Check,
  type DesignFeature,
  type DesignPoint,
  type FeatureType,
  type Obstacle,
  type PlanLayers,
  type Point2,
  type RcTrack,
  type RostrumPlacement,
  type Side,
} from "@track-studio/engine";
import { ChevronLeft, CircleCheck, CircleX, Info, Monitor, Redo2, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useNavigate } from "react-router-dom";
import { CopyButton, Message, StatusBadge } from "../components/bits.js";
import { DEFAULT_LAYERS, PlanView, type Layers } from "../components/PlanView.js";
import { ApiError, api, post, type Permissions, type TrackResponse, type TrackSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useMediaQuery, useStored } from "../lib/hooks.js";
import { featureCorners, lanePath, laneRuns, pts } from "../lib/plan.js";
import { useSession } from "../lib/session.js";
import { insertionFor, liveGeometry, nearestOnLine, placeFeature, roundTo, tooClose, wheelRadius, wrapDistance, type Guide, type Live } from "./geometry.js";
import { useHistory } from "./history.js";
import { JumpPalette } from "./JumpPalette.js";
import {
  addJump,
  allows,
  checkCounts,
  deleteJump,
  FEATURE_TYPES,
  insertPoint,
  jumpsInCorner,
  MODE_KEY,
  moveJump,
  movePoint,
  paletteJumps,
  readMode,
  snapModeFor,
  submitBlock,
  visibleChecks,
  wheelEdit,
  type DesignerMode,
} from "./mode.js";
import { hasMitre, keepPinned, tidy, makeHairpin, mitrePoint, pinnedCorners, placeByMitre, SHARP_TURN, snapCentre, snapInsertion, snapMitre, turnDegrees, type SnapMode, type SnapResult, type SnapTag } from "./snap.js";
import { cellAt, cellCentre, cellCorner, designStep, gridFor, paintTo, REFUSAL_TEXT, reopenLaying, same, withLaying, type Cell, type LaneGrid } from "./lanes.js";
import { alongBisector, apexOf, apexRadius, APEX_MAX, deleteCorner, handlePoint, insertAfter, insertNearTrack, isReduced, MIN_CORNERS, placeCorner, QUICK_SIZES, radiusFromDrag, setApex, turnLabel, widthAt } from "./shape.js";
import { useBake } from "./useBake.js";

// ---------------------------------------------------------------------------------------------- tuning
/** wheel delta (pixels) per step = one mouse-wheel notch; trackpads add up their small deltas */
export const WHEEL_PX_PER_STEP = 100;
export const WHEEL_STEP = 0.05; // m: radius / width resolution; a radius step is ~10% (at least this)
export const WHEEL_WIDTH_STEP = 0.1; // m of lane width per notch
export const RADIUS_RANGE: [number, number] = [0, 15];
export const WIDTH_RANGE: [number, number] = [0.8, 5];
const HANDLE_PX = 5; // centre (racing-line) point handle radius on screen
const MITRE_PX = 6; // outside-corner handle half-size on screen
const GRAB_PX = 14; // a press on the track this close to a corner point grabs the point (instead of adding one)
const DRAG_START_PX = 3; // movement before a press on a straight becomes a drag
const CORNER_PX = 10; // Quick step 2: numbered corner handle radius on screen
const APEX_PX = 6; // Quick step 2: apex handle radius on screen
const TOUCH_PX = 22; // touch screens: handles take a press this far out (44 px across)
/** how long "1 · Lay the lanes" waits for the second tap that confirms it */
const CONFIRM_MS = 4000;
/** narrower than this, the designer shows a view-only plan */
export const PHONE_QUERY = "(max-width: 640px)";
/** touch screens (tablets): bigger handles, and a toggle for free placement since there's no Alt */
export const TOUCH_QUERY = "(pointer: coarse)";

export interface Draft {
  info: { name: string; description?: string };
  area: Area;
  obstacles: Obstacle[];
  basedOn: BasedOn | null;
  design: RcTrack["design"];
  /** step 1 (lay the lanes): the squares painted so far; the design has no points until the loop closes */
  laying?: Cell[];
  /** step 2: the squares the loop was laid through, so "1 · Lay the lanes" can reopen it */
  laid?: Cell[];
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

/** A new design (from a venue template or a blank area): it opens in step 1 with nothing laid. */
export function newDraft({ area, obstacles, name, basedOn = null, rostrum, laneWidth = 2 }: { area: Area; obstacles: Obstacle[]; name: string; basedOn?: BasedOn | null; rostrum?: RostrumPlacement; laneWidth?: number }): Draft {
  return { info: { name }, area, obstacles, basedOn, laying: [], design: { laneWidth, points: [], features: [], start: { distance: 0 }, rostrum: { side: "south", ...rostrum } } };
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

/** what the live geometry is worked out from while laying the lanes (nothing of it is drawn: there's no track yet) */
const NO_TRACK: RcTrack["design"] = { laneWidth: 2, points: [{ x: -2, z: -1 }, { x: 2, z: -1 }, { x: 2, z: 1 }, { x: -2, z: 1 }] };

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** the plan's checks layer on its own (the designer's problem marks) */
const ONLY_CHECKS = Object.fromEntries(Object.keys(ALL_PLAN_LAYERS).map((k) => [k, k === "checks"])) as PlanLayers;

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
  const [snap, setSnap] = useStored<{ mode: SnapMode }>("designer-snap", { mode: "lanes" });
  const snapRef = useRef(snap.mode);
  snapRef.current = snap.mode;
  const hatchId = `hatch${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [snapInfo, setSnapInfo] = useState<{ mode: SnapMode; tags: SnapTag[] } | null>(null);
  const [view, setViewState] = useState<DesignerMode>(() => {
    try {
      return readMode(localStorage.getItem(MODE_KEY));
    } catch {
      return "quick";
    }
  });
  const setView = (m: DesignerMode) => {
    setViewState(m);
    // a step-up, step-down or bump picked in Advanced can't be placed from Quick
    setTool((t) => (t.kind === "feature" && !paletteJumps(m).includes(t.type) ? { kind: "select" } : t));
    try {
      localStorage.setItem(MODE_KEY, JSON.stringify({ mode: m }));
    } catch {
      /* private mode etc. */
    }
  };
  const viewRef = useRef(view);
  viewRef.current = view;
  const phone = useMediaQuery(PHONE_QUERY);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const touch = useMediaQuery(TOUCH_QUERY);
  /** Quick step 2: snapping to lane lines (off places corners freely, like holding Alt) */
  const [laneSnap, setLaneSnap] = useState(true);
  const laneSnapRef = useRef(laneSnap);
  laneSnapRef.current = laneSnap;
  /** "1 · Lay the lanes" was tapped once: the next tap goes back */
  const [backArmed, setBackArmed] = useState(false);
  useEffect(() => {
    if (!backArmed) return;
    const t = setTimeout(() => setBackArmed(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [backArmed]);
  const [shared, setShared] = useState<Guide | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [hoverPt, setHoverPt] = useState<number | null>(null);
  /** Shift = fine, Alt = free, otherwise the toolbar's mode; lanes only in Quick */
  const modeFor = (ev: { shiftKey: boolean; altKey: boolean }): SnapMode => snapModeFor(viewRef.current, ev, snapRef.current);

  const step = designStep(draft);
  const laying = step === 1;
  const grid = useMemo(() => (laying ? gridFor(draft) : null), [laying, draft.area, draft.obstacles, draft.design.laneWidth]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useMemo(() => liveGeometry(laying ? NO_TRACK : draft.design), [laying, draft.design]);
  const doc = useMemo(() => (laying ? null : toDoc(draft, base)), [laying, draft, base]);
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
      const left = deleteCorner(draftRef.current.design.points, s.i);
      if (!left) {
        setMessage({ kind: "info", text: `A track needs at least ${MIN_CORNERS} corner points.` });
        return;
      }
      setPoints(() => left);
      setSel(null);
    } else if (s.kind === "feature") {
      setFeatures((f) => deleteJump(f, s.i));
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
        if (!phoneRef.current && !draftRef.current.laying) setSaveOpen(true);
        return;
      }
      if (isTyping(e.target) || phoneRef.current) return; // inputs keep their own undo, delete, etc.; phones only view
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) hist.redo();
        else hist.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        hist.redo();
      } else if ((e.key === "h" || e.key === "H") && !mod && selRef.current?.kind === "point" && allows(viewRef.current, "hairpin")) {
        e.preventDefault();
        const i = selRef.current.i;
        const cur = draftRef.current;
        const hp = makeHairpin(cur.design.points, i, cur.design.laneWidth ?? 2);
        if (hp) {
          hist.set({ ...cur, design: { ...cur.design, points: hp } }, `hairpin:${Date.now()}`);
          setMessage(null);
        } else setMessage({ kind: "info", text: "That point is on a straight: there's no turn to make a hairpin of." });
      } else if ((e.key === "o" || e.key === "O") && !mod && selRef.current?.kind === "point" && allows(viewRef.current, "outer")) {
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
  type DragKind =
    | { kind: "point"; i: number; offset: Point2 }
    | { kind: "mitre"; i: number; offset: Point2 }
    | { kind: "apex"; i: number }
    | { kind: "feature"; i: number; ds: number }
    | { kind: "start"; ds: number };
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
      if (d.kind === "apex") {
        // Quick step 2: the handle slides along the corner's inside bisector; only the radius changes
        const lw = cur.design.laneWidth ?? 2;
        const a = apexOf(cur.design.points, d.i, lw);
        if (!a) return;
        const r = radiusFromDrag(alongBisector(a, p), a.th, a.w);
        if (r === cur.design.points[d.i].radius) return;
        hist.set({ ...cur, design: { ...cur.design, points: cur.design.points.map((q, k) => (k === d.i ? { ...q, radius: r } : q)) } }, group);
      } else if (d.kind === "point" && viewRef.current === "quick") {
        // Quick step 2: anywhere in the area, onto a lane line within 0.2 m unless Alt or snapping is off
        const n = cur.design.points.length;
        const prev = cur.design.points[(d.i - 1 + n) % n], next = cur.design.points[(d.i + 1) % n], me = cur.design.points[d.i];
        const free = ev.altKey || !laneSnapRef.current;
        const { p: q, snapped } = placeCorner([p[0] + d.offset[0], p[1] + d.offset[1]], cur.area, cur.design.laneWidth ?? 2, free);
        setSnapInfo({ mode: free ? "free" : "lanes", tags: snapped ? ["lane line"] : [] });
        if (tooClose(q, [prev.x, prev.z], [next.x, next.z]) || (q[0] === me.x && q[1] === me.z)) return;
        hist.set({ ...cur, design: { ...cur.design, points: movePoint(cur.design.points, d.i, q) } }, group);
      } else if (d.kind === "point" || d.kind === "mitre") {
        const n = cur.design.points.length;
        const prev = cur.design.points[(d.i - 1 + n) % n], next = cur.design.points[(d.i + 1) % n], me = cur.design.points[d.i];
        const raw: Point2 = [p[0] + d.offset[0], p[1] + d.offset[1]];
        const mode = modeFor(ev);
        const lw = cur.design.laneWidth ?? 2;
        const ctx = { area: cur.area, points: cur.design.points, laneWidth: lw, i: d.i, mode };
        let res: SnapResult, q: Point2;
        if (d.kind === "point") {
          res = snapCentre(raw, ctx);
          q = res.p;
        } else {
          // the pipes' outside corner follows the pointer: solve for the centre point
          res = snapMitre(raw, ctx);
          const P = placeByMitre(cur.design.points, d.i, res.p, lw);
          q = [tidy(P[0]), tidy(P[1])];
        }
        setSnapInfo({ mode, tags: res.tags });
        if (tooClose(q, [prev.x, prev.z], [next.x, next.z]) || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) return;
        setGuides(res.guides);
        setShared(res.shared ?? null);
        if (q[0] === me.x && q[1] === me.z) return;
        let moved = movePoint(cur.design.points, d.i, q);
        pinned.delete(d.i);
        if (pinned.size) moved = keepPinned(moved, pinned, lw, origin);
        hist.set({ ...cur, design: { ...cur.design, points: moved } }, group);
      } else {
        const s = wrapDistance(nearestOnLine(liveRef.current, p).s - d.ds, liveRef.current.total);
        if (d.kind === "feature") {
          const f = cur.design.features ?? [];
          if (f[d.i]?.distance === s) return;
          hist.set({ ...cur, design: { ...cur.design, features: moveJump(f, d.i, s) } }, group);
        } else if (cur.design.start?.distance !== s) {
          hist.set({ ...cur, design: { ...cur.design, start: { ...cur.design.start, distance: s } } }, group);
        }
      }
    };
    // corners whose pipes sit in a hall corner stay there while this point moves
    const origin = draftRef.current.design.points;
    const pinned = (d.kind === "point" && viewRef.current === "advanced") || d.kind === "mitre" ? pinnedCorners(origin, draftRef.current.area, draftRef.current.design.laneWidth ?? 2, d.i) : new Map<number, Point2>();
    if (d.kind === "point" || d.kind === "mitre" || d.kind === "apex") setDragging(d.i);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGuides([]);
      setShared(null);
      setSnapInfo(null);
      setDragging(null);
      if (!started) opts.onClick?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onPointDown = (e: React.PointerEvent<SVGElement>, i: number) => {
    if (e.button !== 0) return;
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const pt = draftRef.current.design.points[i];
    const again = selRef.current?.kind === "point" && selRef.current.i === i;
    setSel({ kind: "point", i });
    setTool({ kind: "select" });
    // Quick: a tap on the selected corner lets it go, so taps on the floor stop adding after it
    const onClick = viewRef.current === "quick" && again ? () => setSel(null) : undefined;
    startDrag(e, svg, { kind: "point", i, offset: [pt.x - p[0], pt.z - p[1]] }, { threshold: !!onClick, onClick });
  };

  const onApexDown = (e: React.PointerEvent<SVGElement>, i: number) => {
    if (e.button !== 0) return;
    setSel({ kind: "point", i });
    setTool({ kind: "select" });
    startDrag(e, svgOf(e.currentTarget), { kind: "apex", i });
  };

  /**
   * Quick step 2, a tap on the floor or the track: a corner straight after the selected one (and select it, so tapping
   * round lays corners in order); with nothing selected, into the part of the track it's near. One undo step each.
   */
  const addCornerAt = (raw: Point2, free: boolean): number | null => {
    const cur = draftRef.current;
    const lw = cur.design.laneWidth ?? 2;
    const { p } = placeCorner(raw, cur.area, lw, free || !laneSnapRef.current);
    const s = selRef.current;
    const r = s?.kind === "point" ? insertAfter(cur.design.points, s.i, p, lw) : s ? null : insertNearTrack(cur.design.points, p, nearestOnLine(liveRef.current, raw).dist, lw);
    if (!r) return null;
    hist.set({ ...cur, design: { ...cur.design, points: r.points } }, `insert:${Date.now()}`);
    draftRef.current = { ...cur, design: { ...cur.design, points: r.points } };
    setSel((selRef.current = { kind: "point", i: r.index }));
    setMessage(null);
    return r.index;
  };

  const onMitreDown = (e: React.PointerEvent<SVGRectElement>, i: number) => {
    if (e.button !== 0) return;
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const cur = draftRef.current;
    const m = mitrePoint(cur.design.points, i, cur.design.laneWidth ?? 2);
    if (!m) return;
    setSel({ kind: "point", i });
    setTool({ kind: "select" });
    startDrag(e, svg, { kind: "mitre", i, offset: [m[0] - p[0], m[1] - p[1]] });
  };

  const onLaneDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const hit = nearestOnLine(liveRef.current, p);
    if (tool.kind === "feature") {
      e.stopPropagation();
      const distance = wrapDistance(hit.s, liveRef.current.total);
      const { features, index } = addJump(draftRef.current.design.features ?? [], tool.type, distance);
      setFeatures(() => features);
      setSel({ kind: "feature", i: index });
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
    if (viewRef.current === "quick") {
      e.stopPropagation();
      if (nearPoint) {
        setSel({ kind: "point", i: best });
        startDrag(e, svg, { kind: "point", i: best, offset: [pts[best].x - p[0], pts[best].z - p[1]] }, { threshold: true });
        return;
      }
      // a tap on the track adds a corner (after the selected one, or into this part of the track) and drags it on
      const i = addCornerAt(p, e.altKey);
      const at = i === null ? null : draftRef.current.design.points[i];
      if (i !== null && at) startDrag(e, svg, { kind: "point", i, offset: [at.x - p[0], at.z - p[1]] }, { threshold: true });
      return;
    }
    if (hit.curvature !== 0 || nearPoint) {
      // on a corner, or just missed a point: grab the corner point
      setSel({ kind: "point", i: best });
      startDrag(e, svg, { kind: "point", i: best, offset: [pts[best].x - p[0], pts[best].z - p[1]] }, { threshold: true });
      return;
    }
    // on a straight: add a point there (and drag it if the pointer moves)
    const { after, at: projected } = insertionFor(pts, p);
    const at = snapInsertion(projected, pts, after, modeFor(e), draftRef.current.area, draftRef.current.design.laneWidth ?? 2);
    const i = after + 1;
    setPoints((list) => insertPoint(viewRef.current, list, after, at), `drag:insert:${Date.now()}`);
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

  // ------------------------------------------------------------------------------------ step 1: lay the lanes
  // step 1's notes go in the floating hint, not the message bar, so the plan never moves under a drag
  const [layNote, setLayNote] = useState<string | null>(null);
  /** Paint from the end of the lane to `target`, one undo step per square. True once the loop has closed. */
  const paintCell = (g: LaneGrid, target: Cell): boolean => {
    let d = draftRef.current;
    if (!d.laying) return true;
    const r = paintTo(g, { cells: d.laying, closed: false }, target);
    for (const st of r.states) {
      d = withLaying(d, st);
      hist.set(d);
    }
    draftRef.current = d;
    const closed = !d.laying;
    if (r.refused) setLayNote(REFUSAL_TEXT[r.refused]);
    else if (r.states.length) setLayNote(null);
    return closed;
  };

  const onGridDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.button !== 0 || !grid) return;
    e.stopPropagation();
    const svg = svgOf(e.currentTarget);
    const g = grid;
    let cur = cellAt(g, planPoint(svg, e.clientX, e.clientY));
    if (!cur) return;
    const cells = draftRef.current.laying ?? [];
    const end = cells[cells.length - 1];
    // carry on from the end of the lane (or a square next to it); a press anywhere else would lay a long L
    if (end && Math.abs(cur[0] - end[0]) + Math.abs(cur[1] - end[1]) > 1) {
      setLayNote("Carry on from the end of the lane, or drag back along it to take squares up.");
      return;
    }
    if (paintCell(g, cur) || !draftRef.current.laying?.length) return; // closed, or the first square was refused
    const id = e.pointerId; // a second finger never paints (pinch and pan come with #16)
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const c = cellAt(g, planPoint(svg, ev.clientX, ev.clientY));
      if (!c || (cur && same(c, cur))) return;
      cur = c;
      if (paintCell(g, c)) up();
    };
    const up = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // undo past the close comes back here: nothing of step 2 stays selected or armed
  useEffect(() => {
    if (!laying) return;
    setSel(null);
    setTool({ kind: "select" });
  }, [laying]);

  // wheel over a corner point: radius; Ctrl+wheel: lane width
  const wheelAcc = useRef({ key: "", px: 0 });
  const onHandleWheel = useCallback(
    (e: WheelEvent, el: Element) => {
      const i = Number(el.getAttribute("data-index"));
      const pts = draftRef.current.design.points;
      if (!(i >= 0 && i < pts.length)) return false;
      const what = wheelEdit(viewRef.current, e);
      if (!what) return false; // Quick: the wheel zooms the plan as anywhere else
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
  const lw = draft.design.laneWidth ?? 2;
  const advanced = view === "advanced";
  // problems: the shared plan renderer's checks layer alone, drawn over the lane handle rather than under it in
  // PlanView (info is never drawn, so Quick and Advanced show the same marks; Advanced adds their hover details); the
  // bake's checks lag the live line by a moment while dragging
  const problemScene = useMemo(() => ({ area: draft.area, built }), [draft.area, built]);
  const problems = (m: number) => (layers.checks ? planLayers(problemScene, { px: m, layers: ONLY_CHECKS, background: false, tips: advanced }) : "");
  // matched against the bake's own jumps, so a warning stays on its jump while the bake catches up with a drag
  const inCorner = useMemo(() => {
    const b = bake.built;
    return b && b.features.length === built.features.length ? jumpsInCorner(b.checks, b.features) : new Set<number>();
  }, [bake.built, built.features.length]);
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
        {(dragging !== null || hoverPt !== null) && <path className="ed-edges" d={lanePath(live.lanes)} vectorEffect="non-scaling-stroke" />}
        {shared && <line className="ed-shared" x1={shared.from[0]} y1={-shared.from[1]} x2={shared.to[0]} y2={-shared.to[1]} vectorEffect="non-scaling-stroke" />}
        {guides.map((g, i) => (
          <line key={i} className="ed-guide" x1={g.from[0]} y1={-g.from[1]} x2={g.to[0]} y2={-g.to[1]} vectorEffect="non-scaling-stroke" />
        ))}
        <g className={`ed-problems ${advanced ? "ed-problems-tips" : ""}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: problems(m) }} />
        {corner && corner.r > 0 && corner.th > 1e-6 && advanced && <CornerArc c={corner} />}
        {!advanced &&
          live.corners.map((c, i) =>
            c.th > 1e-3 && c.r > 0 ? (
              // the sharp corner the arc cuts back: from where the arc starts, to the point, to where it ends
              <polyline key={`sharp${i}`} className="ed-sharp" points={pts([c.start, c.P, c.end])} vectorEffect="non-scaling-stroke" />
            ) : null,
          )}
        {ghost && <polygon className="ed-ghost" points={pts(ghost)} vectorEffect="non-scaling-stroke" />}
        {built.features.map((f, i) => (
          <polygon
            key={i}
            data-handle="feature"
            className={`ed-feature ${sel?.kind === "feature" && sel.i === i ? "on" : ""} ${layers.checks && inCorner.has(i) ? "warn" : ""}`}
            points={pts(featureCorners(f))}
            onPointerDown={(e) => onFeatureDown(e, i)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <StartHandle built={built} m={m} on={sel?.kind === "start"} onPointerDown={onStartDown} />
        {!advanced && pointsList.map((p, i) => <QuickCorner key={i} p={p} i={i} m={m} touch={touch} on={sel?.kind === "point" && sel.i === i} onPointerDown={(e) => onPointDown(e, i)} onDelete={() => {
          setSel({ kind: "point", i });
          selRef.current = { kind: "point", i };
          deleteSelection();
        }} onHover={(on) => setHoverPt(on ? i : null)} />)}
        {!advanced &&
          pointsList.map((p, i) => {
            const a = apexOf(pointsList, i, lw);
            const c = live.corners[i];
            if (!a || !c) return null;
            const h = handlePoint(a, c.r);
            const reduced = isReduced(p, c);
            const showR = reduced || (sel?.kind === "point" && sel.i === i) || dragging === i;
            const apexNow = Math.max(0, c.r - c.w / 2);
            return (
              <g key={`apex${i}`}>
                {showR && (
                  <text className="ed-label" x={h[0] + a.b[0] * 18 * m} y={-(h[1] + a.b[1] * 18 * m)} dy={4 * m} fontSize={12 * m} strokeWidth={3 * m} textAnchor="middle">
                    R {fmt.metres(apexNow, 1)}
                    {reduced ? " (max)" : ""}
                  </text>
                )}
                <circle className={`ed-apex ${sel?.kind === "point" && sel.i === i ? "on" : ""}`} cx={h[0]} cy={-h[1]} r={APEX_PX * m} vectorEffect="non-scaling-stroke" />
                <circle data-handle="apex" className="ed-hit ed-hit-apex" cx={h[0]} cy={-h[1]} r={(touch ? TOUCH_PX : APEX_PX + 3) * m} onPointerDown={(e) => onApexDown(e, i)} onPointerEnter={() => setHoverPt(i)} onPointerLeave={() => setHoverPt(null)}>
                  <title>{`Corner ${i + 1}: drag in or out to cut the corner back (apex radius ${fmt.metres(apexNow, 1)})`}</title>
                </circle>
              </g>
            );
          })}
        {advanced && pointsList.map((p, i) => (
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
            onPointerEnter={() => setHoverPt(i)}
            onPointerLeave={() => setHoverPt(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSel({ kind: "point", i });
              selRef.current = { kind: "point", i };
              deleteSelection();
            }}
            vectorEffect="non-scaling-stroke"
          >
            <title>{advanced ? `Corner ${i + 1}: drag to move, wheel for radius, Ctrl+wheel for lane width, right-click to delete` : `Corner ${i + 1}: drag to move, right-click to delete`}</title>
          </circle>
        ))}
        {pointsList.map((p, i) => {
          if (!advanced || !hasMitre(pointsList, i, lw)) return null;
          const mp = mitrePoint(pointsList, i, lw);
          if (!mp) return null;
          const s = MITRE_PX * m;
          return (
            <rect
              key={`m${i}`}
              data-handle="mitre"
              className={`ed-mitre ${sel?.kind === "point" && sel.i === i ? "on" : ""}`}
              x={mp[0] - s}
              y={-mp[1] - s}
              width={2 * s}
              height={2 * s}
              transform={`rotate(45 ${mp[0]} ${-mp[1]})`}
              onPointerDown={(e) => onMitreDown(e, i)}
              onPointerEnter={() => setHoverPt(i)}
              onPointerLeave={() => setHoverPt(null)}
              vectorEffect="non-scaling-stroke"
            >
              <title>Outside corner of the pipes: drag it — snaps to walls, the hall's corners and other pipes</title>
            </rect>
          );
        })}
        {dragging !== null &&
          [dragging - 1, dragging, dragging + 1].map((k) => {
            const i = (k + pointsList.length) % pointsList.length;
            const deg = turnDegrees(pointsList, i);
            if (deg <= SHARP_TURN) return null;
            const q = pointsList[i];
            return (
              <text key={`sharp${i}`} className="ed-badge" x={q.x} y={-q.z + 22 * m} fontSize={12 * m} strokeWidth={3 * m} textAnchor="middle">
                ⚠ {Math.round(deg)}° turn
              </text>
            );
          })}
        {selPt && corner && advanced && (
          <text className="ed-label" x={selPt.x} y={-selPt.z - 16 * m} fontSize={12 * m} strokeWidth={3 * m} textAnchor="middle">
            r {fmtR(selPt.radius ?? 1, corner.r)} · lane {fmt.metres(selPt.width ?? draft.design.laneWidth ?? 2, 2)}
          </text>
        )}
      </g>
    );
  };

  const layOverlay = (m: number) => {
    if (!grid) return null;
    const g = grid;
    const cells = draft.laying ?? [];
    const box = (c: Cell) => {
      const [x, z] = cellCorner(g, c);
      return { x, y: -(z + g.size), width: g.size, height: g.size };
    };
    const [x0, z0] = g.origin;
    const W = g.cols * g.size, H = g.rows * g.size;
    let lines = "";
    for (let c = 0; c <= g.cols; c++) lines += `M${x0 + c * g.size} ${-z0}V${-(z0 + H)}`;
    for (let r = 0; r <= g.rows; r++) lines += `M${x0} ${-(z0 + r * g.size)}H${x0 + W}`;
    const centres = cells.map((c) => cellCentre(g, c));
    const end = cells[cells.length - 1];
    return (
      <g className="lay">
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width={0.35} height={0.35} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.35} className="lay-hatch" strokeWidth={0.1} />
          </pattern>
        </defs>
        {[...g.blocked].map((k) => {
          const c = k.split(",").map(Number) as Cell;
          return <rect key={k} className="lay-blocked" {...box(c)} fill={`url(#${hatchId})`} />;
        })}
        {cells.map((c) => (
          <rect key={`${c[0]},${c[1]}`} className="lay-cell" {...box(c)} />
        ))}
        <path className="lay-grid" d={lines} vectorEffect="non-scaling-stroke" />
        {end && <rect className="lay-end" {...box(end)} vectorEffect="non-scaling-stroke" />}
        {centres.length > 1 && <polyline className="lay-line" points={pts(centres)} vectorEffect="non-scaling-stroke" />}
        {centres[0] && <circle className="lay-first" cx={centres[0][0]} cy={-centres[0][1]} r={Math.min(g.size / 4, 9 * m)} vectorEffect="non-scaling-stroke" />}
        <rect data-handle="grid" className="lay-hit" x={x0} y={-(z0 + H)} width={W} height={H} onPointerDown={onGridDown}>
          <title>{cells.length ? "Drag on from the end of the lane; drag back to take squares up" : "Press on a square and drag to lay the lane"}</title>
        </rect>
      </g>
    );
  };

  // ------------------------------------------------------------------------------------ layout
  const status = base?.track;
  const showSubmit = !!me && mode === "edit" && !!base?.can.submit;
  const blocked = submitBlock({ dirty, pending: bake.pending, checks: built.checks, points: pointsList });
  const venueName = fromVenue?.name ?? (draft.basedOn ? status?.venue?.name ?? draft.basedOn.venueTemplate : undefined);
  const backTo = mode === "edit" && base ? { to: `/t/${base.id}`, label: "Back to track" } : { to: "/new", label: "Start over" };
  const showCheck = (x: number, z: number) => {
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
  };

  if (phone) {
    return (
      <div className="designer designer-phone">
        <div className="designer-bar">
          <Link to={backTo.to} className="btn btn-quiet btn-icon back" aria-label={backTo.label}>
            <ChevronLeft size={20} aria-hidden="true" />
          </Link>
          <p className="designer-name">{draft.info.name || "Untitled track"}</p>
        </div>
        <div className="phone-body">
          <div className="empty">
            <Monitor size={36} className="empty-icon" aria-hidden="true" />
            <h1>Design on a laptop or tablet</h1>
            <p>The designer needs a bigger screen. You can look at the plan here, and pick up where you left off on a laptop or tablet.</p>
            {mode === "edit" && !dirty ? (
              <CopyButton text={window.location.href} label="Copy link to this design" className="btn btn-touch" />
            ) : (
              <p>Changes you haven't saved stay in this browser until you save them.</p>
            )}
          </div>
          <PlanView area={draft.area} obstacles={draft.obstacles} built={laying ? undefined : built} rostrum={rostrum} interactive={false} label={`Plan of ${draft.info.name || "this track"}, view only`} className="phone-plan" />
          <dl className="figures">
            <div>
              <dd>{laying ? "—" : fmt.metres(live.total)}</dd>
              <dt>Lap</dt>
            </div>
            <div>
              <dd>{built.stats.corners || "—"}</dd>
              <dt>Corners</dt>
            </div>
            <div>
              <dd>{status ? fmt.STATUS_LABEL[status.status] : "Not saved"}</dd>
              <dt>Status</dt>
            </div>
          </dl>
        </div>
      </div>
    );
  }

  return (
    <div className={`designer designer-${view}`}>
      <div className="designer-bar">
        <Link to={backTo.to} className="btn btn-quiet btn-icon back" aria-label={backTo.label} title={backTo.label}>
          <ChevronLeft size={20} aria-hidden="true" />
        </Link>
        <input className="name-input" aria-label="Track name" value={draft.info.name} maxLength={80} onChange={(e) => update((d) => ({ ...d, info: { ...d.info, name: e.target.value } }), "name")} />
        <span className="designer-venue">
          {venueName ? `${venueName} · ` : ""}
          {fmt.size(draft.area, true)}
        </span>
        {status && <StatusBadge status={status.status} />}
        {(view === "quick" || laying) && (
          <Steps
            step={step}
            armed={backArmed}
            onBack={() => {
              if (!backArmed) return setBackArmed(true);
              setBackArmed(false);
              setSel(null);
              update((d) => reopenLaying(d));
              setLayNote(null);
            }}
          />
        )}
        <div className="mode-toggle" role="group" aria-label="Mode">
          {(["quick", "advanced"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={view === m} onClick={() => setView(m)} title={m === "quick" ? "The essentials: move, add and delete corners, jumps, start line" : "Everything: corner radius, lane widths, outside corners, fine and free snapping, all checks"}>
              {m === "quick" ? "Quick" : "Advanced"}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-icon" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={20} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-icon" onClick={hist.redo} disabled={!hist.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={20} aria-hidden="true" />
        </button>
        <span className="save-state" aria-live="polite">
          {dirty ? "Unsaved changes · kept on this device" : base ? `Saved · revision ${base.revision}` : "Not saved yet"}
        </span>
        {me ? (
          <button type="button" className={`btn ${showSubmit ? "" : "btn-primary"}`} onClick={() => setSaveOpen((o) => !o)} disabled={saving || laying || (!dirty && mode === "edit")} aria-expanded={saveOpen} title={laying ? "Close the loop first" : undefined}>
            {saving ? "Saving…" : mode === "new" ? "Save track" : "Save revision"}
          </button>
        ) : (
          <a className="btn btn-primary" href={loginUrl()}>
            Log in to save
          </a>
        )}
        {showSubmit && (
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!!blocked} aria-describedby={blocked ? "submit-why" : undefined} title={blocked ?? "Send to the organisers for approval"}>
            Submit track
          </button>
        )}
        {saveOpen && me && !laying && (
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

      {(restore || !me || message || status?.approvedRevision) && (
        <div className="designer-messages">
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
        </div>
      )}

      <div className="designer-grid">
        {laying ? (
          <aside className="designer-palette" aria-label="Lay the lanes">
            <span className="label">1 · Lay the lanes</span>
            <p className="lay-help">Press on a square and drag through the squares in driving order. Drag back to take squares up.</p>
            <p className="lay-help">Come back to the first square (the ring) to close the loop.</p>
            <button
              type="button"
              className="palette-btn"
              disabled={!draft.laying?.length}
              onClick={() => {
                update((d) => withLaying(d, { cells: [], closed: false }));
                setLayNote(null);
              }}
              title="Take up the whole lane (Undo brings it back)"
            >
              Start again
            </button>
          </aside>
        ) : (
        <aside className="designer-palette" aria-label="Add to the track">
          <span className="label">Jumps</span>
          <JumpPalette
            jumps={paletteJumps(view)}
            armed={tool.kind === "feature" ? tool.type : null}
            onPick={(t) => setTool(tool.kind === "feature" && tool.type === t ? { kind: "select" } : { kind: "feature", type: t })}
          />
          <span className="label label-gap">Track</span>
          <button
            type="button"
            className="palette-btn"
            aria-pressed={sel?.kind === "start"}
            onClick={() => {
              setTool({ kind: "select" });
              setSel({ kind: "start" });
              setHighlight([built.startLine.x, built.startLine.z]);
            }}
            title="Select the start line, then drag it along the track"
          >
            Start line
          </button>
          {!advanced && (
            <button
              type="button"
              className="palette-btn"
              aria-pressed={laneSnap}
              onClick={() => setLaneSnap((v) => !v)}
              title="Corners snap to a lane line within 0.2 m. Turn it off (or hold Alt) to place them freely."
            >
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
                  aria-checked={snap.mode === m}
                  className={snap.mode === m ? "on" : ""}
                  onClick={() => setSnap({ mode: m })}
                  title={m === "lanes" ? "Lanes: points on the lane grid, lanes against the walls and beside each other" : m === "fine" ? "Fine: 25 cm grid and 45° (hold Shift)" : "Free: no snapping (hold Alt)"}
                >
                  {SNAP_LABEL[m]}
                </button>
              ))}
              <span className="snap-info">Shift: fine · Alt: free</span>
            </div>
          )}
          <p className="palette-help">
            {tool.kind === "feature" ? `Click on the racing line to place the ${fmt.FEATURE_LABEL[tool.type].toLowerCase()}. Esc to cancel.` : "Pick a jump, then click on the racing line to place it."}
          </p>
        </aside>
        )}

        <section className="designer-plan-wrap" aria-label="Plan">
          {snapInfo ? (
            <div className="designer-hint" aria-live="polite">
              <b>{SNAP_LABEL[snapInfo.mode]}</b>
              {snapInfo.tags.length > 0 && <> · {snapInfo.tags.join(" · ")}</>}
            </div>
          ) : (
            <div className="designer-hint">
              {laying
                ? layNote ?? (draft.laying?.length
                  ? "Drag on through the squares. Come back to the ring to close the loop."
                  : "Press on a square and drag to lay the lane.")
                : tool.kind === "feature"
                  ? "Click on the racing line to place it."
                  : advanced
                    ? "Click a straight to add a corner. Drag a corner to move it."
                    : sel?.kind === "point"
                      ? `Tap the floor to add a corner after corner ${sel.i + 1}. Tap corner ${sel.i + 1} again to stop.`
                      : "Drag a corner to move it, or its inside handle to cut it back. Tap the track to add a corner."}
            </div>
          )}
          <PlanView
            area={draft.area}
            obstacles={draft.obstacles}
            built={laying ? undefined : built}
            rostrum={rostrum}
            checksInOverlay
            designFeatures={draft.design.features}
            layers={layers}
            onLayersChange={setLayers}
            highlight={highlight}
            label={`Designer plan of ${draft.info.name}`}
            className="designer-plan"
            overlay={laying ? layOverlay : overlay}
            onHandleWheel={onHandleWheel}
            onBackgroundClick={(e) => {
              setHighlight(null);
              // Quick step 2: a tap on the floor adds a corner (after the selected one, or into the track it's near)
              if (!laying && view === "quick" && tool.kind === "select" && (sel === null || sel.kind === "point")) {
                addCornerAt(planPoint(e.currentTarget, e.clientX, e.clientY), e.altKey);
                return;
              }
              setSel(null);
            }}
          />
        </section>

        {laying ? (
          <aside className="designer-side" aria-label="The lane so far">
            <section className="checks-panel" aria-labelledby="ck-h">
              <h2 id="ck-h">Checks</h2>
              <p className="hint">The track is checked once the loop is closed.</p>
            </section>
            <dl className="figures designer-stats">
              <div>
                <dd>{draft.laying?.length ?? 0}</dd>
                <dt>Squares</dt>
              </div>
              <div>
                <dd>{fmt.metres(grid?.size ?? 2, 1)}</dd>
                <dt>Lane width</dt>
              </div>
            </dl>
          </aside>
        ) : (
          <aside className="designer-side" aria-label="Checks">
            <ChecksPanel checks={built.checks} view={view} pending={bake.pending} blocked={showSubmit ? blocked : null} ready={showSubmit && !blocked} onShow={showCheck} />
            <SelectionPanel sel={sel} view={view} draft={draft} live={live} update={update} onDelete={deleteSelection} fromVenue={venueName} inCorner={inCorner} />
            {advanced && <Shortcuts />}
            <Stats built={built} live={live} view={view} />
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * Quick mode's steps: 1 lays the lanes, 2 shapes the loop. From step 2, "1 · Lay the lanes" goes back on a second tap,
 * throwing the shaping away (Undo brings it back).
 */
function Steps({ step, armed, onBack }: { step: 1 | 2; armed: boolean; onBack: () => void }) {
  return (
    <ol className="steps" aria-label="Steps">
      {(["Lay the lanes", "Shape it"] as const).map((label, i) => (
        <li key={label} aria-current={step === i + 1 ? "step" : undefined}>
          {step === 2 && i === 0 ? (
            <button type="button" className={`step-back ${armed ? "armed" : ""}`} onClick={onBack} title="Go back to laying the lanes: the shaping is thrown away (Undo brings it back)">
              {armed ? "Tap again to go back" : `1 · ${label}`}
            </button>
          ) : (
            <>
              {i + 1} · {label}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

const SNAP_LABEL: Record<SnapMode, string> = { lanes: "Lanes", fine: "Fine", free: "Free" };

const fmtR = (want: number, got: number) => (Math.abs(want - got) > 0.01 ? `${want.toFixed(2)}→${got.toFixed(2)} m` : `${want.toFixed(2)} m`);

/** Quick step 2: a corner point, numbered in driving order; on touch screens it takes a press 44 px across. */
function QuickCorner({ p, i, m, touch, on, onPointerDown, onDelete, onHover }: { p: DesignPoint; i: number; m: number; touch: boolean; on: boolean; onPointerDown: (e: React.PointerEvent<SVGElement>) => void; onDelete: () => void; onHover: (on: boolean) => void }) {
  const r = (on ? CORNER_PX + 2 : CORNER_PX) * m;
  return (
    <g
      data-handle="point"
      className={`ed-corner ${on ? "on" : ""}`}
      onPointerDown={onPointerDown}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        onDelete();
      }}
    >
      <title>{`Corner ${i + 1}: drag to move (Alt: no snapping), right-click to delete`}</title>
      {touch && <circle className="ed-hit" cx={p.x} cy={-p.z} r={TOUCH_PX * m} />}
      <circle className="ed-corner-dot" cx={p.x} cy={-p.z} r={r} vectorEffect="non-scaling-stroke" />
      <text className="ed-corner-n" x={p.x} y={-p.z} dy={4 * m} fontSize={11 * m} textAnchor="middle">
        {i + 1}
      </text>
    </g>
  );
}

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

function Stats({ built, live, view }: { built: Built; live: Live; view: DesignerMode }) {
  return (
    <dl className="figures designer-stats">
      <div>
        <dd>{fmt.metres(live.total)}</dd>
        <dt>Lap</dt>
      </div>
      <div>
        <dd>{built.stats.corners || "—"}</dd>
        <dt>Corners</dt>
      </div>
      <div>
        <dd>{built.features.length}</dd>
        <dt>Jumps</dt>
      </div>
      {view === "advanced" && (
        <>
          <div>
            <dd>{fmt.size(built.size, true)}</dd>
            <dt>Size</dt>
          </div>
          <div>
            <dd>{built.stats.dividerLength ? `${Math.round(built.stats.dividerLength)} m` : "—"}</dd>
            <dt>Pipe</dt>
          </div>
        </>
      )}
    </dl>
  );
}

const CHECK_ICON = { error: CircleX, warning: TriangleAlert, info: Info } as const;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function ChecksPanel({
  checks,
  view,
  pending,
  blocked,
  ready,
  onShow,
}: {
  checks: Check[];
  view: DesignerMode;
  pending: boolean;
  blocked: string | null;
  ready: boolean;
  onShow: (x: number, z: number) => void;
}) {
  const shown = visibleChecks(checks, view);
  const { errors, warnings } = checkCounts(checks);
  return (
    <section className="checks-panel" aria-labelledby="ck-h">
      <h2 id="ck-h">
        Checks {pending && <span className="pending" title="Updating">…</span>}
      </h2>
      {shown.length === 0 ? (
        <ul className="checks">
          <li className="check check-ok">
            <CircleCheck size={16} aria-hidden="true" />
            <span>{pending ? "Checking…" : ready ? "No problems. Ready to submit." : "No problems found."}</span>
          </li>
        </ul>
      ) : (
        <>
          <p className="check-counts" aria-live="polite">
            {errors > 0 && <span className="lvl-error">{plural(errors, "error")}</span>}
            {warnings > 0 && <span className="lvl-warning">{plural(warnings, "warning")}</span>}
            {errors + warnings === 0 && <span>Notes only</span>}
          </p>
          <ul className="checks">
            {shown.map((c, i) => {
              const Icon = CHECK_ICON[c.level];
              return (
                <li key={i} className={`check check-${c.level}`}>
                  <Icon size={16} aria-label={c.level === "error" ? "Error" : c.level === "warning" ? "Warning" : "Note"} />
                  <span>
                    {c.message}
                    {view === "advanced" && <code className="check-code">{c.code}</code>}
                  </span>
                  {c.x !== undefined && c.z !== undefined && (
                    <button type="button" className="check-show" onClick={() => onShow(c.x!, c.z!)}>
                      Show
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {blocked && (
        <p id="submit-why" className="submit-why">
          {blocked}
        </p>
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

export function SelectionPanel({
  sel,
  view,
  draft,
  live,
  update,
  onDelete,
  fromVenue,
  inCorner,
}: {
  sel: Selection;
  view: DesignerMode;
  draft: Draft;
  live: Live;
  update: (fn: (d: Draft) => Draft, group?: string) => void;
  onDelete: () => void;
  fromVenue?: string;
  /** jumps on or landing into a corner */
  inCorner: Set<number>;
}) {
  const setPoint = (i: number, patch: Partial<DesignPoint>, key: string) =>
    update((d) => ({ ...d, design: { ...d.design, points: d.design.points.map((p, k) => (k === i ? { ...p, ...patch } : p)) } }), `${key}:${i}`);
  const setFeature = (i: number, patch: Partial<DesignFeature>, key: string) =>
    update((d) => ({ ...d, design: { ...d.design, features: (d.design.features ?? []).map((f, k) => (k === i ? { ...f, ...patch } : f)) } }), `f${key}:${i}`);

  if (sel?.kind === "point") {
    const p = draft.design.points[sel.i];
    const c = live.corners[sel.i];
    if (!p) return null;
    if (view === "quick") {
      const lw = draft.design.laneWidth ?? 2;
      const turns = !!apexOf(draft.design.points, sel.i, lw);
      const apex = apexRadius(p, lw);
      const reduced = !!c && isReduced(p, c);
      const setTo = (a: number, key: string) => update((d) => ({ ...d, design: { ...d.design, points: setApex(d.design.points, sel.i, a, lw) } }), `${key}:${sel.i}`);
      return (
        <section className="sel-panel" aria-labelledby="sel-h">
          <h2 id="sel-h">Corner {sel.i + 1}</h2>
          <p className="sel-turn">{turnLabel(draft.design.points, sel.i)}</p>
          {turns ? (
            <>
              <div className="fields">
                <NumberField label="Apex radius" value={Math.round(apex * 10) / 10} step={0.1} min={0} max={APEX_MAX} onChange={(v) => v !== undefined && setTo(v, "apex")} />
              </div>
              <div className="sizes" role="group" aria-label="Quick sizes">
                {QUICK_SIZES.map((q) => (
                  <button key={q.label} type="button" className="palette-btn" aria-pressed={Math.abs(apex - q.apex) < 0.005} onClick={() => setTo(q.apex, `size${q.label}`)} title={`Apex radius ${q.apex.toFixed(1)} m`}>
                    {q.label} <span className="size-m">{q.apex.toFixed(1)} m</span>
                  </button>
                ))}
              </div>
              <div role="status">
                {reduced && c && (
                  <p className="hint">
                    Cut back as far as the straights allow: the apex radius is {fmt.metres(Math.max(0, c.r - widthAt(p, lw) / 2), 1)} (max).
                  </p>
                )}
              </div>
              <p className="hint">Drag the corner to move it, or its inside handle to cut it back. Right-click it or press Delete to remove it.</p>
            </>
          ) : (
            <p className="hint">This corner is on a straight line: drag it to make a turn, or delete it.</p>
          )}
          <button type="button" className="btn btn-danger" onClick={onDelete} disabled={draft.design.points.length <= MIN_CORNERS}>
            Delete corner
          </button>
        </section>
      );
    }
    return (
      <section className="sel-panel" aria-labelledby="sel-h">
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
    // below the Delete button, so it never moves the button; the status region is always there so it's announced
    const warn = (
      <div role="status">
        {inCorner.has(sel.i) && (
          <p className="sel-warning">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>This {fmt.FEATURE_LABEL[f.type].toLowerCase()} is on or lands into a corner. Slide it onto a straight.</span>
          </p>
        )}
      </div>
    );
    if (view === "quick")
      return (
        <section className="sel-panel" aria-labelledby="sel-h">
          <h2 id="sel-h">{fmt.FEATURE_LABEL[f.type]}</h2>
          <p className="hint">Drag it along the track to move it.</p>
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete {fmt.FEATURE_LABEL[f.type].toLowerCase()}
          </button>
          {warn}
        </section>
      );
    return (
      <section className="sel-panel" aria-labelledby="sel-h">
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
        {warn}
      </section>
    );
  }
  if (sel?.kind === "start") {
    if (view === "quick")
      return (
        <section className="sel-panel" aria-labelledby="sel-h">
          <h2 id="sel-h">Start line</h2>
          <p className="hint">Drag the line along the track. Cars start towards the arrow.</p>
        </section>
      );
    return (
      <section className="sel-panel" aria-labelledby="sel-h">
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
  // nothing selected: the track's own settings (Advanced only)
  if (view === "quick") return null;
  const rostrum = draft.design.rostrum ?? { side: "south" as Side };
  return (
    <section className="sel-panel" aria-labelledby="sel-h">
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
    <details className="sel-panel shortcuts">
      <summary>How to draw</summary>
      <ul>
        <li>
          <b>Drag</b> a corner point (the small dot is the racing line; the diamond is the outside corner of the pipes). Snap:
          lanes against the walls and beside other lanes; <kbd>Shift</kbd> = 25 cm grid, <kbd>Alt</kbd> = free.
        </li>
        <li>
          <kbd>H</kbd> on a corner: make it a hairpin (two points a lane apart).
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
