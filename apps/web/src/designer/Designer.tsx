// The track designer: drag corner points, click a straight to add one, wheel for radius / Ctrl+wheel for lane width,
// place and slide jumps and the start line, live checks, undo/redo, save as a new revision, local auto-save.
// Quick mode (the default) lays the lanes (step 1, lanes.ts), then shapes the corners by apex radius (step 2, shape.ts);
// Advanced shows every per-corner control. See mode.ts. On a tablet, Quick mode has its own layout (#16): the plan
// with a dock of 44 px+ controls, pinch and pan with two fingers, long-press a corner for its panel.
// The state (draft, history, bake, tool, selection, snap) and the plan's editing overlay live here; the bar, palette,
// plan chrome and panels are components taking props (DesignerBar, ToolPalette, PlanOverlays, SidePanels), and
// DesignerLayout places them for a laptop, a tablet or a phone (#120).
import {
  ALL_PLAN_LAYERS,
  outerStyle,
  drawingArea,
  planLayers,
  type Area,
  type Built,
  type BuiltFeature,
  type Check,
  type CheckLevel,
  type DesignFeature,
  type DesignPoint,
  type FeatureType,
  type PlanLayers,
  type Point2,
  type DrawnFor,
  type RcTrack,
  type RcVenue,
  type Side,
} from "@track-studio/engine";
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { DEFAULT_LAYERS, PlanView, type Layers } from "../components/PlanView.js";
import { Skeleton } from "../components/states.js";
import { ApiError, api, post, type Permissions, type TrackResponse, type TrackSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi, useDebounced, useMediaQuery, useSessionChoice, useStored } from "../lib/hooks.js";
import { LONG_PRESS_MS, slopFor } from "../lib/touch.js";
import { featureCorners, lanePath, laneRuns, pts } from "../lib/plan.js";
import { useSession } from "../lib/session.js";
import { useHoldReload } from "../lib/version.js";
import { insertionFor, liveGeometry, nearestOnLine, placeFeature, roundTo, tooClose, wheelRadius, wrapDistance, type Guide, type Live } from "./geometry.js";
import { useHistory, type HistoryState } from "./history.js";
import { reverseDraft } from "./reverse.js";
import {
  addJump,
  allows,
  deleteJump,
  insertPoint,
  jumpsInCorner,
  MODE_KEY,
  moveJump,
  movePoint,
  paletteJumps,
  readMode,
  snapModeFor,
  submitBlock,
  wheelEdit,
  type DesignerMode,
} from "./mode.js";
import { hasMitre, keepPinned, tidy, makeHairpin, mitrePoint, pinnedCorners, placeByMitre, SHARP_TURN, snapCentre, snapInsertion, snapMitre, turnDegrees, type SnapMode, type SnapResult, type SnapTag } from "./snap.js";
import { cellAt, cellCentre, cellCorner, designStep, dragCell, gridFor, neighbours, paintTo, REFUSAL_TEXT, releaseStep, reopenLaying, same, withLaying, type Cell, type LaneGrid, type Laying, type Refusal } from "./lanes.js";
import { alongBisector, apexOf, deleteCorner, handlePoint, insertAfter, insertNearTrack, isReduced, MIN_CORNERS, placeCorner, radiusFromDrag, followTravel, type Seen, widthAt } from "./shape.js";
import { findNests, followNest, linkedTo } from "./nest.js";
import { describeLane, layKey, startCursor, type LayKeys } from "./laykeys.js";
import { useBake } from "./useBake.js";
import { DesignerLayout } from "./DesignerLayout.js";
import { VIEWS } from "./PlanOverlays.js";
import type { PanelProps } from "./SidePanels.js";
import type { ToolsProps } from "./ToolPalette.js";
import { addCrossover, bridgeCrossing, makeCrossover, moveCrossover, moveStart } from "./crossings.js";
import { addKey, floorTap, keyInsert, lanePress, stepCorner } from "./addtool.js";
import { defaultRostrumSide } from "../viewer3d/rostrum.js";
import type { Highlight } from "../viewer3d/scene.js";
import { hasWebGL } from "../viewer3d/support.js";
import type { KeptCamera } from "../viewer3d/Viewer3D.js";

// the 3D preview (#85): three.js and the viewer load only when 3D is opened
const Viewer3D = lazy(() => import("../viewer3d/Viewer3D.js"));
/** 3D waits this long after the last bake before it rebuilds, so a drag doesn't rebuild it on every step */
const BAKE_SETTLE_MS = 200;

// ---------------------------------------------------------------------------------------------- tuning
import { RADIUS_RANGE, WHEEL_PX_PER_STEP, WHEEL_STEP, WHEEL_WIDTH_STEP, WIDTH_RANGE } from "./tuning.js";
export { RADIUS_RANGE, WHEEL_PX_PER_STEP, WHEEL_STEP, WHEEL_WIDTH_STEP, WIDTH_RANGE };
const HANDLE_PX = 5; // centre (racing-line) point handle radius on screen
const MITRE_PX = 6; // outside-corner handle half-size on screen
const GRAB_PX = 14; // a press on the track this close to a corner point grabs the point (instead of adding one)
const CORNER_PX = 10; // Quick step 2: numbered corner handle radius on screen
const APEX_PX = 6; // Quick step 2: apex handle radius on screen
const TOUCH_PX = 22; // touch screens: handles take a press this far out (44 px across)
const CORNER_TOUCH_PX = 13; // touch screens: the numbered corner handle, drawn bigger
const APEX_TOUCH_PX = 8; // touch screens: the apex handle, drawn bigger
/** how long "1 · Lay the lanes" waits for the second tap that confirms it */
const CONFIRM_MS = 4000;
/** narrower than this, the designer shows a view-only plan */
export const PHONE_QUERY = "(max-width: 640px)";
/** touch screens (tablets): bigger handles, and a toggle for free placement since there's no Alt */
export const TOUCH_QUERY = "(pointer: coarse)";

