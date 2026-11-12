// The designer's panels (#120): the laptop's right-hand column (Checks or How to draw, the venue check, the selection,
// the stats), and the panels themselves, which the tablet's sheet shows too. They take props; the state is the
// Designer's.
import {
  BRIDGE_CLEARANCE,
  CROSSOVER_HEIGHT,
  CROSSOVER_RAMP,
  FEATURE_DEFAULTS,
  outerStyle,
  type Built,
  type BuiltFeature,
  type Check,
  type CheckLevel,
  type Corner,
  type DesignFeature,
  type DesignPoint,
  type FeatureType,
} from "@track-studio/engine";
import { ArrowRightLeft, CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { useEffect, useState, type Ref } from "react";
import * as fmt from "../lib/format.js";
import { designerEstimate, useClassSpeeds } from "../lib/laps.js";
import { bridgeAt, crossingHint, makeCrossover, moveStart, overText, swapOver } from "./crossings.js";
import type { Draft, Selection } from "./Designer.js";
import { wrapDistance, type Live } from "./geometry.js";
import { TURNS_HINT, type LaneGrid } from "./lanes.js";
import { checkCounts, FEATURE_TYPES, visibleChecks, type DesignerMode } from "./mode.js";
import { findNests, followNest, follows, innerOf, matchNest, outerOf } from "./nest.js";
import { apexFromField, apexOf, apexRadius, APEX_MAX, isReduced, MIN_CORNERS, QUICK_SIZES, setApex, turnLabel, widthAt } from "./shape.js";
import { RADIUS_RANGE, WIDTH_RANGE } from "./tuning.js";
import { VenueCheckPanel } from "./VenueCheck.js";

/**
 * What the designer's panels show: the bake's checks, the selection and the draft, and what they do to it. One set of
 * props for the laptop's side column and the tablet's sheet.
 */
export interface PanelProps {
  view: DesignerMode;
  checks: Check[];
  /** the bake's jumps, matched with its checks (the live ones run ahead while dragging) */
  bakedFeatures: BuiltFeature[];
  pending: boolean;
  showSubmit: boolean;
  blocked: string | null;
  onShow: (x: number, z: number) => void;
  onMakeCrossover: (feature: number) => void;
  onBridge: (c: Check) => void;
  /** the draft as it stands: its design, and the venue it's drawn for */
  draft: Draft;
  /** the draft as drawn and saved: on the guide's area while there is one */
  drawn: Draft;
  sel: Selection;
  live: Live;
  update: (fn: (d: Draft) => Draft, group?: string) => void;
  onDelete: () => void;
  venueName: string | undefined;
  /** jumps on or landing into a corner */
  inCorner: Map<number, CheckLevel>;
  /** Quick's "See Checks" moves the focus here */
  checksHeading: Ref<HTMLHeadingElement>;
}

/**
 * The laptop's right-hand column: the lane so far while laying; then Checks (Advanced) or How to draw (Quick), the
 * venue check, the selection, Advanced's shortcuts, and the stats.
 */
export function SidePanel({ laying, grid, built, ...p }: PanelProps & { laying: boolean; grid: LaneGrid | null; built: Built }) {
  const { view, checks, bakedFeatures, pending, showSubmit, blocked, onShow, onMakeCrossover, onBridge, draft, drawn, sel, live, update, onDelete, venueName, inCorner, checksHeading } = p;
  const advanced = view === "advanced";
  if (laying)
    return (
      <aside className="designer-side" aria-label="The lane so far">
        {advanced ? (
          <section className="checks-panel" aria-labelledby="ck-h">
            <h2 id="ck-h">Checks</h2>
            <p className="hint">The track is checked once the loop is closed.</p>
          </section>
        ) : (
          <QuickHowTo laying />
        )}
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
    );
  return (
    <aside className="designer-side" aria-label={advanced ? "Checks" : "Details"}>
      {/* Quick is for laying the track, Advanced for checking and fine-tuning (#113) */}
      {advanced ? (
        <ChecksPanel checks={checks} features={bakedFeatures} view={view} pending={pending} blocked={showSubmit ? blocked : null} ready={showSubmit && !blocked} onShow={onShow} onMakeCrossover={onMakeCrossover} onBridge={onBridge} headingRef={checksHeading} />
      ) : (
        <QuickHowTo />
      )}
      <VenueCheckPanel design={draft.design} drawnFor={draft.info.drawnFor} onShow={onShow} />
      <SelectionPanel sel={sel} view={view} draft={drawn} live={live} update={update} onDelete={onDelete} fromVenue={venueName} inCorner={inCorner} />
      {advanced && <Shortcuts />}
      <Stats built={built} live={live} view={view} />
    </aside>
  );
}

/** The outside of the corner: square (a mitre), round (the pipe follows the arc) or auto (square up to 120°). Both modes. */
function OuterSeg({ p, c, onPick }: { p: DesignPoint; c: Corner | undefined; onPick: (o: DesignPoint["outer"]) => void }) {
  const now = p.outer ?? "auto";
  return (
    <div className="seg seg-outer" role="radiogroup" aria-label="Outside corner">
      <span className="seg-label">Outside corner</span>
      {(["auto", "square", "round"] as const).map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={now === o}
          className={now === o ? "on" : ""}
          onClick={() => onPick(o === "auto" ? undefined : o)}
          title={o === "auto" ? "Square up to a 120° turn, round beyond" : o === "square" ? "Two straight pipes meeting in a corner (O)" : "The pipe follows the curve (O)"}
        >
          {o === "auto" ? `Auto${c && now === "auto" ? ` (${outerStyle(p, c)})` : ""}` : o === "square" ? "Square" : "Round"}
        </button>
      ))}
    </div>
  );
}

