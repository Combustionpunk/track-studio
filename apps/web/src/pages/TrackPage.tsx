import type { Point2, RcTrack } from "@track-studio/engine";
import { ArrowLeft, Download } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CopyButton, StatusBadge } from "../components/bits.js";
import { ChecksList } from "../components/ChecksList.js";
import { FitPanel } from "../components/FitPanel.js";
import { DEFAULT_LAYERS, PlanView, type Layers } from "../components/PlanView.js";
import { ErrorAlert, Skeleton, TrackPageSkeleton } from "../components/states.js";
import { ApiError, post, type Revision, type TrackResponse } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi, useStored } from "../lib/hooks.js";
import { NotFound } from "./NotFound.js";

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
  const [layers, setLayers] = useStored<Layers>("plan-layers", DEFAULT_LAYERS);
  const [highlight, setHighlight] = useState<Point2 | null>(null);
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showFit, setShowFit] = useState(params.has("fit"));

  const navigate = useNavigate();
  // the page shows the public revision (approved ?? latest) unless ?r= asks for another
  const current = tr.data?.track.publicRevision;
  const r = Number(params.get("r")) || undefined;
  const viewing = r && current && r !== current ? r : undefined;
  const old = useApi<RcTrack>(viewing ? `/api/tracks/${encodeURIComponent(id)}/r/${viewing}` : null);

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
  // one primary action per view: Approve, else Submit, else Edit
  const primary = can.approve ? "approve" : can.submit ? "submit" : can.edit ? "edit" : undefined;
  const btn = (key: string, extra = "") => `ts-btn${primary === key ? " ts-btn--primary" : ""}${extra}`;
  const why = blockedByErrors && (can.submit || can.approve) ? "actions-why" : undefined;
  const jumps = b?.features.map((f) => fmt.FEATURE_LABEL[f.type] ?? f.type) ?? [];

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
          {doc?.info.derivedFrom && (
            <p className="ts-meta">
              {doc.info.derivedFrom.orientation ? "Adapted from " : "Copy of "}
              <Link to={`/t/${doc.info.derivedFrom.id}`}>{track.derivedFrom?.name ?? "another layout"}</Link>
              {track.derivedFrom?.author && <> by {track.derivedFrom.author}</>} (revision {doc.info.derivedFrom.revision}
              {doc.info.derivedFrom.orientation && <>, {doc.info.derivedFrom.orientation}</>})
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
            {!can.edit && can.copy && (
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
              <PlanView
                area={doc.area}
                obstacles={doc.obstacles}
                built={b}
                designFeatures={doc.design.features}
                layers={layers}
                onLayersChange={setLayers}
                highlight={highlight}
                label={`Plan of ${track.name}, ${fmt.size(doc.area)}`}
                className="ts-plan-well track-plan"
              />
              <ul className="ts-plan-caption">
                <li>Layout {fmt.size(b.size, true)}</li>
                <li>Rostrum on the {b.rostrum.side} side</li>
                <li>Start line {fmt.metres(b.startLine.distance)} along the lap</li>
                <li>
                  {Math.round(b.stats.dividerLength)} m of pipe in {b.stats.dividerRuns} runs
                </li>
                {doc.info.surface && <li>{doc.info.surface}</li>}
                {doc.info.classes?.length ? <li>{doc.info.classes.join(", ")}</li> : null}
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
                  <dd className="ts-figure__v">{b.stats.corners}</dd>
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
              {doc.info.description && <p className="ts-desc">{doc.info.description}</p>}
            </section>
          ) : (
            <Skeleton className="ts-skeleton--panel" />
          )}

          {b && <ChecksList checks={b.checks} onShow={(c) => setHighlight(c.x !== undefined && c.z !== undefined ? [c.x, c.z] : null)} />}

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

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
