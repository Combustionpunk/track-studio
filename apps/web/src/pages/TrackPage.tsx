import { drawingArea, type Point2, type RcTrack } from "@track-studio/engine";
import { ArrowLeft, Download, Lock } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CopyButton, StatusBadge } from "../components/bits.js";
import { ChecksList } from "../components/ChecksList.js";
import { FitPanel } from "../components/FitPanel.js";
import { DEFAULT_LAYERS, PlanView, type Layers } from "../components/PlanView.js";
import { ErrorAlert, Skeleton, TrackPageSkeleton } from "../components/states.js";
import { ApiError, post, type ClassSpeed, type LapRecord, type LapStats, type Revision, type TrackResponse, type UsedAt } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { areaBounds } from "../lib/plan.js";
import { useApi, useSessionChoice, useStored } from "../lib/hooks.js";
import { estimateSeconds, lapTime, recordTime, speedFor, useClassSpeeds } from "../lib/laps.js";
import { hasWebGL } from "../viewer3d/support.js";
import { NotFound } from "./NotFound.js";

// three.js and the 3D view load only when 3D is opened (#83)
const Viewer3D = lazy(() => import("../viewer3d/Viewer3D.js"));
const VIEWS = ["2d", "3d"] as const;

/** A bare date (no time) is that day wherever you are, not midnight UTC. */
const dateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Where the forum says the layout was raced (#66). Not shown at all when the forum can't be reached. */
function UsedAtSection({ used }: { used: UsedAt }) {
  const n = used.events.length;
  return (
    <section className="ts-section" aria-labelledby="used-h">
      <h2 id="used-h" className="ts-heading">
        Used at
      </h2>
      {n === 0 ? (
        <p className="ts-help">Not raced yet. No event on the forum has used this layout, so the tyres are still clean.</p>
      ) : (
        <>
          <ol className="ts-used">
            {used.events.map((e) => (
              <li key={e.id} className="ts-used__event">
                {e.url ? (
                  <a className="ts-used__title" href={e.url} target="_blank" rel="noopener noreferrer">
                    {e.title}
                  </a>
                ) : (
                  <span className="ts-used__title">{e.title}</span>
                )}
                <span className="ts-used__meta">
                  {e.startDate && fmt.date(dateOnly(e.startDate) ? `${e.startDate}T12:00:00` : e.startDate)}
                  {e.venue && (
                    <>
                      {e.startDate && " · "}
                      {e.venue.name}
                      {e.venueTrack && `, ${e.venueTrack.name}`}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <p className="ts-meta">
            {n} event{n === 1 ? "" : "s"}
            {used.venues.length > 0 && <> · Raced at: {used.venues.map((v) => v.name).join(", ")}</>}
          </p>
        </>
      )}
    </section>
  );
}

/** A track record: time, then driver · car · date, the date linked to the meeting on the forum. */
function RecordRow({ label, rec }: { label: string; rec: LapRecord }) {
  const m = rec.meeting;
  const when = m?.date ? fmt.date(dateOnly(m.date) ? `${m.date}T12:00:00` : m.date) : null;
  return (
    <div className="ts-laps__record">
      <dt>{label}</dt>
      <dd>
        <span className="ts-laps__time">{recordTime(rec.ms)}</span>{" "}
        <span className="ts-laps__meta">
          {[rec.driver.name, rec.car].filter(Boolean).join(" · ")}
          {m && (when || m.url) && (
            <>
              {" · "}
              {m.url ? (
                <a href={m.url} target="_blank" rel="noopener noreferrer" title={m.title} aria-label={when ? `${m.title}, ${when}` : m.title}>
                  {when ?? m.title}
                </a>
              ) : (
                when
              )}
            </>
          )}
        </span>
      </dd>
    </div>
  );
}

/**
 * Lap times on this layout, from the forum's race results (#76): per class, the typical lap and both track records.
 * Not raced yet: the estimate per class from the lap length (class speeds). Not shown when the forum can't be reached.
 */
function LapTimesSection({ stats, lapLength, speeds }: { stats: LapStats; lapLength: number; speeds: ClassSpeed[] | undefined }) {
  const estimate = (cls: string) => {
    const speed = speedFor(speeds, cls);
    return speed && lapLength > 0 ? lapTime(estimateSeconds(lapLength, speed), true) : "—";
  };
  return (
    <section className="ts-section" aria-labelledby="laps-h">
      <h2 id="laps-h" className="ts-heading">
        Lap times
      </h2>
      {stats.classes.length === 0 ? (
        <>
          <p className="ts-help">No races on this layout yet. Once results from a meeting on it are published on the forum, its typical lap and track records show here.</p>
          {speeds && speeds.length > 0 && lapLength > 0 && (
            <p className="ts-meta">
              Estimated from the {fmt.lap(lapLength)} lap:{" "}
              {speeds.map((c, i) => (
                <span key={c.class}>
                  {i > 0 && " · "}
                  <span className="ts-laps__est">
                    {c.class} {estimate(c.class)}
                  </span>
                </span>
              ))}
            </p>
          )}
        </>
      ) : (
        <ul className="ts-laps">
          {stats.classes.map((c) => (
            <li key={c.class} className="ts-laps__class">
              <h3 className="ts-laps__name">{c.class}</h3>
              <dl className="ts-laps__list">
                <div className="ts-laps__typical">
                  <dt>Typical lap</dt>
                  <dd>
                    <span className="ts-laps__time">{c.typicalLap ? lapTime(c.typicalLap.medianMs / 1000) : estimate(c.class)}</span>
                    {c.typicalLap && (
                      <span className="ts-laps__meta">
                        {" "}
                        Trimmed mean {lapTime(c.typicalLap.trimmedMeanMs / 1000)} · {c.typicalLap.laps.toLocaleString("en-GB")} lap{c.typicalLap.laps === 1 ? "" : "s"} · {c.typicalLap.meetings} meeting
                        {c.typicalLap.meetings === 1 ? "" : "s"}
                      </span>
                    )}
                  </dd>
                </div>
                {c.recordLap && <RecordRow label="Lap record" rec={c.recordLap} />}
                {c.record3 && <RecordRow label="Best 3 laps" rec={c.record3} />}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const Back = () => (
  <Link to="/" className="ts-back">
    <ArrowLeft size={16} aria-hidden />
    Library
  </Link>
);

export function TrackPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tr = useApi<TrackResponse>(`/api/tracks/${encodeURIComponent(id)}`);
  const revs = useApi<{ revisions: Revision[] }>(`/api/tracks/${encodeURIComponent(id)}/revisions`);
  const speeds = useClassSpeeds();
  const [layers, setLayers] = useStored<Layers>("plan-layers", DEFAULT_LAYERS);
  const [highlight, setHighlight] = useState<Point2 | null>(null);
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showFit, setShowFit] = useState(params.has("fit"));
  const [view, setView] = useSessionChoice("track-view", VIEWS, "2d");
  const [noWebGL, setNoWebGL] = useState<"none" | "lost">();
  const unsupported = useCallback((why: "none" | "lost") => setNoWebGL(why), []);

  const navigate = useNavigate();
  // the page shows the public revision (approved ?? latest) unless ?r= asks for another
  const current = tr.data?.track.publicRevision;
  const r = Number(params.get("r")) || undefined;
  const viewing = r && current && r !== current ? r : undefined;
  const old = useApi<RcTrack>(viewing ? `/api/tracks/${encodeURIComponent(id)}/r/${viewing}` : null);

  // the drawing area, the same object from render to render so the 3D view isn't rebuilt (drawingArea makes a new one
  // for files without an area)
  const shown = viewing ? old.data : tr.data?.doc;
  const area = useMemo(() => (shown?.area || shown?.built ? drawingArea(shown) : undefined), [shown]);

  if (tr.error) {
    if (tr.error instanceof ApiError && tr.error.status === 404) return <NotFound what="track" />;
    return (
      <div className="ts-page">
        <Back />
        <ErrorAlert title="Couldn't load this track." onRetry={tr.reload}>
          {tr.error.message}. Check your connection and try again in a moment.
        </ErrorAlert>
      </div>
    );
  }
  if (!tr.data) return <TrackPageSkeleton />;

  const { track, can } = tr.data;
  const doc = viewing ? old.data : tr.data.doc;
  const rev = viewing ?? track.publicRevision; // the revision on screen
  const b = doc?.built;
  const no3d = view === "3d" ? (noWebGL ?? (hasWebGL() ? undefined : "none")) : undefined;
  const origin = window.location.origin;
  const link = `${origin}/t/${track.id}${viewing ? `?r=${viewing}` : ""}`;
  const embed = `<iframe src="${origin}/embed/${track.id}${viewing ? `?r=${viewing}` : ""}" width="100%" height="460" frameborder="0" loading="lazy" title="${escAttr(track.name)} – Track Studio"></iframe>`;
  const download = `/api/tracks/${track.id}/r/${rev}.rctrack.json`;
  const status = rev === track.approvedRevision && track.status !== "archived" ? "approved" : rev === track.revision ? track.status : "draft";

  const copy = async () => {
    setBusy("copy");
    setActionError(undefined);
    try {
      const res = await post<TrackResponse>(`/api/tracks/${track.id}/copy`, viewing ? { revision: viewing } : {});
      navigate(`/t/${res.track.id}/edit`);
    } catch (e) {
      setActionError((e as Error).message);
      setBusy(undefined);
    }
  };
  const blockedByErrors =
    track.errors > 0 ? `Revision ${track.revision} has ${track.errors === 1 ? "an error" : `${track.errors} errors`} — fix ${track.errors === 1 ? "it" : "them"} in the designer first` : undefined;
  const act = async (action: "submit" | "approve" | "archive") => {
    setConfirmArchive(false);
    setBusy(action);
    setActionError(undefined);
    try {
      await post(`/api/tracks/${track.id}/${action}`);
      tr.reload();
      revs.reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const showRevision = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === current) next.delete("r");
    else next.set("r", String(n));
    setParams(next, { replace: true });
    setHighlight(null);
  };
  // a locked layout is changed on a copy (#64): Copy and edit stands where Edit was
  const copyAndEdit = !!track.locked && can.copy;
  // one primary action per view: Approve, else Submit, else Edit (or Copy and edit)
  const primary = can.approve ? "approve" : can.submit ? "submit" : can.edit ? "edit" : copyAndEdit ? "copy" : undefined;
  const btn = (key: string, extra = "") => `ts-btn${primary === key ? " ts-btn--primary" : ""}${extra}`;
  const why = blockedByErrors && (can.submit || can.approve) ? "actions-why" : undefined;
  const jumps = b?.features?.map((f) => fmt.FEATURE_LABEL[f.type] ?? f.type) ?? [];

  return (
    <div className="ts-page ts-track">
      <Back />
      <div className="ts-track-head">
        <div className="ts-track-head__text">
          <div className="ts-track-head__title">
            <h1 className="ts-title">{track.name}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="ts-meta">
            by {fmt.author(track.author)} · {track.venue ? <Link to={`/v/${track.venue.id}`}>{track.venue.name ?? track.venue.id}</Link> : "No venue"} · revision {rev}
            {!viewing && <>, saved {fmt.date(track.updatedAt)}</>}
          </p>
          {doc?.info?.derivedFrom && (
            <p className="ts-meta">
              {doc.info.derivedFrom.orientation ? "Adapted from " : "Based on "}
              <Link to={`/t/${doc.info.derivedFrom.id}`}>{track.derivedFrom?.name ?? "another layout"}</Link>
              {track.derivedFrom?.author && <> by {track.derivedFrom.author}</>} (revision {doc.info.derivedFrom.revision}
              {doc.info.derivedFrom.orientation && <>, {doc.info.derivedFrom.orientation}</>})
            </p>
          )}
          {track.locked && (
            <p className="ts-meta ts-locked">
              <Lock size={14} aria-hidden />
              {track.locked === "event" ? "Locked: used by an event" : "Locked: in the library"}
            </p>
          )}
        </div>
        <div className="ts-actions-wrap">
          <div className="ts-actions" role="group" aria-label="Track actions">
            {can.edit && (
              <Link className={btn("edit")} to={`/t/${track.id}/edit`}>
                {track.newerRevision ? `Edit revision ${track.revision}` : "Edit"}
              </Link>
            )}
            {copyAndEdit && (
              <button type="button" className={btn("copy")} onClick={copy} disabled={!!busy} title="This layout can't be changed; edit your own copy, credited to the original">
                {busy === "copy" ? "Copying…" : "Copy and edit"}
              </button>
            )}
            {!can.edit && !copyAndEdit && can.copy && (
              <button type="button" className="ts-btn" onClick={copy} disabled={!!busy} title="Start your own version of this layout, credited to the original">
                {busy === "copy" ? "Copying…" : "Make my own copy"}
              </button>
            )}
            <Link className="ts-btn" to={`/t/${track.id}/build${viewing ? `?r=${viewing}` : ""}`}>
              Build sheet
            </Link>
            <button type="button" className="ts-btn" onClick={() => setShowFit((s) => !s)} aria-expanded={showFit} aria-controls="fit-panel">
              Fit to a venue
            </button>
            {can.submit && (
              <button type="button" className={btn("submit")} onClick={() => act("submit")} disabled={!!busy || !!blockedByErrors} aria-describedby={why}>
                {busy === "submit" ? "Submitting…" : `Submit revision ${track.revision}`}
              </button>
            )}
            {can.approve && (
              <button type="button" className={btn("approve")} onClick={() => act("approve")} disabled={!!busy || !!blockedByErrors} aria-describedby={why}>
                {busy === "approve" ? "Approving…" : `Approve revision ${track.revision}`}
              </button>
            )}
            {can.archive && (
              <button type="button" className="ts-btn ts-btn--danger" onClick={() => setConfirmArchive(true)} disabled={!!busy} aria-expanded={confirmArchive}>
                {busy === "archive" ? "Archiving…" : "Archive"}
              </button>
            )}
          </div>
          {why && (
            <p className="ts-help" id={why}>
              {blockedByErrors}.
            </p>
          )}
        </div>
      </div>

      {confirmArchive && (
        <div className="ts-confirm" role="group" aria-label="Confirm archive">
          <p>
            Archive “{track.name}”? It will be hidden from the library. Its revisions are kept.
          </p>
          <div className="ts-actions">
            <button type="button" className="ts-btn ts-btn--danger" onClick={() => act("archive")} autoFocus>
              Archive track
            </button>
            <button type="button" className="ts-btn ts-btn--quiet" onClick={() => setConfirmArchive(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {actionError && <ErrorAlert title="That didn't work.">{actionError}</ErrorAlert>}
      {track.newerRevision && rev !== track.newerRevision.revision && (
        <p className="ts-note" role="status">
          This is approved revision {track.approvedRevision}, the one the library and meetings use. Revision {track.newerRevision.revision} is{" "}
          {track.newerRevision.status === "submitted" ? "submitted for approval" : "a draft in progress"}.{" "}
          <button type="button" className="ts-linkbtn" onClick={() => showRevision(track.newerRevision!.revision)}>
            View revision {track.newerRevision.revision}
          </button>
        </p>
      )}
      {viewing && (
        <p className="ts-note" role="status">
          You're looking at revision {viewing}.{" "}
          <button type="button" className="ts-linkbtn" onClick={() => showRevision(current!)}>
            Show {track.approvedRevision ? `the approved revision (${current})` : `the latest (revision ${current})`}
          </button>
        </p>
      )}

      <div className="ts-track-grid">
        <section className="ts-track-main" aria-label="Plan">
          {!doc || !b ? (
            old.error ? (
              <ErrorAlert title={`Couldn't load revision ${viewing}.`} onRetry={old.reload}>
                {old.error.message}.
              </ErrorAlert>
            ) : (
              <Skeleton className="ts-plan-well ts-skeleton--plan" />
            )
          ) : (
            <>
              <div className="track-view">
                {view === "3d" && !no3d ? (
                  <Suspense
                    fallback={
                      <div role="status" aria-busy="true">
                        <span className="sr-only">Loading the 3D view…</span>
                        <Skeleton className="ts-plan-well track-plan" style={{ "--plan-ratio": planRatio(area!) } as React.CSSProperties} />
                      </div>
                    }
                  >
                    <Viewer3D area={area!} built={b} label={`3D view of ${track.name}, ${fmt.size(area!)}`} className="ts-plan-well track-plan" onUnsupported={unsupported} />
                  </Suspense>
                ) : (
                  <PlanView
                    area={area!}
                    built={b}
                    designFeatures={doc.design?.features}
                    layers={layers}
                    onLayersChange={setLayers}
                    highlight={highlight}
                    label={`Plan of ${track.name}, ${fmt.size(area!)}`}
                    className="ts-plan-well track-plan"
                  />
                )}
                {/* always there, so screen readers hear the message when it appears */}
                <p className={no3d ? "ts-note" : "sr-only"} role="status">
                  {no3d === "lost"
                    ? "The 3D view stopped: the browser lost its graphics. Here's the 2D plan; reload the page to try 3D again."
                    : no3d
                      ? "The 3D view needs WebGL, which this browser doesn't have or has turned off. Here's the 2D plan."
                      : ""}
                </p>
                <div className="plan-viewswitch" role="group" aria-label="View">
                  {VIEWS.map((k) => (
                    <button key={k} type="button" aria-pressed={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
                      {k.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="ts-plan-caption">
                <li>Layout {fmt.size(b.size, true)}</li>
                {doc.info?.drawnFor?.name && <li>Drawn for {doc.info.drawnFor.name}</li>}
                {b.startLine && <li>Start line {fmt.metres(b.startLine.distance)} along the lap</li>}
                {b.stats && (
                  <li>
                    {Math.round(b.stats.dividerLength)} m of pipe in {b.stats.dividerRuns} runs
                  </li>
                )}
                {doc.info?.surface && <li>{doc.info.surface}</li>}
                {doc.info?.classes?.length ? <li>{doc.info.classes.join(", ")}</li> : null}
                <li>Plan drawn from revision {rev}</li>
              </ul>
            </>
          )}
          {showFit && tr.data.doc.built && (
            <FitPanel trackId={track.id} built={tr.data.doc.built} initialVenue={params.get("fit") ?? undefined} initialOrientation={params.get("o") ?? undefined} />
          )}
        </section>

        <aside className="ts-track-side">
          {doc && b ? (
            <section className="ts-panel" aria-label="Key figures">
              <dl className="ts-figures ts-figures--key">
                <div className="ts-figure">
                  <dt className="ts-figure__l">Lap length</dt>
                  <dd className="ts-figure__v">{fmt.lap(b.lapLength)}</dd>
                </div>
                <div className="ts-figure">
                  <dt className="ts-figure__l">Corners</dt>
                  <dd className="ts-figure__v">{b.stats?.corners ?? "—"}</dd>
                </div>
                <div className="ts-figure">
                  <dt className="ts-figure__l">Track area</dt>
                  <dd className="ts-figure__v">{fmt.size(doc.area, true)}</dd>
                </div>
                <div className="ts-figure">
                  <dt className="ts-figure__l">Jumps</dt>
                  <dd className="ts-figure__v">{jumps.length}</dd>
                  {jumps.length > 0 && <dd className="ts-figure__sub">{jumps.join(", ")}</dd>}
                </div>
              </dl>
              {doc.info?.description && <p className="ts-desc">{doc.info.description}</p>}
            </section>
          ) : (
            <Skeleton className="ts-skeleton--panel" />
          )}

          {b && <ChecksList checks={b.checks ?? []} onShow={(c) => setHighlight(c.x !== undefined && c.z !== undefined ? [c.x, c.z] : null)} />}

          {tr.data.usedAt && <UsedAtSection used={tr.data.usedAt} />}

          {tr.data.lapStats && <LapTimesSection stats={tr.data.lapStats} lapLength={tr.data.track.lapLength} speeds={speeds} />}

          <section className="ts-section" aria-labelledby="share-h">
            <h2 id="share-h" className="ts-heading">
              Share and download
            </h2>
            <div className="ts-actions ts-actions--share">
              <CopyButton text={link} label="Copy forum link" />
              <CopyButton text={embed} label="Copy embed" />
              <a className="ts-btn ts-btn--quiet" href={download} download>
                <Download size={16} aria-hidden />
                Download .rctrack.json
              </a>
            </div>
          </section>

          <section className="ts-section" aria-labelledby="revs-h">
            <h2 id="revs-h" className="ts-heading">
              Revisions
            </h2>
            {revs.error ? (
              <ErrorAlert title="Couldn't load the revisions." onRetry={revs.reload}>
                {revs.error.message}.
              </ErrorAlert>
            ) : revs.data ? (
              <ol className="ts-revisions">
                {revs.data.revisions.map((x) => (
                  <li key={x.revision}>
                    <button type="button" className="ts-revision" onClick={() => showRevision(x.revision)} aria-current={x.revision === rev ? "true" : undefined}>
                      <span className="ts-revision__name">
                        Revision {x.revision}
                        {x.revision === track.approvedRevision ? " · approved" : x.status !== "draft" ? ` · ${x.status}` : ""}
                      </span>
                      <span className="ts-revision__date">{fmt.date(x.createdAt)}</span>
                      <span className="ts-revision__meta">
                        by {fmt.author(x.createdBy)}
                        {x.note && <> · {x.note}</>}
                      </span>
                    </button>
                    <a href={x.downloadUrl} download className="ts-btn ts-btn--quiet ts-btn--icon" aria-label={`Download revision ${x.revision}`} title="Download">
                      <Download size={16} aria-hidden />
                    </a>
                  </li>
                ))}
              </ol>
            ) : (
              <div role="status" aria-busy="true">
                <span className="sr-only">Loading revisions…</span>
                <Skeleton className="ts-skeleton--line" />
                <Skeleton className="ts-skeleton--line" />
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** The plan's shape, for wells sized like it (PlanView sets the same). */
function planRatio(area: { length: number; width: number }): string {
  const b = areaBounds(area);
  return `${b.x1 - b.x0} / ${b.y1 - b.y0}`;
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