/**
 * Nested corners (#106): what shaping this corner also shapes (the corner inside it, round the same pipe), and what it
 * follows (the corner outside it) or, shaped on its own, the offer to match it again.
 */
function NestNotes({ inner, outer, following, onMatch }: { inner: number | null; outer: number | null; following: boolean; onMatch: () => void }) {
  if (inner === null && outer === null) return null;
  return (
    <div className="nest-notes">
      {inner !== null && <p className="hint">Also shapes corner {inner + 1} (inside).</p>}
      {outer !== null &&
        (following ? (
          <p className="hint">Follows corner {outer + 1} (outside).</p>
        ) : (
          <p className="hint">
            Shaped on its own.{" "}
            <button type="button" className="link-btn" onClick={onMatch} title={`Shape it to run round the same pipe as corner ${outer + 1}`}>
              Match corner {outer + 1}
            </button>
          </p>
        ))}
    </div>
  );
}

function Stats({ built, live, view }: { built: Built; live: Live; view: DesignerMode }) {
  // "≈ 14.6 s lap (2WD Buggy, est.)": lap length over the first class's speed (#76)
  const speeds = useClassSpeeds();
  const est = speeds && designerEstimate(live.total, speeds);
  return (
    <div className="designer-stats">
      <dl className="figures">
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
      {est && <p className="designer-est">{est}</p>}
    </div>
  );
}

