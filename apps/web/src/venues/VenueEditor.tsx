// Venue template editor (organisers): a form on the left and the plan on the right, both editing one draft with
// undo/redo. Drag an obstacle to move it, its handle to resize it, the rostrum along its wall. Each save is a new
// revision; tracks keep the revision they were drawn on (basedOn), new designs use the latest.
import type { Obstacle, Point2, RcVenue, Side } from "@track-studio/engine";
import { CircleAlert, CircleCheck, Monitor, Redo2, Trash2, Undo2 } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate } from "react-router-dom";
import { Message } from "../components/bits.js";
import { PlanView } from "../components/PlanView.js";
import { useHistory } from "../designer/history.js";
import { api, ApiError, type VenueSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { rostrumPos } from "../lib/plan.js";
import { useHoldReload } from "../lib/version.js";
import { pickForumTrack, pickForumVenue } from "./forum.js";
import { ForumVenuePicker } from "./ForumVenuePicker.js";
import {
  addObstacle,
  cornerWord,
  draftProblems,
  fromCorner,
  MAX_OBSTACLES,
  moveObstacle,
  obstacleName,
  obstacleSummary,
  outsideObstacles,
  rectCorners,
  resizeHandle,
  resizeObstacle,
  rostrumOffsetAt,
  setRostrumSide,
  SIDE_LABEL,
  SIDES,
  toCorner,
  venueBody,
  type VenueDraft,
} from "./model.js";

export interface VenueBase {
  venue: VenueSummary;
  doc: RcVenue;
}

interface Props {
  initial: VenueDraft;
  /** the saved venue being edited; undefined for a new one */
  base?: VenueBase;
}

type Selection = { kind: "obstacle"; i: number } | { kind: "rostrum" } | null;

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

/** Number fields report text that isn't a number (it doesn't reach the draft, so Save must wait). */
const BadFieldCtx = createContext<(id: string, bad: boolean) => void>(() => {});


export function VenueEditor({ initial, base: initialBase }: Props) {
  const navigate = useNavigate();
  const hist = useHistory<VenueDraft>(initial);
  const draft = hist.present;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [base, setBase] = useState(initialBase);
  const [savedJson, setSavedJson] = useState(() => (initialBase ? JSON.stringify(initial) : ""));
  const dirty = JSON.stringify(draft) !== savedJson;
  const [sel, setSel] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string; stale?: boolean; existing?: { id: string; name: string } } | null>(null);
  const isNew = !base;

  const saved = base?.doc.info.venue;
  const legacyVenueId = saved && saved.trackId === undefined ? saved.id : undefined;
  const problems = useMemo(() => draftProblems(draft, { legacyVenueId }), [draft, legacyVenueId]);
  const outside = useMemo(() => outsideObstacles(draft), [draft]);
  const [badFields, setBadFields] = useState<ReadonlySet<string>>(new Set());
  const reportBad = useCallback(
    (id: string, bad: boolean) =>
      setBadFields((cur) => {
        if (cur.has(id) === bad) return cur;
        const next = new Set(cur);
        if (bad) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const blocked = Object.keys(problems).length > 0 || badFields.size > 0;
  const nextRevision = (base?.venue.revision ?? 0) + 1;

  const update = useCallback((f: (d: VenueDraft) => VenueDraft, group?: string) => hist.set(f(draftRef.current), group), [hist]);
  const setObstacle = (i: number, o: Obstacle, group?: string) => update((d) => ({ ...d, obstacles: d.obstacles.map((q, k) => (k === i ? o : q)) }), group);
  const deleteObstacle = useCallback(
    (i: number) => {
      update((d) => ({ ...d, obstacles: d.obstacles.filter((_, k) => k !== i) }));
      setSel(null);
    },
    [update],
  );

  // unsaved changes: ask before leaving the page or the app
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useHoldReload(dirty); // a new version is out: no automatic reload over unsaved work (#88)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("Leave without saving? Your changes to this venue will be lost.")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  // keyboard: undo/redo, delete the selected obstacle, Esc to deselect
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return; // fields keep their own undo
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) hist.redo();
        else hist.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        hist.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selRef.current?.kind === "obstacle" && !(e.target instanceof Element && e.target.closest("button, a"))) {
        e.preventDefault();
        deleteObstacle(selRef.current.i);
      } else if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hist, deleteObstacle]);

  // a selection can point past the end after undo
  useEffect(() => {
    if (sel?.kind === "obstacle" && sel.i >= draft.obstacles.length) setSel(null);
  }, [sel, draft.obstacles.length]);

  const save = async () => {
    if (blocked || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const body = venueBody(draft);
      const res = base
        ? await api<VenueBase>(`/api/venues/${encodeURIComponent(base.venue.id)}`, { method: "PUT", json: { venue: body, baseRevision: base.venue.revision } })
        : await api<VenueBase>("/api/venues", { method: "POST", json: { venue: body } });
      setSavedJson(JSON.stringify(draft));
      if (!base) {
        navigate(`/v/${res.venue.id}`, { replace: true });
        return;
      }
      setBase(res);
      setMessage({ kind: "info", text: `Saved as revision ${res.venue.revision}.` });
    } catch (e) {
      const what = base ? `Couldn't save revision ${nextRevision}.` : "Couldn't save the venue.";
      const stale = e instanceof ApiError && e.code === "stale";
      // one template per forum track: point at the one that has it
      const taken = e instanceof ApiError && e.code === "forum-track-taken" ? (e.details as { venue?: { id: string; name: string } } | undefined)?.venue : undefined;
      const why = stale ? "Someone else saved this venue since you opened it." : e instanceof ApiError ? e.message : "The server didn't answer.";
      const after = stale ? "." : taken ? "; link this one to another track, or unlink it." : "; try Save again in a moment.";
      setMessage({ kind: "error", text: `${what} ${why} Your changes are still here${after}`, stale, existing: taken });
    } finally {
      setSaving(false);
    }
  };

  /** After a stale save: build on the latest revision, keeping this draft (saving then replaces what's in it). */
  const rebase = async () => {
    if (!base) return;
    try {
      const latest = await api<VenueBase>(`/api/venues/${encodeURIComponent(base.venue.id)}`);
      setBase(latest);
      setMessage({ kind: "info", text: `Revision ${latest.venue.revision} is the latest now (saved ${fmt.dateTime(latest.venue.updatedAt)}). Saving makes revision ${latest.venue.revision + 1} from your changes, replacing what's in it; open the venue page in another tab to compare first.` });
    } catch (e) {
      setMessage({ kind: "error", text: `Couldn't load the latest revision. ${e instanceof Error ? e.message : ""}` });
    }
  };

  // what's stopping Save, in words (fields also show their own messages)
  const blockers = [
    ...Object.entries(problems).map(([k, v]) => (k.startsWith("obstacle-") ? `${obstacleName(draft.obstacles[Number(k.slice(9))])}: ${v}` : v)),
    ...(badFields.size ? ["A number field holds something that isn't a number."] : []),
  ];

  // ------------------------------------------------------------------------------------ dragging
  type Drag = { kind: "move"; i: number; offset: Point2 } | { kind: "resize"; i: number } | { kind: "rostrum"; offset: number };
  const startDrag = (e: React.PointerEvent<SVGElement>, d: Drag) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const svg = svgOf(e.currentTarget);
    const group = `drag:${d.kind}:${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const p = planPoint(svg, ev.clientX, ev.clientY);
      const cur = draftRef.current;
      if (d.kind === "rostrum") {
        const side = cur.rostrum.side;
        const along: Point2 = side === "north" || side === "south" ? [p[0] + d.offset, p[1]] : [p[0], p[1] + d.offset];
        const offset = rostrumOffsetAt(cur.area, side, along);
        if (offset !== cur.rostrum.offset) hist.set({ ...cur, rostrum: { side, offset } }, group);
        return;
      }
      const o = cur.obstacles[d.i];
      if (!o) return;
      const next = d.kind === "move" ? moveObstacle(o, [p[0] + d.offset[0], p[1] + d.offset[1]]) : resizeObstacle(o, p);
      if (JSON.stringify(next) !== JSON.stringify(o)) hist.set({ ...cur, obstacles: cur.obstacles.map((q, k) => (k === d.i ? next : q)) }, group);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onObstacleDown = (e: React.PointerEvent<SVGElement>, i: number) => {
    const p = planPoint(svgOf(e.currentTarget), e.clientX, e.clientY);
    const o = draftRef.current.obstacles[i];
    setSel({ kind: "obstacle", i });
    startDrag(e, { kind: "move", i, offset: [o.x - p[0], o.z - p[1]] });
  };
  const onRostrumDown = (e: React.PointerEvent<SVGElement>) => {
    const p = planPoint(svgOf(e.currentTarget), e.clientX, e.clientY);
    const { area, rostrum } = draftRef.current;
    const [rx, rz] = rostrumPos(area, rostrum.side, rostrum.offset);
    setSel({ kind: "rostrum" });
    startDrag(e, { kind: "rostrum", offset: rostrum.side === "north" || rostrum.side === "south" ? rx - p[0] : rz - p[1] });
  };

  const [rx, rz] = rostrumPos(draft.area, draft.rostrum.side, draft.rostrum.offset);
  const vertical = draft.rostrum.side === "east" || draft.rostrum.side === "west";
  const L = draft.area.length, W = draft.area.width;
  const showArea = !("length" in problems) && !("width" in problems);

  const overlay = (m: number) => (
    <g className="ve-layer">
      {showArea && (
        <>
          <rect x={-L / 2} y={-W / 2} width={L} height={W} className="ve-area-edge" vectorEffect="non-scaling-stroke" />
          <text className="ve-dim" x={0} y={-W / 2 - 10 * m} fontSize={13 * m} strokeWidth={3 * m} textAnchor="middle">
            {L.toFixed(1)} m
          </text>
          <text className="ve-dim" x={-L / 2 - 10 * m} y={0} fontSize={13 * m} strokeWidth={3 * m} textAnchor="middle" transform={`rotate(-90 ${-L / 2 - 10 * m} 0)`}>
            {W.toFixed(1)} m
          </text>
        </>
      )}
      {draft.obstacles.map((o, i) => {
        const on = sel?.kind === "obstacle" && sel.i === i;
        const cls = `ve-obstacle${on ? " on" : ""}${outside.includes(i) ? " out" : ""}`;
        if (problems[`obstacle-${i}`]) return null;
        return o.type === "circle" ? (
          <circle key={i} data-handle="obstacle" className={cls} cx={o.x} cy={-o.z} r={Math.max(o.radius, 6 * m)} vectorEffect="non-scaling-stroke" onPointerDown={(e) => onObstacleDown(e, i)}>
            <title>{`${obstacleName(o)}: drag to move`}</title>
          </circle>
        ) : (
          <polygon key={i} data-handle="obstacle" className={cls} points={rectCorners(o).map(([x, z]) => `${x},${-z}`).join(" ")} vectorEffect="non-scaling-stroke" onPointerDown={(e) => onObstacleDown(e, i)}>
            <title>{`${obstacleName(o)}: drag to move`}</title>
          </polygon>
        );
      })}
      <rect
        data-handle="rostrum"
        className={`ve-rostrum${sel?.kind === "rostrum" ? " on" : ""}`}
        x={rx - (vertical ? 0.6 : 2.5)}
        y={-rz - (vertical ? 2.5 : 0.6)}
        width={vertical ? 1.2 : 5}
        height={vertical ? 5 : 1.2}
        rx={0.2}
        vectorEffect="non-scaling-stroke"
        onPointerDown={onRostrumDown}
      >
        <title>Rostrum: drag along its wall</title>
      </rect>
      {sel?.kind === "obstacle" && draft.obstacles[sel.i] && !problems[`obstacle-${sel.i}`] && (
        <ResizeHandle o={draft.obstacles[sel.i]} m={m} onPointerDown={(e) => startDrag(e, { kind: "resize", i: sel.i })} />
      )}
    </g>
  );

  const name = draft.info.name.trim() || (base ? base.venue.name : "New venue");
  const selected = sel?.kind === "obstacle" ? sel.i : null;

  return (
    <div className="venue-editor">
      <div className="ve-bar">
        <div className="ve-title">
          <p className="crumbs">
            <Link to="/v">Venues</Link> /{" "}
            {base && (
              <>
                <Link to={`/v/${base.venue.id}`}>{base.venue.name}</Link> /
              </>
            )}
          </p>
          <h1>{name}</h1>
          <span className="ve-sub">
            {base
              ? `Venue template · revision ${base.venue.revision}, saved ${fmt.date(base.venue.updatedAt)} · ${base.venue.tracks === 1 ? "1 track uses it" : `${base.venue.tracks} tracks use it`}`
              : "New venue template"}
          </span>
        </div>
        <div className="ve-actions">
          <span className="ve-state" aria-live="polite">
            {dirty ? "Unsaved changes" : base ? "No changes" : ""}
          </span>
          <button type="button" className="btn btn-icon" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 size={20} aria-hidden />
          </button>
          <button type="button" className="btn btn-icon" onClick={hist.redo} disabled={!hist.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={20} aria-hidden />
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || blocked || (!!base && !dirty)} aria-describedby={blocked ? "ve-blockers" : undefined}>
            {saving ? "Saving…" : base ? `Save as revision ${nextRevision}` : "Save venue"}
          </button>
        </div>
      </div>
      {message && (
        <div className="ve-msg">
          <Message kind={message.kind}>
            {message.text}
            {message.existing && (
              <>
                {" "}
                <Link to={`/v/${message.existing.id}`}>Open {message.existing.name}</Link>
              </>
            )}
            {message.stale && (
              <>
                {" "}
                <button type="button" className="linkish" onClick={rebase}>
                  Build on the latest revision
                </button>
              </>
            )}
          </Message>
        </div>
      )}

      <div className="ve-narrow" role="note">
        <Monitor size={16} aria-hidden className="ve-narrow-icon" />
        <span>
          Editing a venue works on a laptop or tablet.{" "}
          {base ? <Link to={`/v/${base.venue.id}`}>See this venue's details</Link> : <Link to="/v">Back to venues</Link>}
        </span>
      </div>

      <div className="ve-grid">
        <BadFieldCtx.Provider value={reportBad}>
        <form
          className="ve-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="ve-fields">
            <TextField label="Name" value={draft.info.name} maxLength={80} error={problems.name} wide onChange={(v) => update((d) => ({ ...d, info: { ...d.info, name: v } }), "name")} />
            <NumberField label="Area length" hint="east–west" value={draft.area.length} unit="m" error={problems.length} onChange={(v) => update((d) => ({ ...d, area: { ...d.area, length: v } }), "area.length")} />
            <NumberField label="Area width" hint="north–south" value={draft.area.width} unit="m" error={problems.width} onChange={(v) => update((d) => ({ ...d, area: { ...d.area, width: v } }), "area.width")} />
            <SelectField
              label="Rostrum side"
              value={draft.rostrum.side}
              options={SIDES.map((s) => ({ value: s, label: SIDE_LABEL[s] }))}
              onChange={(v) => {
                setSel({ kind: "rostrum" });
                update((d) => ({ ...d, rostrum: setRostrumSide(d.area, d.rostrum, v as Side) }));
              }}
            />
            <NumberField
              label="Rostrum position"
              hint={`from the ${cornerWord(draft.rostrum.side)} corner`}
              value={toCorner(draft.area, draft.rostrum.side, draft.rostrum.offset)}
              unit="m"
              error={problems.rostrum}
              onChange={(v) => update((d) => ({ ...d, rostrum: { ...d.rostrum, offset: fromCorner(d.area, d.rostrum.side, v) } }), "rostrum")}
            />
            <ForumVenuePicker
              value={draft.info.venue ?? null}
              area={draft.area}
              isNew={isNew}
              error={problems.forumTrack}
              onPick={(v, t) => update((d) => (t ? pickForumTrack(d, v, t, { isNew }) : pickForumVenue(d, v, { isNew })))}
              onClear={() => update((d) => ({ ...d, info: { ...d.info, venue: null } }))}
            />
            <TextField label="Notes (optional)" value={draft.info.notes ?? ""} multiline wide onChange={(v) => update((d) => ({ ...d, info: { ...d.info, notes: v } }), "notes")} />
          </div>

          <div className="ve-obstacles">
            <div className="ve-obstacles-head">
              <span className="ve-label" id="ve-obstacles-h">
                Obstacles
              </span>
              <div className="row">
                <button type="button" className="btn btn-sm" disabled={draft.obstacles.length >= MAX_OBSTACLES} onClick={() => { update((d) => addObstacle(d, "circle")); setSel({ kind: "obstacle", i: draft.obstacles.length }); }}>
                  Add circle
                </button>
                <button type="button" className="btn btn-sm" disabled={draft.obstacles.length >= MAX_OBSTACLES} onClick={() => { update((d) => addObstacle(d, "rect")); setSel({ kind: "obstacle", i: draft.obstacles.length }); }}>
                  Add rectangle
                </button>
              </div>
            </div>
            {draft.obstacles.length === 0 ? (
              <p className="ve-empty">No pillars, posts or keep-clear areas: the whole area is track. Add one if the hall has something in the way.</p>
            ) : (
              <ul className="ve-list" aria-labelledby="ve-obstacles-h">
                {draft.obstacles.map((o, i) => (
                  <li key={i} className={`ve-item${selected === i ? " on" : ""}${problems[`obstacle-${i}`] || outside.includes(i) ? " bad" : ""}`}>
                    <button type="button" className="ve-item-pick" aria-expanded={selected === i} onClick={() => setSel(selected === i ? null : { kind: "obstacle", i })}>
                      <span className="ve-item-name">{obstacleName(o)}</span>
                      <span className="ve-item-sum">{obstacleSummary(o)}</span>
                      {selected !== i && (problems[`obstacle-${i}`] || outside.includes(i)) && (
                        <span className="ve-help error">{problems[`obstacle-${i}`] ?? "Sticks out of the track area."}</span>
                      )}
                    </button>
                    <button type="button" className="btn btn-quiet btn-icon" aria-label={`Delete ${obstacleName(o)}`} title="Delete" onClick={() => deleteObstacle(i)}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                    {selected === i && <ObstacleFields o={o} error={problems[`obstacle-${i}`]} onChange={(next, field) => setObstacle(i, next, `o${i}.${field}`)} />}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {outside.length === 0 ? (
            <div className="ve-check ok" role="status">
              <CircleCheck size={16} aria-hidden /> All obstacles are inside the track area.
            </div>
          ) : (
            <div className="ve-check warn" role="status">
              <CircleAlert size={16} aria-hidden />
              <span>
                {outside.map((i) => obstacleName(draft.obstacles[i])).join(", ")} {outside.length === 1 ? "sticks" : "stick"} out of the track area. Move {outside.length === 1 ? "it" : "them"} in, or
                make the area bigger.
              </span>
            </div>
          )}
          {blockers.length > 0 && (
            <div className="ve-check bad" id="ve-blockers" role="status">
              <CircleAlert size={16} aria-hidden />
              <span>
                Fix before saving: {blockers.join(" ")}
              </span>
            </div>
          )}
          <p className="ve-note">
            Saving makes revision {nextRevision}. Tracks keep the revision they were drawn on; new designs use the latest.
          </p>
        </form>
        </BadFieldCtx.Provider>

        <section className="ve-plan-wrap" aria-label="Venue plan">
          <PlanView
            area={showArea ? draft.area : { length: 22, width: 12 }}
            obstacles={draft.obstacles.filter((_, i) => !problems[`obstacle-${i}`])}
            rostrum={{ side: draft.rostrum.side, x: rx, z: rz }}
            label={`Plan of ${name}, ${fmt.metres(L)} by ${fmt.metres(W)}`}
            className="ve-plan"
            overlay={overlay}
            onBackgroundClick={() => setSel(null)}
          />
          <div className="ve-hint">Drag an obstacle to move it, its handle to resize. Drag the rostrum along its wall.</div>
        </section>
      </div>
    </div>
  );
}

function ResizeHandle({ o, m, onPointerDown }: { o: Obstacle; m: number; onPointerDown: (e: React.PointerEvent<SVGElement>) => void }) {
  const [hx, hz] = resizeHandle(o);
  return (
    <circle data-handle="resize" className="ve-resize" cx={hx} cy={-hz} r={7 * m} vectorEffect="non-scaling-stroke" onPointerDown={onPointerDown}>
      <title>{o.type === "circle" ? "Drag to change the radius" : "Drag to change the size"}</title>
    </circle>
  );
}

function ObstacleFields({ o, error, onChange }: { o: Obstacle; error?: string; onChange: (o: Obstacle, field: string) => void }) {
  const num = (k: string, label: string, value: number, unit = "m") => (
    <NumberField key={k} label={label} value={value} unit={unit} onChange={(v) => onChange({ ...o, [k]: v } as Obstacle, k)} />
  );
  return (
    <div className="ve-item-fields">
      <TextField label="Label" value={o.label ?? ""} maxLength={60} wide onChange={(v) => onChange({ ...o, label: v }, "label")} />
      {num("x", "x (east)", o.x)}
      {num("z", "z (north)", o.z)}
      {o.type === "circle" ? (
        num("radius", "Radius", o.radius)
      ) : (
        <>
          {num("length", "Length", o.length)}
          {num("width", "Width", o.width)}
          {num("rotation", "Rotation", o.rotation ?? 0, "°")}
        </>
      )}
      {error && (
        <p className="ve-help error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------ fields
function TextField(props: { label: string; value: string; onChange: (v: string) => void; error?: string; maxLength?: number; wide?: boolean; multiline?: boolean }) {
  const id = useId();
  const { label, value, onChange, error, maxLength, wide, multiline } = props;
  return (
    <div className={`ve-field${wide ? " wide" : ""}`}>
      <label htmlFor={id} className="ve-label">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} className="ve-input" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className={`ve-input${error ? " invalid" : ""}`} value={value} maxLength={maxLength} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      {error && (
        <span id={`${id}-e`} className="ve-help error">
          {error}
        </span>
      )}
    </div>
  );
}

function SelectField(props: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="ve-field">
      <label htmlFor={id} className="ve-label">
        {props.label}
      </label>
      <select id={id} className="ve-input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const show = (v: number) => String(v);

/**
 * A number in the draft, edited as text: what's typed stays as typed while it parses to the draft's value, and
 * follows the draft at once when it changes from elsewhere (a drag, undo). Text that isn't a number doesn't change
 * the draft; the field reports it so Save waits until it's fixed.
 */
function NumberField(props: { label: string; hint?: string; value: number; onChange: (v: number) => void; unit?: string; error?: string; wide?: boolean }) {
  const id = useId();
  const { label, hint, value, onChange, unit, error, wide } = props;
  const reportBad = useContext(BadFieldCtx);
  // undefined: not a number
  const parse = (t: string): number | undefined => (t.trim() !== "" && Number.isFinite(Number(t)) ? Number(t) : undefined);
  const [text, setText] = useState(show(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    // the draft changed under the field (adjusting state while rendering, so it never shows a stale value)
    setShown(value);
    if (parse(text) !== value) setText(show(value));
  }
  const parsed = parse(text);
  const bad = parsed === undefined;
  useEffect(() => {
    reportBad(id, bad);
    return () => reportBad(id, false);
  }, [id, bad, reportBad]);
  const msg = bad ? "Enter a number." : error;
  return (
    <div className={`ve-field${wide ? " wide" : ""}`}>
      <label htmlFor={id} className="ve-label">
        {label}
        {hint && <span className="ve-label-hint"> {hint}</span>}
      </label>
      <span className="ve-with-unit">
        <input
          id={id}
          className={`ve-input${msg ? " invalid" : ""}`}
          inputMode="decimal"
          value={text}
          aria-invalid={!!msg}
          aria-describedby={msg ? `${id}-e` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const v = parse(e.target.value);
            if (v !== undefined && v !== value) {
              setShown(v);
              onChange(v);
            }
          }}
        />
        {unit && <span className="ve-unit">{unit}</span>}
      </span>
      {msg && (
        <span id={`${id}-e`} className="ve-help error">
          {msg}
        </span>
      )}
    </div>
  );
}