/** What the designer edits and saves. Nothing of a venue but its name: the guide (area, obstacles) is loaded live. */
export interface Draft {
  info: { name: string; description?: string; drawnFor?: DrawnFor };
  /** the drawing area */
  area: Area;
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

export type Selection = { kind: "point"; i: number } | { kind: "feature"; i: number } | { kind: "start" } | null;
/** select (the default), the Add point tool (#114), or a jump armed from the palette */
export type Tool = { kind: "select" } | { kind: "add" } | { kind: "feature"; type: FeatureType };

export interface DesignerProps {
  mode: "new" | "edit";
  initial: Draft;
  base?: DesignerBase;
  /** new tracks started from a venue template */
  fromVenue?: { id: string; name: string };
  storageKey: string;
}

/** The layout to save (rctrack 1.7): name, drawing area, the venue it was drawn for (a label), the design. */
export function toDoc(d: Draft, base?: { id: string; revision: number; doc: RcTrack }): RcTrack {
  const info = { ...(base?.doc.info ?? {}), name: d.info.name };
  if (d.info.description) (info as RcTrack["info"]).description = d.info.description;
  else delete (info as RcTrack["info"]).description;
  if (d.info.drawnFor) info.drawnFor = d.info.drawnFor;
  else delete info.drawnFor;
  return { format: "rctrack", version: 1, id: base?.id ?? "new", revision: (base?.revision ?? 0) + 1, info, area: d.area, design: d.design };
}

/** A new design (from a venue template or a blank area): it opens in step 1 with nothing laid. */
export function newDraft({ area, name, drawnFor, laneWidth = 2 }: { area: Area; name: string; drawnFor?: DrawnFor; laneWidth?: number }): Draft {
  return { info: { name, ...(drawnFor ? { drawnFor } : {}) }, area, laying: [], design: { laneWidth, points: [], features: [], start: { distance: 0 } } };
}

export function draftFromDoc(doc: RcTrack): Draft {
  const { rostrum: _r, ...design } = doc.design as RcTrack["design"] & { rostrum?: unknown }; // a 1.6 design's rostrum is dropped
  return {
    info: { name: doc.info.name, ...(doc.info.description ? { description: doc.info.description } : {}), ...(doc.info.drawnFor ? { drawnFor: doc.info.drawnFor } : {}) },
    area: drawingArea(doc),
    design: { laneWidth: 2, features: [], start: { distance: 0 }, ...design },
  };
}

export interface Autosave {
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
/** Enter on a focused button, link or disclosure is that control's own; the Add point button's adds a point */
const isControl = (t: EventTarget | null) => t instanceof Element && !!t.closest("button, a, summary") && !t.closest("[data-add-tool]");
/** the Add point tool's keys (#114), which wait for 2D like the other editing keys */
const ADD_KEYS = ["a", "A", "n", "N", "p", "P", "Enter"];

/** the plan's checks layer on its own (the designer's problem marks) */
const ONLY_CHECKS = Object.fromEntries(Object.keys(ALL_PLAN_LAYERS).map((k) => [k, k === "checks"])) as PlanLayers;

/** Where the armed jump would go: a crossover snaps onto a crossing, sized for it. */
function ghostFeature(live: Live, type: FeatureType, hover: { s: number; at: Point2 }): BuiltFeature {
  if (type !== "crossover") return placeFeature(live, { type, distance: hover.s });
  const f = addCrossover([], live.crossings, hover.at, hover.s, live.total).features[0];
  const k = live.crossings.findIndex((c) => c.distances.includes(f.distance));
  return placeFeature(live, f, k < 0 ? undefined : live.spans[k][f.over === "second" ? 1 : 0]);
}

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
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hover, setHover] = useState<{ s: number; at: Point2 } | null>(null);
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
  const histRef = useRef(hist);
  histRef.current = hist;
  // which way the last undo / redo went, for step 1's announcement (#47)
  const travelRef = useRef<"Undone." | "Redone.">("Undone.");
  const undo = useCallback(() => ((travelRef.current = "Undone."), hist.undo()), [hist.undo]);
  const redo = useCallback(() => ((travelRef.current = "Redone."), hist.redo()), [hist.redo]);
  // undo / redo that adds or takes away corners lets the selection go (both modes), so the next edit or insert can't land
  // on the wrong corner. Judged from the history state against what was last rendered, so two undos before a render count.
  const seenRef = useRef<Seen>({ travels: hist.travels, points: draft.design.points });
  useLayoutEffect(() => {
    const seen = seenRef.current;
    const now = { travels: hist.travels, points: draft.design.points };
    seenRef.current = now;
    if (now.travels !== seen.travels) setSel((s) => followTravel(s, seen, now));
  }, [hist.travels, draft.design.points]);
  const phone = useMediaQuery(PHONE_QUERY);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const touch = useMediaQuery(TOUCH_QUERY);
  /** Quick step 2: snapping to lane lines (off places corners freely, like holding Alt) */
  const [laneSnap, setLaneSnap] = useState(true);
  const laneSnapRef = useRef(laneSnap);
  laneSnapRef.current = laneSnap;
  /** tablets, in Quick mode: the plan with a dock, and the panels as a sheet over it */
  const tablet = touch && view === "quick";
  /** tablet: the sheet over the plan shows the selected corner's panel (opened by a long-press) or the checks */
  const [sheet, setSheet] = useState<"selection" | "checks" | null>(null);
  /** a finger held on a corner: the ring fills over LONG_PRESS_MS, then it's selected (`done`) */
  const [press, setPress] = useState<{ i: number; done: boolean } | null>(null);
  /** bumped by the dock's zoom-to-fit */
  const [fitRequest, setFitRequest] = useState(0);
  /** the one-finger edit going on (a drag, painting), so a second finger can take it back */
  const edit = useRef<{ cancel: () => void } | null>(null);
  /** what to put back if a second finger cancels the edit this press starts */
  const before = () => ({ hist: histRef.current.state as HistoryState<Draft>, sel: selRef.current, tool: toolRef.current });
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
  // the venue it's drawn for, loaded live as a guide (area and obstacles shown, never saved); none if it's gone
  const guide = useApi<{ doc: RcVenue }>(draft.info.drawnFor ? `/api/venues/${encodeURIComponent(draft.info.drawnFor.venueTemplate)}` : null).data?.doc ?? null;
  const guideObstacles = useMemo(() => guide?.obstacles ?? [], [guide]);
  // the draft as drawn and saved: on the guide's area while there is one (the template may have changed since)
  const area = guide?.area ?? draft.area;
  const drawn = useMemo(() => (area === draft.area ? draft : { ...draft, area }), [draft, area]);
  const areaRef = useRef(area);
  areaRef.current = area;
  const grid = useMemo(() => (laying ? gridFor(drawn, guideObstacles) : null), [laying, drawn.area, guideObstacles, draft.design.laneWidth]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useMemo(() => liveGeometry(laying ? NO_TRACK : draft.design), [laying, draft.design]);
  const doc = useMemo(() => (laying ? null : toDoc(drawn, base)), [laying, drawn, base]);
  const bake = useBake(doc);
  // what to draw: the worker's bake, with the cheap parts (line, jumps, start) taken from the live geometry
  const built: Built = useMemo(() => {
    const b = bake.built;
    return {
      generator: b?.generator ?? "",
      lapLength: live.total,
      racingLine: live.racing,
      dividers: b?.dividers ?? [],
      features: live.features,
      ...(live.crossings.length ? { crossings: live.crossings } : {}),
      startLine: live.startLine,
      checks: b?.checks ?? [],
      footprint: b?.footprint ?? { cell: 0.1, origin: [0, 0], rows: 0, cols: 0, bbox: [0, 0, 0, 0], rle: "" },
      lanes: live.lanes,
      size: b?.size,
      stats: b?.stats ?? { dividerLength: 0, dividerRuns: 0, corners: 0 },
    };
  }, [bake.built, live]);

  // the 3D preview (#85): view only, of the latest bake (as the checks panel), once it has settled; not on phones, and
  // not while laying the lanes (no track yet)
  const [view3d, setView3d] = useSessionChoice("designer-view", VIEWS, "2d");
  const shown3d = view3d === "3d" && !laying;
  const [noWebGL, setNoWebGL] = useState<"none" | "lost">();
  const no3d = shown3d ? (noWebGL ?? (hasWebGL() ? undefined : "none")) : undefined;
  // the 3D view is on the screen (not its 2D fallback, which edits as usual): the plan's editing keys wait for 2D
  const viewing3d = shown3d && !no3d;
  const viewing3dRef = useRef(viewing3d);
  viewing3dRef.current = viewing3d;
  // the 3D view is made afresh each time 3D is chosen, so a lost graphics context is left behind then
  const chooseView = useCallback(
    (k: (typeof VIEWS)[number]) => {
      setView3d(k);
      if (k === "3d") setNoWebGL((w) => (w === "lost" ? undefined : w));
    },
    [setView3d],
  );
  // the bake drawn in 3D: the latest, once it has settled; the one there when 3D opens is drawn straight away
  const settled3d = useDebounced(shown3d ? bake.built : null, BAKE_SETTLE_MS);
  const built3d = shown3d ? settled3d ?? bake.built : null;
  // the bake drawn in 3D is of the design as it stands: its jumps are the design's, index for index (a click or the
  // highlight on a stale one could land on the wrong jump)
  const synced3d = !!built3d && built3d === bake.built && !bake.pending && built3d.features.length === (draft.design.features?.length ?? 0);
  // the rostrum view: the guide's rostrum side unless one is picked
  const [rostrumPick, setRostrumPick] = useState<{ side?: Side; at: boolean }>({ at: false });
  const rostrum = useMemo(() => ({ side: rostrumPick.side ?? defaultRostrumSide(guide), at: rostrumPick.at }), [rostrumPick, guide]);
  const onRostrum = useCallback((side: Side, at: boolean) => setRostrumPick({ side, at }), []);
  // the 3D camera, kept while 2D is shown for editing
  const keep3d = useRef<KeptCamera | null>(null);

  // refs for window-level handlers
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const liveRef = useRef<Live>(live);
  liveRef.current = live;
  const selRef = useRef(sel);
  selRef.current = sel;
  // what pressed an Advanced corner point last: a touch long-press also fires contextmenu (ADR 0005), so only a
  // mouse's right-click deletes (#119). QuickCorner keeps its own, lastPointer.
  const pointPointer = useRef("mouse");

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
  useHoldReload(dirty); // a new version is out: no automatic reload over unsaved work (#88)
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

  /** drive the layout the other way round: the bar's button, or the dock's on a tablet */
  const reverse = () => {
    // corner and jump numbers count the other way now
    setSel(null);
    setHoverPt(null);
    update(reverseDraft);
  };
  const canReverse = !laying && draft.design.points.length >= 3;
  const reverseTitle = laying ? "Close the loop first" : "Drive the same layout the other way round: the start line and jumps stay put and face the new way";

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
      // 3D is view only: undo and redo still work (3D follows), but the plan's editing keys wait for 2D; a key the 3D
      // view took (Escape leaving the rostrum) is its own
      if (viewing3dRef.current && (e.defaultPrevented || ["Delete", "Backspace", "h", "H", "o", "O", ...ADD_KEYS].includes(e.key))) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.key === "h" || e.key === "H") && !mod && selRef.current?.kind === "point" && allows(viewRef.current, "hairpin")) {
        e.preventDefault();
        const i = selRef.current.i;
        const cur = draftRef.current;
        const lw = cur.design.laneWidth ?? 2;
        // a corner nested inside this one follows it down to a hairpin first (#106), while the corner is still one point
        const pre = followNest(cur.design.points.map((q, k) => (k === i ? { ...q, radius: widthAt(q, lw) / 2 } : q)), i, lw);
        const hp = makeHairpin(pre, i, lw);
        if (hp) {
          hist.set({ ...cur, design: { ...cur.design, points: hp } }, `hairpin:${Date.now()}`);
          setMessage(null);
        } else setMessage({ kind: "info", text: "That point is on a straight: there's no turn to make a hairpin of." });
      } else if ((e.key === "o" || e.key === "O") && !mod && selRef.current?.kind === "point" && allows(viewRef.current, "outer")) {
        e.preventDefault();
        toggleOuter(selRef.current.i);
      } else if (addKey(e) && !draftRef.current.laying) {
        // A: the Add point tool on or off (#114)
        e.preventDefault();
        setTool((t) => (t.kind === "add" ? { kind: "select" } : { kind: "add" }));
      } else if (toolRef.current.kind === "add" && !draftRef.current.laying && !mod && !e.altKey && ["n", "N", "p", "P"].includes(e.key)) {
        // N / P: pick the corner to add after, from the keyboard
        e.preventDefault();
        const n = draftRef.current.design.points.length;
        const s = selRef.current;
        const i = stepCorner(n, s?.kind === "point" ? s.i : null, e.key === "n" || e.key === "N" ? 1 : -1);
        setSel((selRef.current = { kind: "point", i }));
        say(`Corner ${i + 1} of ${n}.`);
      } else if (toolRef.current.kind === "add" && !draftRef.current.laying && e.key === "Enter" && !mod && !isControl(e.target)) {
        // Enter: a point halfway along the straight after the selected corner, one undo step
        e.preventDefault();
        const s = selRef.current;
        const cur = draftRef.current;
        const r = s?.kind === "point" ? keyInsert(viewRef.current, cur.design.points, s.i, cur.design.laneWidth ?? 2) : null;
        if (!r) {
          const text = s?.kind === "point" ? "There's no room for a point between those two corners." : "Pick a corner first (N or P): Enter adds a point halfway to the next one.";
          setMessage({ kind: "info", text });
          say(text);
          return;
        }
        draftRef.current = { ...cur, design: { ...cur.design, points: r.points } };
        hist.set(draftRef.current, `insert:${Date.now()}`);
        setSel((selRef.current = { kind: "point", i: r.index }));
        setMessage(null);
        say(`Added corner ${r.index + 1}, halfway to the next one.`);
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
  }, [hist, undo, redo, deleteSelection, toggleOuter]);

  // ------------------------------------------------------------------------------------ dragging
  type DragKind =
    | { kind: "point"; i: number; offset: Point2 }
    | { kind: "mitre"; i: number; offset: Point2 }
    | { kind: "apex"; i: number; dd: number }
    | { kind: "feature"; i: number; ds: number }
    | { kind: "start"; ds: number };
  const startDrag = (
    e: React.PointerEvent,
    svg: SVGSVGElement,
    d: DragKind,
    opts: { threshold?: boolean; onClick?: () => void; group?: string; was?: ReturnType<typeof before>; onLongPress?: () => void } = {},
  ) => {
    e.stopPropagation();
    // an undo group of its own, or the one of what the press did first (an added corner), so both are one undo step
    const group = opts.group ?? `drag:${d.kind}:${Date.now()}`;
    const x0 = e.clientX, y0 = e.clientY;
    const was = opts.was ?? before();
    const id = e.pointerId;
    let started = !opts.threshold;
    // touch: holding still for LONG_PRESS_MS is a long-press, not a tap
    let longPressed = false;
    const timer = opts.onLongPress && e.pointerType !== "mouse" && !started ? setTimeout(() => {
      longPressed = true;
      opts.onLongPress!();
    }, LONG_PRESS_MS) : undefined;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!started) {
        if (longPressed || Math.hypot(ev.clientX - x0, ev.clientY - y0) < slopFor(e.pointerType)) return;
        started = true;
        clearTimeout(timer);
        setPress(null);
      }
      const p = planPoint(svg, ev.clientX, ev.clientY);
      const cur = draftRef.current;
      if (d.kind === "apex") {
        // Quick step 2: the handle slides along the corner's inside bisector; only the radius changes
        const lw = cur.design.laneWidth ?? 2;
        const a = apexOf(cur.design.points, d.i, lw);
        if (!a) return;
        const r = radiusFromDrag(alongBisector(a, p) - d.dd, a.th, a.w);
        if (r === cur.design.points[d.i].radius) return;
        // a corner nested inside this one follows it (#106)
        const shaped = followNest(cur.design.points.map((q, k) => (k === d.i ? { ...q, radius: r } : q)), d.i, lw);
        hist.set({ ...cur, design: { ...cur.design, points: shaped } }, group);
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
          const moved = f[d.i]?.type === "crossover" ? moveCrossover(f, d.i, s, liveRef.current.crossings, liveRef.current.total) : moveJump(f, d.i, s);
          hist.set({ ...cur, design: { ...cur.design, features: moved } }, group);
        } else if (cur.design.start?.distance !== s) {
          hist.set({ ...cur, design: moveStart(cur.design, liveRef.current, s) }, group);
        }
      }
    };
    // corners whose pipes sit in a hall corner stay there while this point moves
    const origin = draftRef.current.design.points;
    const pinned = (d.kind === "point" && viewRef.current === "advanced") || d.kind === "mitre" ? pinnedCorners(origin, draftRef.current.area, draftRef.current.design.laneWidth ?? 2, d.i) : new Map<number, Point2>();
    if (d.kind === "point" || d.kind === "mitre" || d.kind === "apex") setDragging(d.i);
    const end = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGuides([]);
      setShared(null);
      setSnapInfo(null);
      setDragging(null);
      setPress((p) => (p?.done ? p : null)); // a long-press's ring stays while its corner is selected
      edit.current = null;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      end();
      if (!started && !longPressed) opts.onClick?.();
    };
    edit.current = {
      cancel: () => {
        end();
        histRef.current.restore(was.hist);
        setSel(was.sel);
        setTool(was.tool);
        setPress(null);
      },
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** the Add point button: on, or off again */
  const toggleAdd = () => setTool((t) => (t.kind === "add" ? { kind: "select" } : { kind: "add" }));
  /** a press on a corner lets an armed jump go, but leaves the Add point tool on (tap a corner, then add after it) */
  const disarmJump = () => setTool((t) => (t.kind === "feature" ? { kind: "select" } : t));

  const onPointDown = (e: React.PointerEvent<SVGElement>, i: number) => {
    if (e.button !== 0) return;
    const was = before();
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const pt = draftRef.current.design.points[i];
    const again = selRef.current?.kind === "point" && selRef.current.i === i;
    setSel({ kind: "point", i });
    disarmJump();
    const quick = viewRef.current === "quick";
    // Quick: a tap on the selected corner lets it go, so taps on the floor stop adding after it
    const onClick = quick && again ? () => setSel(null) : undefined;
    // Quick, by touch: hold the corner to select it and open its panel; the ring fills while the finger is down
    const touchPress = quick && e.pointerType !== "mouse";
    if (touchPress) setPress({ i, done: false });
    // a tap on another corner picks where the next corner goes; its panel waits for a long-press
    if (!again) setSheet((s) => (s === "selection" ? null : s));
    const onLongPress = touchPress
      ? () => {
          setPress({ i, done: true });
          setSel((selRef.current = { kind: "point", i }));
          setSheet("selection");
        }
      : undefined;
    startDrag(e, svg, { kind: "point", i, offset: [pt.x - p[0], pt.z - p[1]] }, { threshold: quick, onClick, was, onLongPress });
  };

  const onApexDown = (e: React.PointerEvent<SVGElement>, i: number) => {
    if (e.button !== 0) return;
    const was = before();
    const svg = svgOf(e.currentTarget);
    const pts = draftRef.current.design.points;
    const a = apexOf(pts, i, draftRef.current.design.laneWidth ?? 2);
    const c = liveRef.current.corners[i];
    if (!a || !c) return;
    setSel({ kind: "point", i });
    disarmJump();
    // where on the handle it was pressed, so grabbing it doesn't change the radius
    const dd = alongBisector(a, planPoint(svg, e.clientX, e.clientY)) - alongBisector(a, handlePoint(a, c.r));
    startDrag(e, svg, { kind: "apex", i, dd }, { threshold: true, was });
  };

  /**
   * Quick step 2, a tap on the floor or the track: a corner straight after the selected one (and select it, so tapping
   * round lays corners in order); with nothing selected, into the part of the track it's near. One undo step each.
   */
  const addCornerAt = (raw: Point2, free: boolean, group = `drag:insert:${Date.now()}`): number | null => {
    const cur = draftRef.current;
    const lw = cur.design.laneWidth ?? 2;
    const { p } = placeCorner(raw, cur.area, lw, free || !laneSnapRef.current);
    const s = selRef.current;
    const r = s?.kind === "point" ? insertAfter(cur.design.points, s.i, p, lw) : s ? null : insertNearTrack(cur.design.points, p, nearestOnLine(liveRef.current, raw).dist, lw);
    if (!r) return null;
    hist.set({ ...cur, design: { ...cur.design, points: r.points } }, group);
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
    disarmJump();
    startDrag(e, svg, { kind: "mitre", i, offset: [m[0] - p[0], m[1] - p[1]] });
  };

  const onLaneDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    const was = before();
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const hit = nearestOnLine(liveRef.current, p);
    if (tool.kind === "feature") {
      e.stopPropagation();
      const distance = wrapDistance(hit.s, liveRef.current.total);
      const list = draftRef.current.design.features ?? [];
      const { features, index } = tool.type === "crossover" ? addCrossover(list, liveRef.current.crossings, p, hit.s, liveRef.current.total) : addJump(list, tool.type, distance);
      setFeatures(() => features);
      setSel({ kind: "feature", i: index });
      setTool({ kind: "select" });
      setHover(null);
      return;
    }
    const pts = draftRef.current.design.points;
    let best = 0;
    pts.forEach((q, k) => {
      if (Math.hypot(q.x - p[0], q.z - p[1]) < Math.hypot(pts[best].x - p[0], pts[best].z - p[1])) best = k;
    });
    const mPerPx = 1 / (svg.getScreenCTM()?.a ?? 1);
    const nearPoint = Math.hypot(pts[best].x - p[0], pts[best].z - p[1]) <= GRAB_PX * mPerPx;
    const quick = viewRef.current === "quick";
    // adding a point takes the Add point tool (#114); without it, a press away from the points passes on, so a drag pans
    const does = lanePress({ tool: tool.kind, view: viewRef.current, nearPoint, onCorner: hit.curvature !== 0, selKind: selRef.current?.kind ?? null });
    if (does === "pass") return;
    e.stopPropagation();
    if (does === "release") {
      setSel(null);
      return;
    }
    if (does === "grab") {
      // on a corner point (or, in Advanced, on a corner or just missing a point): grab the corner point
      setSel({ kind: "point", i: best });
      startDrag(e, svg, { kind: "point", i: best, offset: [pts[best].x - p[0], pts[best].z - p[1]] }, { threshold: true, was });
      return;
    }
    if (quick) {
      // Quick: a corner after the selected one, or into this part of the track, dragged on if the pointer moves; all
      // one undo step
      const group = `drag:insert:${Date.now()}`;
      const i = addCornerAt(p, e.altKey, group);
      const at = i === null ? null : draftRef.current.design.points[i];
      if (i !== null && at) startDrag(e, svg, { kind: "point", i, offset: [at.x - p[0], at.z - p[1]] }, { threshold: true, group, was });
      return;
    }
    // Advanced, on a straight: add a point there (and drag it if the pointer moves)
    const { after, at: projected } = insertionFor(pts, p);
    const at = snapInsertion(projected, pts, after, modeFor(e), draftRef.current.area, draftRef.current.design.laneWidth ?? 2);
    const i = after + 1;
    const group = `drag:insert:${Date.now()}`;
    setPoints((list) => insertPoint(viewRef.current, list, after, at), group);
    setSel({ kind: "point", i });
    startDrag(e, svg, { kind: "point", i, offset: [at[0] - p[0], at[1] - p[1]] }, { threshold: true, group, was });
  };

  const onFeatureDown = (e: React.PointerEvent<SVGElement>, i: number) => {
    if (e.button !== 0) return;
    const was = before();
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const f = draftRef.current.design.features![i];
    const s = nearestOnLine(liveRef.current, p).s;
    setSel({ kind: "feature", i });
    startDrag(e, svg, { kind: "feature", i, ds: s - f.distance }, { threshold: true, was });
  };

  const onStartDown = (e: React.PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    const was = before();
    const svg = svgOf(e.currentTarget);
    const p = planPoint(svg, e.clientX, e.clientY);
    const s = nearestOnLine(liveRef.current, p).s;
    setSel({ kind: "start" });
    startDrag(e, svg, { kind: "start", ds: s - (draftRef.current.design.start?.distance ?? 0) }, { threshold: true, was });
  };

  // ------------------------------------------------------------------------------------ step 1: lay the lanes
  // step 1's notes go in the floating hint, not the message bar, so the plan never moves under a drag
  const [layNote, setLayNote] = useState<string | null>(null);
  /** Paint from the end of the lane to `target`, one undo step per square. True once the loop has closed. */
  const paintCell = (g: LaneGrid, target: Cell): boolean => {
    const d = draftRef.current;
    if (!d.laying) return true;
    return applyLaying(paintTo(g, { cells: d.laying, closed: false }, target));
  };
  /** Each painted state one undo step, and the refusal (if any) in the hint. True once the loop has closed. */
  const applyLaying = (r: { states: Laying[]; refused?: Refusal }): boolean => {
    let d = draftRef.current;
    for (const st of r.states) {
      d = withLaying({ ...d, area: areaRef.current }, st); // laid on the grid's area (the guide's, while there is one)
      hist.set(d);
    }
    draftRef.current = d;
    const closed = !d.laying;
    if (r.refused) setLayNote(REFUSAL_TEXT[r.refused]);
    else if (r.states.length) setLayNote(null);
    return closed;
  };

  // from the keyboard (#47): a cursor square before the lane starts, then the arrows lay it through the same painting
  const [layKeys, setLayKeys] = useState<LayKeys | null>(null);
  const [gridFocus, setGridFocus] = useState(false);
  /** the live region's text; a repeat gets a different invisible ending so it's read again */
  const [said, setSaid] = useState("");
  const say = (t: string) => setSaid((s) => (s === t ? `${t}\u00a0` : t));
  /** step 1 changed other than by a key on the grid: drop a half-made diagonal and say where the lane is now */
  const sayLane = (what: string, cells: Cell[]) => {
    const t = `${what} ${describeLane(cells)}`;
    setLayKeys((k) => k && { cursor: k.cursor });
    say(t);
    setLayNote(t);
  };
  const travelsRef = useRef(hist.travels);
  useEffect(() => {
    if (travelsRef.current === hist.travels) return;
    travelsRef.current = hist.travels;
    const cells = draftRef.current.laying;
    if (cells) sayLane(travelRef.current, cells);
  }, [hist.travels]);
  const planWrapRef = useRef<HTMLElement>(null);
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let d = draftRef.current;
    if (!grid || !d.laying) return;
    const r = layKey(grid, { cells: d.laying, closed: false }, layKeys ?? { cursor: startCursor(grid) }, e);
    setLayKeys(r.keys); // also for a key left to the page: it drops a half-made diagonal
    if (!r.handled) return; // Tab, Ctrl+Z and the rest work as anywhere else
    e.preventDefault();
    e.stopPropagation();
    for (const st of r.states) {
      d = withLaying({ ...d, area: areaRef.current }, st); // one undo step per square, as painting
      hist.set(d);
    }
    draftRef.current = d;
    if (r.say) {
      say(r.say);
      setLayNote(r.say);
    }
    // closed: the grid goes, so focus goes on to the plan rather than being lost
    if (!d.laying) planWrapRef.current?.querySelector<SVGSVGElement>(".plan-svg")?.focus();
  };

  const onGridDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.button !== 0 || !grid) return;
    e.stopPropagation();
    const was = before();
    const svg = svgOf(e.currentTarget);
    const g = grid;
    let cur = cellAt(g, planPoint(svg, e.clientX, e.clientY));
    if (!cur) return;
    const cells = draftRef.current.laying ?? [];
    const end = cells[cells.length - 1];
    // carry on from the end of the lane (or a square next to it, corner to corner too); a press anywhere else would
    // lay a long run
    if (end && !same(cur, end) && !neighbours(cur, end)) {
      setLayNote("Carry on from the end of the lane, or drag back along it to take squares up.");
      return;
    }
    if (paintCell(g, cur) || !draftRef.current.laying?.length) return; // closed, or the first square was refused
    const id = e.pointerId; // a second finger never paints: it pinches or pans, and takes this painting back
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const c = dragCell(g, planPoint(svg, ev.clientX, ev.clientY), cur);
      if (!c || (cur && same(c, cur))) return;
      cur = c;
      if (paintCell(g, c)) up();
    };
    const up = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== id) return;
      // lifted near the edge of the next square, before the drag moved on to it: that step still counts (#96)
      const lay = draftRef.current.laying;
      if (ev?.type === "pointerup" && lay) applyLaying({ states: releaseStep(g, { cells: lay, closed: false }, planPoint(svg, ev.clientX, ev.clientY)) });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      edit.current = null;
    };
    edit.current = {
      cancel: () => {
        up();
        histRef.current.restore(was.hist);
        setLayNote(null);
      },
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // undo / redo can take the selected corner or jump away: let it go rather than add or delete after the wrong one
  useEffect(() => {
    if (sel?.kind === "point" && sel.i >= draft.design.points.length) setSel(null);
    if (sel?.kind === "feature" && sel.i >= (draft.design.features?.length ?? 0)) setSel(null);
  }, [sel, draft.design.points.length, draft.design.features?.length]);
  // tablet: a jump or the start line opens its panel as soon as it's selected; a corner's waits for a long-press (a tap
  // on a corner picks where the next corner goes); letting go of the selection closes it
  useEffect(() => {
    if (!sel) setSheet((s) => (s === "selection" ? null : s));
    else if (sel.kind !== "point") setSheet("selection");
    setPress((p) => (p && (sel?.kind !== "point" || sel.i !== p.i) ? null : p));
  }, [sel]);
  // undo past the close comes back here: nothing of step 2 stays selected or armed
  useEffect(() => {
    if (!laying) return;
    setSel(null);
    setTool({ kind: "select" });
    setLayNote(null);
    setBackArmed(false);
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
      const edited = pts.map((q, k) => (k === i ? next : q));
      // a radius change shapes the corner nested inside it too (#106)
      const points = what === "radius" ? followNest(edited, i, draftRef.current.design.laneWidth ?? 2) : edited;
      hist.set({ ...draftRef.current, design: { ...draftRef.current.design, points } }, key);
      return true;
    },
    [hist],
  );

  // ------------------------------------------------------------------------------------ saving
  const save = async () => {
    if (!me) return;
    setSaving(true);
    setMessage(null);
    const { built: _b, ...unbaked } = toDoc(drawn, base);
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
  // what 3D highlights: the selected jump, corner (on its point) or start line
  const selPoint = sel?.kind === "point" ? draft.design.points[sel.i] : undefined;
  const highlight3d = useMemo<Highlight>(
    () => (sel?.kind === "point" ? (selPoint ? { kind: "point", at: [selPoint.x, selPoint.z] } : null) : sel?.kind === "feature" ? (synced3d ? { kind: "feature", i: sel.i } : null) : sel?.kind === "start" ? { kind: "start" } : null),
    [sel, selPoint, synced3d],
  );
  // a jump clicked in 3D: selected, and back to 2D to edit it
  const pick3d = useCallback(
    (i: number) => {
      setTool({ kind: "select" });
      setSel({ kind: "feature", i });
      setView3d("2d");
    },
    [setView3d],
  );
  const unsupported3d = useCallback((why: "none" | "lost") => setNoWebGL(why), []);
  // a jump picked from the palette is placed on the plan: back to 2D
  useEffect(() => {
    if (tool.kind === "feature") setView3d("2d");
  }, [tool.kind, setView3d]);
  // the corners round the same pipe as the selected one highlight while it's edited (#106)
  const linked = useMemo(() => (sel?.kind === "point" ? linkedTo(findNests(pointsList, lw), sel.i) : []), [sel, pointsList, lw]);
  // problems: the shared plan renderer's checks layer alone, drawn over the lane handle rather than under it in
  // PlanView (info is never drawn, so Quick and Advanced show the same marks; Advanced adds their hover details); the
  // bake's checks lag the live line by a moment while dragging
  const problemScene = useMemo(() => ({ area, built }), [area, built]);
  const problems = (m: number) => (layers.checks ? planLayers(problemScene, { px: m, layers: ONLY_CHECKS, background: false, tips: advanced }) : "");
  // matched against the bake's own jumps, so a note or warning stays on its jump while the bake catches up with a drag
  const inCorner = useMemo(() => {
    const b = bake.built;
    return b && b.features.length === built.features.length ? jumpsInCorner(b.checks, b.features) : new Map<number, CheckLevel>();
  }, [bake.built, built.features.length]);
  const overlay = (m: number) => {
    /** Quick step 2: corner i's apex handle (the middle of its inside edge), with its label; null where the line runs straight */
    const apexHandle = (p: DesignPoint, i: number) => {
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
          <circle className={`ed-apex ${sel?.kind === "point" && sel.i === i ? "on" : ""}`} cx={h[0]} cy={-h[1]} r={(touch ? APEX_TOUCH_PX : APEX_PX) * m} vectorEffect="non-scaling-stroke" />
          <circle data-handle="apex" className="ed-hit ed-hit-apex" cx={h[0]} cy={-h[1]} r={(touch ? TOUCH_PX : APEX_PX + 3) * m} onPointerDown={(e) => onApexDown(e, i)} onPointerEnter={() => setHoverPt(i)} onPointerLeave={() => setHoverPt(null)}>
            <title>{`Corner ${i + 1}: drag in or out to cut the corner back (apex radius ${fmt.metres(apexNow, 1)})`}</title>
          </circle>
        </g>
      );
    };
    /** does corner i's apex handle land on another corner's dot? (the outer corner of a nest: its inside edge runs by the inner corner point) */
    const crowdedApex = (i: number) => {
      const a = apexOf(pointsList, i, lw);
      const c = live.corners[i];
      if (!a || !c) return false;
      const h = handlePoint(a, c.r);
      const reach = (touch ? TOUCH_PX : CORNER_PX) * m;
      return pointsList.some((q, k) => k !== i && Math.hypot(q.x - h[0], q.z - h[1]) < reach);
    };
    const selPt = sel?.kind === "point" ? pointsList[sel.i] : null;
    const corner = sel?.kind === "point" ? live.corners[sel.i] : null;
    const placing = tool.kind === "feature";
    const ghost = placing && hover ? featureCorners(ghostFeature(live, tool.type, hover)) : null;
    return (
      <g className={`ed ${placing ? "ed-placing" : tool.kind === "add" ? "ed-adding" : ""}`}>
        <g
          data-handle="lane"
          className="ed-lane"
          onPointerDown={onLaneDown}
          onPointerMove={(e) => {
            if (!placing) return;
            const at = planPoint(svgOf(e.currentTarget), e.clientX, e.clientY);
            setHover({ s: nearestOnLine(live, at).s, at });
          }}
          onPointerLeave={() => setHover(null)}
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
          <g key={i}>
            <polygon
              data-handle="feature"
              className={`ed-feature ${sel?.kind === "feature" && sel.i === i ? "on" : ""} ${layers.checks && inCorner.get(i) === "warning" ? "warn" : ""}`}
              points={pts(featureCorners(f))}
              onPointerDown={(e) => onFeatureDown(e, i)}
              vectorEffect="non-scaling-stroke"
            />
            {/* touch screens: a jump takes a press 44 px across, however small it's drawn */}
            {touch && <circle data-handle="feature" className="ed-hit ed-hit-feature" cx={f.x} cy={-f.z} r={TOUCH_PX * m} onPointerDown={(e) => onFeatureDown(e, i)} />}
          </g>
        ))}
        <StartHandle built={built} m={m} touch={touch} on={sel?.kind === "start"} onPointerDown={onStartDown} />
        {/* apex handles under the corner dots where one lands on another corner's dot (a nest's outer corner, #106); the
            rest stay on top: a touch near both goes to whichever is on top, and the handle is the smaller target */}
        {!advanced && pointsList.map((p, i) => (crowdedApex(i) ? apexHandle(p, i) : null))}
        {!advanced && pointsList.map((p, i) => <QuickCorner key={i} p={p} i={i} m={m} touch={touch} on={sel?.kind === "point" && sel.i === i} linked={linked.includes(i)} press={press?.i === i ? press : null} onPointerDown={(e) => onPointDown(e, i)} onDelete={() => {
          setSel({ kind: "point", i });
          selRef.current = { kind: "point", i };
          deleteSelection();
        }} onHover={(on) => setHoverPt(on ? i : null)} />)}
        {!advanced && pointsList.map((p, i) => (crowdedApex(i) ? null : apexHandle(p, i)))}
        {advanced && pointsList.map((p, i) => (
          <circle
            key={i}
            data-handle="point"
            data-wheel=""
            data-index={i}
            className={`ed-point ${sel?.kind === "point" && sel.i === i ? "on" : ""} ${linked.includes(i) ? "linked" : ""}`}
            cx={p.x}
            cy={-p.z}
            r={(sel?.kind === "point" && sel.i === i ? HANDLE_PX + 2 : HANDLE_PX) * m}
            onPointerDown={(e) => {
              pointPointer.current = e.pointerType;
              onPointDown(e, i);
            }}
            onPointerEnter={() => setHoverPt(i)}
            onPointerLeave={() => setHoverPt(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (pointPointer.current !== "mouse") return;
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
    const cursor = end ?? layKeys?.cursor ?? startCursor(g);
    // a crossing square: a diamond where the passes cross (which goes over is chosen once the loop is closed)
    const crossings = cells.flatMap((c, i) => {
      if (i === 0 || i === cells.findIndex((d) => same(d, c))) return [];
      const [x, z] = centres[i];
      const h = g.size * 0.3;
      return [{ key: `${c[0]},${c[1]}`, d: `M${x - h} ${-z}L${x} ${-(z + h)}L${x + h} ${-z}L${x} ${-(z - h)}Z` }];
    });
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
        {cells.map((c, i) => (i === cells.findIndex((d) => same(d, c)) ? <rect key={`${c[0]},${c[1]}`} className="lay-cell" {...box(c)} /> : null))}
        <path className="lay-grid" d={lines} vectorEffect="non-scaling-stroke" />
        {crossings.map((b) => (
          <path key={b.key} className="lay-crossing" d={b.d} vectorEffect="non-scaling-stroke" />
        ))}
        {end && <rect className="lay-end" {...box(end)} vectorEffect="non-scaling-stroke" />}
        {centres.length > 1 && <polyline className="lay-line" points={pts(centres)} vectorEffect="non-scaling-stroke" />}
        {centres[0] && <circle className="lay-first" cx={centres[0][0]} cy={-centres[0][1]} r={Math.min(g.size / 4, 9 * m)} vectorEffect="non-scaling-stroke" />}
        {gridFocus && <rect className="lay-cursor" {...box(cursor)} vectorEffect="non-scaling-stroke" />}
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
  /** Quick's right-hand column has no checks (#113): why Submit is waiting is told by the button instead */
  const quickSide = !advanced && !tablet && !laying;
  /** where the reason is shown (#submit-why): by the button on Quick, else under the checks while they're showing */
  const whyShown = !!blocked && (quickSide || (!laying && (!tablet || sheet === "checks")));
  const checksHeading = useRef<HTMLHeadingElement>(null);
  const [toChecks, setToChecks] = useState(false);
  const seeChecks = () => {
    setView("advanced");
    setToChecks(true);
  };
  useEffect(() => {
    if (!toChecks || !checksHeading.current) return;
    setToChecks(false);
    checksHeading.current.scrollIntoView({ block: "nearest" });
    checksHeading.current.focus();
  }, [toChecks, view]);
  // the area is locked to the guide's while there is one (a template that's gone leaves only the label)
  const venueName = guide?.info.name;
  const backTo = mode === "edit" && base ? { to: `/t/${base.id}`, label: "Back to track" } : { to: "/new", label: "Start over" };
  // the bake's jumps, matched with its checks (the live ones run ahead while dragging)
  const bakedFeatures = bake.built && !bake.pending && bake.built.features.length === built.features.length ? bake.built.features : [];
  const makeItACrossover = (i: number) => {
    setFeatures((f) => makeCrossover(f, i, liveRef.current.crossings, liveRef.current.total));
    setSel({ kind: "feature", i });
  };
  const bridgeIt = (c: Check) => {
    const { crossings, total } = liveRef.current;
    const r = bridgeCrossing(draftRef.current.design.features ?? [], c, crossings, total);
    if (!r) return;
    setFeatures(() => r.features);
    setSel({ kind: "feature", i: r.index });
  };
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

  // ------------------------------------------------------------------------------------ the layouts (#120)
  // one state, three layouts: the bar, palette, plan and panels take props, and DesignerLayout places them
  const rename = (name: string) => update((d) => ({ ...d, info: { ...d.info, name } }), "name");
  /** "1 · Lay the lanes" from step 2: armed by the first tap, back on the second */
  const stepBack = () => {
    if (!backArmed) return setBackArmed(true);
    setBackArmed(false);
    setSel(null);
    update((d) => reopenLaying(d));
    sayLane("Back to step 1.", reopenLaying(draftRef.current).laying ?? []);
  };
  /** step 1: take up the whole lane (Undo brings it back) */
  const startAgain = () => {
    update((d) => withLaying(d, { cells: [], closed: false }));
    sayLane("The lane is taken up.", []);
  };
  /** a jump picked from the palette or the dock: armed, or let go if it was armed already */
  const pickJump = (t: FeatureType) => setTool(tool.kind === "feature" && tool.type === t ? { kind: "select" } : { kind: "feature", type: t });
  /** the Start line button: select it (and show where it is) */
  const pickStart = () => {
    setTool({ kind: "select" });
    setSel({ kind: "start" });
    setHighlight([built.startLine.x, built.startLine.z]);
  };
  const restoreAutosave = () => {
    if (restore) hist.set(restore.draft);
    setRestore(null);
  };
  const discardAutosave = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setRestore(null);
  };
  /** the tablet's sheet closed from its button: a jump or the start line is let go with it; a corner stays selected */
  const closeSheet = () => {
    if (sheet === "selection" && sel?.kind !== "point") setSel(null);
    setSheet(null);
  };
  /** the plan, or the 3D view, in every layout but the phone's */
  const plan = viewing3d ? (
    <Suspense
      fallback={
        <div role="status" aria-busy="true" className="designer-plan">
          <span className="sr-only">Loading the 3D view…</span>
          <Skeleton className="designer-plan" />
        </div>
      }
    >
      {built3d ? (
        <Viewer3D
          area={area}
          built={built3d}
          obstacles={guideObstacles}
          highlight={highlight3d}
          onPick={synced3d ? pick3d : undefined}
          label={`3D preview of ${draft.info.name || "this track"}, view only`}
          className="designer-plan"
          onUnsupported={unsupported3d}
          rostrum={rostrum}
          onRostrum={onRostrum}
          keep={keep3d}
        />
      ) : (
        <div role="status" aria-busy="true" className="designer-plan">
          <span className="sr-only">Loading the 3D view…</span>
          <Skeleton className="designer-plan" />
        </div>
      )}
    </Suspense>
  ) : (
    <PlanView
      area={area}
      obstacles={guideObstacles}
      built={laying ? undefined : built}
      checksInOverlay
      designFeatures={draft.design.features}
      layers={layers}
      onLayersChange={setLayers}
      highlight={highlight}
      label={`Designer plan of ${draft.info.name}`}
      className="designer-plan"
      overlay={laying ? layOverlay : overlay}
      onHandleWheel={onHandleWheel}
      controls={!tablet}
      fitRequest={fitRequest}
      onSecondFinger={() => {
        edit.current?.cancel();
        setPress(null);
      }}
      onBackgroundClick={(e) => {
        setHighlight(null);
        // Quick step 2, with the Add point tool on: a tap on the floor adds a corner (after the selected one, or into
        // the track it's near)
        if (floorTap({ tool: tool.kind, view, laying, selKind: sel?.kind ?? null }) === "add") {
          addCornerAt(planPoint(e.currentTarget, e.clientX, e.clientY), e.altKey);
          return;
        }
        setSel(null);
      }}
    />
  );
  const panels: PanelProps = { view, checks: built.checks, bakedFeatures, pending: bake.pending, showSubmit, blocked, onShow: showCheck, onMakeCrossover: makeItACrossover, onBridge: bridgeIt, draft, drawn, sel, live, update, onDelete: deleteSelection, venueName, inCorner, checksHeading };
  const tools: ToolsProps = { view, laying, canStartAgain: !!draft.laying?.length, onStartAgain: startAgain, tool, onJump: pickJump, onAdd: toggleAdd, startOn: sel?.kind === "start", onStartLine: pickStart, laneSnap, onLaneSnap: () => setLaneSnap((v) => !v) };
  const history = { undo, redo, canUndo: hist.canUndo, canRedo: hist.canRedo };
  return (
    <DesignerLayout
      phone={phone}
      tablet={tablet}
      view={view}
      laying={laying}
      phoneView={{ backTo, name: draft.info.name, canCopy: mode === "edit" && !dirty, laying, area, obstacles: guideObstacles, built, lapLength: live.total, status }}
      bar={{
        backTo,
        name: draft.info.name,
        onName: rename,
        tablet,
        venueName,
        area,
        status,
        steps: { show: view === "quick" || laying, step, canGoBack: !!draft.laid, armed: backArmed, onBack: stepBack },
        view,
        onView: setView,
        ...history,
        reverse,
        canReverse,
        reverseTitle,
        mode,
        dirty,
        revision: base?.revision,
        loggedIn: !!me,
        loginUrl,
        laying,
        saving,
        saveOpen,
        setSaveOpen,
        note,
        setNote,
        onSave: () => void save(),
        showSubmit,
        onSubmit: submit,
        blocked,
        quickSide,
        whyShown,
        checks: built.checks,
        onSeeChecks: seeChecks,
      }}
      messages={restore || !me || message || status?.approvedRevision ? { restore, revision: base?.revision, onRestore: restoreAutosave, onDiscard: discardAutosave, loggedIn: !!me, message, approvedRevision: status?.approvedRevision } : null}
      palette={{ ...tools, snap: snap.mode, onSnap: (m) => setSnap({ mode: m }) }}
      planArea={{
        planWrapRef,
        said,
        laying,
        grid,
        onGridKey,
        onGridFocus: setGridFocus,
        hint: { snapInfo, viewing3d, synced3d, tablet, laying, layNote, gridFocus, cells: draft.laying, layKeys, grid, tool, advanced, sel },
        adding: tool.kind === "add" && !laying && view === "quick",
        plan,
        shown3d,
        no3d,
        view3d,
        onView3d: chooseView,
      }}
      panels={panels}
      grid={grid}
      built={built}
      pill={{ open: sheet === "checks", onToggle: () => setSheet((s) => (s === "checks" ? null : "checks")) }}
      sheet={sheet}
      sel={sel}
      onCloseSheet={closeSheet}
      dock={{ ...tools, ...history, reverse, canReverse, reverseTitle, onFit: () => setFitRequest((n) => n + 1) }}
    />
  );
}

const fmtR = (want: number, got: number) => (Math.abs(want - got) > 0.01 ? `${want.toFixed(2)}→${got.toFixed(2)} m` : `${want.toFixed(2)} m`);

/**
 * Quick step 2: a corner point, numbered in driving order; on touch screens it's drawn bigger and takes a press 44 px
 * across. A finger held on it fills a ring round it (the long-press), which stays full while it's selected.
 */
function QuickCorner({ p, i, m, touch, on, linked = false, press, onPointerDown, onDelete, onHover }: { p: DesignPoint; i: number; m: number; touch: boolean; on: boolean; /** round the same pipe as the selected corner (#106) */ linked?: boolean; press: { done: boolean } | null; onPointerDown: (e: React.PointerEvent<SVGElement>) => void; onDelete: () => void; onHover: (on: boolean) => void }) {
  const base = touch ? CORNER_TOUCH_PX : CORNER_PX;
  const r = (on ? base + 2 : base) * m;
  const ring = (base + 7) * m;
  // a touch long-press also fires contextmenu: only a mouse's right-click deletes
  const lastPointer = useRef("mouse");
  return (
    <g
      data-handle="point"
      className={`ed-corner ${on ? "on" : ""} ${linked ? "linked" : ""}`}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
        onPointerDown(e);
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (lastPointer.current === "mouse") onDelete();
      }}
    >
      <title>{touch ? `Corner ${i + 1}: drag to move, hold to open its panel` : `Corner ${i + 1}: drag to move (Alt: no snapping), right-click to delete`}</title>
      {touch && <circle className="ed-hit" cx={p.x} cy={-p.z} r={TOUCH_PX * m} />}
      <circle className="ed-corner-dot" cx={p.x} cy={-p.z} r={r} vectorEffect="non-scaling-stroke" />
      {press && (
        // pathLength 100: the dash animation fills the ring over the long-press, from the top (a stroke in plan units:
        // non-scaling strokes ignore pathLength)
        <circle
          className={`ed-press ${press.done ? "done" : ""}`}
          cx={p.x}
          cy={-p.z}
          r={ring}
          pathLength={100}
          transform={`rotate(-90 ${p.x} ${-p.z})`}
          strokeWidth={4 * m}
          style={{ animationDuration: `${LONG_PRESS_MS}ms` }}
        />
      )}
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

function StartHandle({ built, m, touch, on, onPointerDown }: { built: Built; m: number; touch: boolean; on: boolean; onPointerDown: (e: React.PointerEvent<SVGElement>) => void }) {
  const s = built.startLine;
  const h = (s.heading * Math.PI) / 180;
  const nx = -Math.sin(h), nz = Math.cos(h);
  const a = [s.x + (nx * s.width) / 2, s.z + (nz * s.width) / 2], b = [s.x - (nx * s.width) / 2, s.z - (nz * s.width) / 2];
  return (
    <g data-handle="start" className={`ed-start ${on ? "on" : ""}`} onPointerDown={onPointerDown}>
      <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} strokeWidth={Math.max(0.35, 12 * m)} />
      <circle cx={a[0]} cy={-a[1]} r={5 * m} className="grip" vectorEffect="non-scaling-stroke" />
      {touch && <circle cx={s.x} cy={-s.z} r={TOUCH_PX * m} className="ed-hit" />}
      <title>Start / finish: drag along the track</title>
    </g>
  );
}

// the panels, for the tests and pages that import them from here
export { ChecksPanel, QuickHowTo, SelectionPanel, Shortcuts } from "./SidePanels.js";