const CHECK_ICON = { error: CircleX, warning: TriangleAlert, info: Info } as const;
export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function ChecksPanel({
  checks,
  features = [],
  view,
  pending,
  blocked,
  ready,
  onShow,
  onMakeCrossover,
  onBridge,
  headingRef,
}: {
  checks: Check[];
  /** the bake's jumps, for the hints on crossing checks */
  features?: BuiltFeature[];
  view: DesignerMode;
  pending: boolean;
  blocked: string | null;
  ready: boolean;
  onShow: (x: number, z: number) => void;
  /** turn the tabletop too low to drive under into a crossover */
  onMakeCrossover?: (feature: number) => void;
  /** put a crossover on an unbridged crossing */
  onBridge?: (c: Check) => void;
  /** for Quick's "See Checks", which moves the focus here */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const shown = visibleChecks(checks, view);
  const { errors, warnings } = checkCounts(checks);
  return (
    <section className="checks-panel" aria-labelledby="ck-h">
      <h2 id="ck-h" ref={headingRef} tabIndex={-1}>
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
                    <CrossingHint c={c} features={features} pending={pending} onMakeCrossover={onMakeCrossover} onBridge={onBridge} />
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

/**
 * A crossing error's hint, and its one-tap fixes: a crossover on an unbridged crossing, or for a tabletop too low to
 * drive under (Quick's, until the checks moved to Advanced in #113). While a bake is pending the fix is disabled
 * ("Checking…"): the check may be stale, so it could do nothing.
 */
function CrossingHint({ c, features, pending, onMakeCrossover, onBridge }: { c: Check; features: BuiltFeature[]; pending: boolean; onMakeCrossover?: (feature: number) => void; onBridge?: (c: Check) => void }) {
  const fi = c.code === "crossing-too-low" ? bridgeAt(c, features) : null;
  const type = fi === null ? null : features[fi].type;
  const hint = crossingHint(c, type);
  if (!hint) return null;
  return (
    <span className="check-hint">
      {hint}
      {type === "tabletop" && onMakeCrossover && (
        <button type="button" className="btn btn-quiet check-fix" disabled={pending} title={pending ? "Checking…" : undefined} onClick={() => onMakeCrossover(fi!)}>
          Make it a crossover
        </button>
      )}
      {c.code === "crossing-unbridged" && onBridge && (
        <button type="button" className="btn btn-quiet check-fix" disabled={pending} title={pending ? "Checking…" : undefined} onClick={() => onBridge(c)}>
          Make it a crossover
        </button>
      )}
    </span>
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

/** Advanced: change a jump's type. Sizes go back to the new type's own; a new crossover goes over the pass it's on. */
function TypeField({ f, i, live, update }: { f: DesignFeature; i: number; live: Live; update: (fn: (d: Draft) => Draft, group?: string) => void }) {
  const setType = (type: FeatureType) =>
    update((d) => {
      const list = d.design.features ?? [];
      const features =
        type === "crossover" ? makeCrossover(list, i, live.crossings, live.total) : list.map((g, k) => (k === i ? { type, distance: g.distance } : g));
      return { ...d, design: { ...d.design, features } };
    }, `ftype:${i}`);
  return (
    <label className="nfield">
      <span>Type</span>
      <select value={f.type} onChange={(e) => setType(e.target.value as FeatureType)}>
        {FEATURE_TYPES.map((t) => (
          <option key={t} value={t}>
            {fmt.FEATURE_LABEL[t]}
          </option>
        ))}
      </select>
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
  touch = false,
}: {
  sel: Selection;
  view: DesignerMode;
  draft: Draft;
  live: Live;
  update: (fn: (d: Draft) => Draft, group?: string) => void;
  onDelete: () => void;
  fromVenue?: string;
  /** jumps on or landing into a corner */
  inCorner: Map<number, CheckLevel>;
  /** the tablet's sheet: say what fingers do */
  touch?: boolean;
}) {
  const setPoint = (i: number, patch: Partial<DesignPoint>, key: string) =>
    update((d) => ({ ...d, design: { ...d.design, points: d.design.points.map((p, k) => (k === i ? { ...p, ...patch } : p)) } }), `${key}:${i}`);
  const setFeature = (i: number, patch: Partial<DesignFeature>, key: string) =>
    update((d) => ({ ...d, design: { ...d.design, features: (d.design.features ?? []).map((f, k) => (k === i ? { ...f, ...patch } : f)) } }), `f${key}:${i}`);

  if (sel?.kind === "point") {
    const p = draft.design.points[sel.i];
    const c = live.corners[sel.i];
    if (!p) return null;
    const lw = draft.design.laneWidth ?? 2;
    // nested corners (#106): the one inside this follows it; this follows the one outside it unless shaped on its own
    const nests = findNests(draft.design.points, lw);
    const inner = innerOf(nests, sel.i), outer = outerOf(nests, sel.i);
    const nest = nests.find((n) => n.inner === sel.i);
    const following = nest ? follows(draft.design.points, nest, lw) : false;
    const match = () => update((d) => ({ ...d, design: { ...d.design, points: matchNest(d.design.points, sel.i, lw) } }), `match:${sel.i}:${Date.now()}`);
    const notes = <NestNotes inner={inner} outer={outer} following={following} onMatch={match} />;
    const outerSeg = <OuterSeg p={p} c={c} onPick={(o) => setPoint(sel.i, { outer: o }, "outer")} />;
    if (view === "quick") {
      const turns = !!apexOf(draft.design.points, sel.i, lw);
      const apex = apexRadius(p, lw);
      const reduced = !!c && isReduced(p, c);
      const setTo = (a: number, key: string) => update((d) => ({ ...d, design: { ...d.design, points: followNest(setApex(d.design.points, sel.i, a, lw), sel.i, lw) } }), `${key}:${sel.i}`);
      return (
        <section className="sel-panel" aria-labelledby="sel-h">
          <h2 id="sel-h">Corner {sel.i + 1}</h2>
          <p className="sel-turn">{turnLabel(draft.design.points, sel.i)}</p>
          {turns ? (
            <>
              <div className="fields">
                <NumberField label="Apex radius" value={Math.round(apex * 10) / 10} step={0.1} min={0} max={APEX_MAX} onChange={(v) => v !== undefined && setTo(apexFromField(v), "apex")} />
              </div>
              <div className="sizes" role="group" aria-label="Quick sizes">
                {QUICK_SIZES.map((q) => (
                  <button key={q.label} type="button" className="palette-btn" aria-pressed={Math.abs(apex - q.apex) < 0.005} onClick={() => setTo(q.apex, `size${q.label}`)} title={`Apex radius ${q.apex.toFixed(1)} m`}>
                    {q.label} <span className="size-m">{q.apex.toFixed(1)} m</span>
                  </button>
                ))}
              </div>
              {outerSeg}
              {notes}
              <div role="status">
                {reduced && c && (
                  <p className="hint">
                    Cut back as far as the straights allow: the apex radius is {fmt.metres(Math.max(0, c.r - widthAt(p, lw) / 2), 1)} (max).
                  </p>
                )}
              </div>
              <p className="hint">{touch ? "Drag the corner to move it, or its inside handle to cut it back." : "Drag the corner to move it, or its inside handle to cut it back. Right-click it or press Delete to remove it."}</p>
            </>
          ) : (
            <p className="hint">
              {turnLabel(draft.design.points, sel.i) === "straight back"
                ? "This corner turns straight back on itself, so there's nothing to cut back: drag it to open the turn, or delete it."
                : "This corner is on a straight line: drag it to make a turn, or delete it."}
            </p>
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
          <NumberField
            label="Radius"
            value={p.radius ?? 1}
            step={0.05}
            min={0}
            max={RADIUS_RANGE[1]}
            onChange={(v) =>
              v !== undefined &&
              update((d) => ({ ...d, design: { ...d.design, points: followNest(d.design.points.map((q, k) => (k === sel.i ? { ...q, radius: Math.max(0, v) } : q)), sel.i, lw) } }), `radius:${sel.i}`)
            }
          />
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
        {outerSeg}
        {notes}
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
        {inCorner.get(sel.i) === "warning" && (
          <p className="sel-warning">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>This {fmt.FEATURE_LABEL[f.type].toLowerCase()} is on or lands into a corner. Slide it onto a straight.</span>
          </p>
        )}
        {inCorner.get(sel.i) === "info" && (
          <p className="sel-note">
            <Info size={16} aria-hidden="true" />
            <span>This {fmt.FEATURE_LABEL[f.type].toLowerCase()} is on or lands into a corner: a technical section.</span>
          </p>
        )}
      </div>
    );
    const swap = () => update((d) => ({ ...d, design: { ...d.design, features: swapOver(d.design.features ?? [], sel.i, live.crossings, live.total) } }), `fswap:${sel.i}:${Date.now()}`);
    if (f.type === "crossover")
      return (
        <section className="sel-panel" aria-labelledby="sel-h">
          <h2 id="sel-h">Crossover</h2>
          <p className="sel-turn">{overText(f, sel.i, live.crossings, live.total)}</p>
          {view === "advanced" && (
            <div className="fields">
              <TypeField f={f} i={sel.i} live={live} update={update} />
              <NumberField label="Along the line" value={f.distance} step={0.05} onChange={(v) => v !== undefined && setFeature(sel.i, { distance: wrapDistance(v, live.total) }, "distance")} />
              <NumberField label="Ramp length" value={f.rampLength} placeholder={String(CROSSOVER_RAMP)} step={0.05} min={0.2} onChange={(v) => setFeature(sel.i, { rampLength: v }, "ramp")} />
              <NumberField label="Top length" value={f.topLength} placeholder="auto" step={0.05} min={0.2} onChange={(v) => setFeature(sel.i, { topLength: v }, "top")} />
              <NumberField label="Height" value={f.height} placeholder={String(CROSSOVER_HEIGHT)} step={0.01} min={BRIDGE_CLEARANCE} onChange={(v) => setFeature(sel.i, { height: v }, "height")} />
            </div>
          )}
          <button type="button" className="btn" onClick={swap} title="The other pass goes over the bridge">
            <ArrowRightLeft size={16} aria-hidden="true" /> Swap over/under
          </button>
          <p className="hint">
            {view === "advanced"
              ? `Drag it along the track; it sits on the crossing it's near. Empty top length = the under lane plus 1 m each side; cars need ${BRIDGE_CLEARANCE.toFixed(2)} m to pass under.`
              : "Drag it along the track; it sits on the crossing it's near."}
          </p>
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete crossover
          </button>
          {warn}
        </section>
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
          <TypeField f={f} i={sel.i} live={live} update={update} />
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
            onChange={(v) => v !== undefined && update((d) => ({ ...d, design: moveStart(d.design, live, wrapDistance(v, live.total)) }), "start")}
          />
        </div>
        <p className="hint">Drag the line along the track. Cars start towards the arrow.</p>
      </section>
    );
  }
  // nothing selected: the track's own settings (Advanced only)
  if (view === "quick") return null;
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
          Drawn for <strong>{fromVenue}</strong>: its area ({fmt.size(draft.area, true)}) and obstacles are a guide while you draw. They aren't saved with the track.
        </p>
      ) : (
        <div className="fields">
          <NumberField label="Area east–west" value={draft.area.length} step={0.5} min={5} max={100} onChange={(v) => v !== undefined && v >= 5 && v <= 100 && update((d) => ({ ...d, area: { ...d.area, length: v } }), "areaL")} />
          <NumberField label="Area north–south" value={draft.area.width} step={0.5} min={5} max={100} onChange={(v) => v !== undefined && v >= 5 && v <= 100 && update((d) => ({ ...d, area: { ...d.area, width: v } }), "areaW")} />
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

/** Quick's "How to draw" (#113), heading its right-hand column: the gestures of the step it's on. */
export function QuickHowTo({ laying = false }: { laying?: boolean }) {
  return (
    <details className="sel-panel shortcuts">
      <summary>How to draw</summary>
      {laying ? (
        <ul>
          <li>
            <b>Press</b> on a square and <b>drag</b> through the squares in driving order: straight, or corner to corner for a diagonal.
          </li>
          <li>Drag back over the squares to take them up.</li>
          <li>To cross the lane, go straight across it at right angles.</li>
          <li>Come back to the first square (the ring) to close the loop. Then you shape it.</li>
          <li>{TURNS_HINT}</li>
          <li>
            Keyboard: <kbd>Tab</kbd> to the plan's lane grid; the hint over the plan lists the keys. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo.
          </li>
        </ul>
      ) : (
        <ul>
          <li>
            <b>Drag</b> a corner to move it, or its inside handle to cut the corner back. With <b>Snap to lanes</b> on, corners snap to a lane line; <kbd>Alt</kbd> places them freely.
          </li>
          <li>
            <b>Add point</b> (or <kbd>A</kbd>), then click the floor or the track to add a corner: after the selected corner, or
            into the track it's near. It stays on until you press it again, <kbd>A</kbd> or <kbd>Esc</kbd>; a plain click never
            adds a corner. Keyboard: with it on, <kbd>N</kbd> / <kbd>P</kbd> pick a corner and <kbd>Enter</kbd> adds one halfway
            to the next.
          </li>
          <li>
            <kbd>Delete</kbd>, <kbd>Backspace</kbd> or <b>right-click</b> a corner to remove it.
          </li>
          <li>Pick a jump, click the racing line to place it, drag it along. Pick Start line to drag the start line the same way.</li>
          <li>
            Drag empty space to pan, wheel to zoom. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo, <kbd>Ctrl</kbd>+<kbd>S</kbd> save.
          </li>
          <li>Errors and the full checks are on the Advanced tab.</li>
        </ul>
      )}
    </details>
  );
}

export function Shortcuts() {
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
          <b>Add point</b> (or <kbd>A</kbd>), then click a straight to add a point there (or press and pull). It stays on
          until you press it again or <kbd>Esc</kbd>; a plain click never adds a point. Keyboard: with it on, <kbd>N</kbd> /{" "}
          <kbd>P</kbd> pick a corner and <kbd>Enter</kbd> adds a point halfway to the next one.
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
