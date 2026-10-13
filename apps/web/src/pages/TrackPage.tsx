import type { Check, Point2, RcTrack } from "@track-studio/engine";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CopyButton, Loading, Message, StatusBadge } from "../components/bits.js";
import { FitPanel } from "../components/FitPanel.js";
import { DEFAULT_LAYERS, PlanView, type Layers } from "../components/PlanView.js";
import { ApiError, post, type Revision, type TrackResponse } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi, useStored } from "../lib/hooks.js";
import { NotFound } from "./NotFound.js";

export function TrackPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tr = useApi<TrackResponse>(`/api/tracks/${encodeURIComponent(id)}`);
  const revs = useApi<{ revisions: Revision[] }>(`/api/tracks/${encodeURIComponent(id)}/revisions`);
  const [layers, setLayers] = useStored<Layers>("plan-layers", DEFAULT_LAYERS);
  const [highlight, setHighlight] = useState<Point2 | null>(null);
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [showFit, setShowFit] = useState(params.has("fit"));

  const navigate = useNavigate();
  // the page shows the public revision (approved ?? latest) unless ?r= asks for another
  const current = tr.data?.track.publicRevision;
  const r = Number(params.get("r")) || undefined;
  const viewing = r && current && r !== current ? r : undefined;
  const old = useApi<RcTrack>(viewing ? `/api/tracks/${encodeURIComponent(id)}/r/${viewing}` : null);

  if (tr.error) return tr.error instanceof ApiError && tr.error.status === 404 ? <NotFound what="track" /> : <div className="wrap page"><Message kind="error">{tr.error.message}</Message></div>;
  if (!tr.data) return <div className="wrap page"><Loading what="Loading track" /></div>;

  const { track, can } = tr.data;
  const doc = viewing ? old.data : tr.data.doc;
  const rev = viewing ?? track.publicRevision; // the revision on screen
  const b = doc?.built;
  const origin = window.location.origin;
  const link = `${origin}/t/${track.id}${viewing ? `?r=${viewing}` : ""}`;
  const embed = `<iframe src="${origin}/embed/${track.id}${viewing ? `?r=${viewing}` : ""}" width="100%" height="460" frameborder="0" loading="lazy" title="${escAttr(track.name)} – Track Studio"></iframe>`;
  const download = `/api/tracks/${track.id}/r/${rev}.rctrack.json`;

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
  const blockedByErrors = track.errors > 0 ? `Revision ${track.revision} has ${track.errors === 1 ? "an error" : `${track.errors} errors`} — fix ${track.errors === 1 ? "it" : "them"} in the designer first` : undefined;
  const act = async (action: "submit" | "approve" | "archive") => {
    if (action === "archive" && !window.confirm(`Archive “${track.name}”? It will be hidden from the library.`)) return;
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

  return (
    <div className="wrap page track-page">
      <div className="track-head">
        <div>
          <h1>{track.name}</h1>
          <p className="byline">
            <StatusBadge status={rev === track.approvedRevision && track.status !== "archived" ? "approved" : rev === track.revision ? track.status : "draft"} /> by {track.author.username}
            {track.venue && (
              <>
                {" · "}
                <Link to={`/v/${track.venue.id}`}>{track.venue.name ?? track.venue.id}</Link>
              </>
            )}
            {" · "}revision {rev}
          </p>
          {doc?.info.derivedFrom && (
            <p className="byline">
              {doc.info.derivedFrom.orientation ? "Adapted from " : "Copy of "}
              <Link to={`/t/${doc.info.derivedFrom.id}`}>{track.derivedFrom?.name ?? "another layout"}</Link>
              {track.derivedFrom?.author && <> by {track.derivedFrom.author}</>} (revision {doc.info.derivedFrom.revision}
              {doc.info.derivedFrom.orientation && <>, {doc.info.derivedFrom.orientation}</>})
            </p>
          )}
        </div>
        <div className="actions" role="group" aria-label="Track actions">
          <a className="btn" href={download} download>
            Download
          </a>
          <CopyButton text={link} label="Copy link" />
          <CopyButton text={embed} label="Copy forum embed" />
          {can.edit && (
            <Link className="btn btn-primary" to={`/t/${track.id}/edit`}>
              {track.newerRevision ? `Edit revision ${track.revision}` : "Edit"}
            </Link>
          )}
          {!can.edit && can.copy && (
            <button type="button" className="btn" onClick={copy} disabled={!!busy} title="Start your own version of this layout, credited to the original">
              {busy === "copy" ? "Copying…" : "Make my own copy"}
            </button>
          )}
          {can.submit && (
            <button type="button" className="btn" onClick={() => act("submit")} disabled={!!busy || !!blockedByErrors} title={blockedByErrors}>
              {busy === "submit" ? "Submitting…" : `Submit revision ${track.revision}`}
            </button>
          )}
          {can.approve && (
            <button type="button" className="btn" onClick={() => act("approve")} disabled={!!busy || !!blockedByErrors} title={blockedByErrors}>
              {busy === "approve" ? "Approving…" : `Approve revision ${track.revision}`}
            </button>
          )}
          {can.archive && (
            <button type="button" className="btn btn-danger" onClick={() => act("archive")} disabled={!!busy}>
              {busy === "archive" ? "Archiving…" : "Archive"}
            </button>
          )}
          <button type="button" className={`btn ${showFit ? "on" : ""}`} onClick={() => setShowFit((s) => !s)} aria-expanded={showFit}>
            Fit to a venue
          </button>
        </div>
      </div>
      {actionError && <Message kind="error">{actionError}</Message>}
      {blockedByErrors && (can.submit || can.approve) && <Message>{blockedByErrors}.</Message>}
      {track.newerRevision && rev !== track.newerRevision.revision && (
        <Message>
          This is approved revision {track.approvedRevision} — what the library and meetings use. Revision {track.newerRevision.revision} is{" "}
          {track.newerRevision.status === "submitted" ? "submitted for approval" : "a draft in progress"}.{" "}
          <button type="button" className="linkish" onClick={() => showRevision(track.newerRevision!.revision)}>
            View revision {track.newerRevision.revision}
          </button>
        </Message>
      )}
      {viewing && (
        <Message>
          You're looking at revision {viewing}.{" "}
          <button type="button" className="linkish" onClick={() => showRevision(current!)}>
            Show {track.approvedRevision ? `the approved revision (${current})` : `the latest (revision ${current})`}
          </button>
        </Message>
      )}

      <div className="track-grid">
        <div className="track-main">
          {!doc || !b ? (
            old.error ? <Message kind="error">{old.error.message}</Message> : <Loading what="Loading plan" />
          ) : (
            <PlanView
              area={doc.area}
              obstacles={doc.obstacles}
              built={b}
              designFeatures={doc.design.features}
              layers={layers}
              onLayersChange={setLayers}
              highlight={highlight}
              label={`Plan of ${track.name}`}
              className="track-plan"
            />
          )}
          {showFit && tr.data.doc.built && <FitPanel trackId={track.id} built={tr.data.doc.built} initialVenue={params.get("fit") ?? undefined} initialOrientation={params.get("o") ?? undefined} />}
        </div>

        <aside className="track-side">
          {doc && b && (
            <section className="panel" aria-labelledby="details-h">
              <h2 id="details-h">Details</h2>
              <dl className="details">
                <dt>Lap</dt>
                <dd>{fmt.metres(b.lapLength)}</dd>
                <dt>Corners</dt>
                <dd>{b.stats.corners}</dd>
                <dt>Size</dt>
                <dd>{fmt.size(b.size, true)}</dd>
                <dt>Track area</dt>
                <dd>{fmt.size(doc.area, true)}</dd>
                <dt>Pipe</dt>
                <dd>
                  {Math.round(b.stats.dividerLength)} m in {b.stats.dividerRuns} runs
                </dd>
                <dt>Jumps</dt>
                <dd>{b.features.length ? b.features.map((f) => fmt.FEATURE_LABEL[f.type] ?? f.type).join(", ") : "none"}</dd>
                <dt>Start</dt>
                <dd>{fmt.metres(b.startLine.distance)} along the line</dd>
                <dt>Rostrum</dt>
                <dd>{b.rostrum.side} side</dd>
                {doc.info.surface && (
                  <>
                    <dt>Surface</dt>
                    <dd>{doc.info.surface}</dd>
                  </>
                )}
                {doc.info.classes?.length ? (
                  <>
                    <dt>Classes</dt>
                    <dd>{doc.info.classes.join(", ")}</dd>
                  </>
                ) : null}
                <dt>Updated</dt>
                <dd>{fmt.date(track.updatedAt)}</dd>
              </dl>
              {doc.info.description && <p className="desc">{doc.info.description}</p>}
            </section>
          )}

          {b && <ChecksList checks={b.checks} onShow={(c) => setHighlight(c.x !== undefined && c.z !== undefined ? [c.x, c.z] : null)} />}

          <section className="panel" aria-labelledby="revs-h">
            <h2 id="revs-h">Revisions</h2>
            {revs.data ? (
              <ol className="revisions">
                {revs.data.revisions.map((x) => (
                  <li key={x.revision} className={x.revision === rev ? "on" : ""}>
                    <button type="button" className="rev-btn" onClick={() => showRevision(x.revision)} aria-current={x.revision === rev}>
                      <span className="rev-n">r{x.revision}</span>
                      <span className="rev-meta">
                        {fmt.dateTime(x.createdAt)} · {x.createdBy.username}
                        {x.note && <em> — {x.note}</em>}
                      </span>
                      {x.revision === track.approvedRevision && <span className="badge badge-approved">Approved</span>}
                    </button>
                    <a href={x.downloadUrl} download className="rev-dl" aria-label={`Download revision ${x.revision}`} title="Download">
                      ↓
                    </a>
                  </li>
                ))}
              </ol>
            ) : (
              <Loading />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function ChecksList({ checks, onShow }: { checks: Check[]; onShow: (c: Check) => void }) {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <section className="panel" aria-labelledby="checks-h">
      <h2 id="checks-h">
        Checks <span className="count-pill">{checks.length}</span>
      </h2>
      {sorted.length === 0 ? (
        <p className="ok">No problems found.</p>
      ) : (
        <ul className="checks">
          {sorted.map((c, i) => (
            <li key={i} className={`lvl-${c.level}`}>
              <span className="lvl">{c.level === "error" ? "Error" : c.level === "warning" ? "Warning" : "Note"}</span>
              <span className="msg-text">{c.message}</span>
              {c.x !== undefined && (
                <button type="button" className="linkish" onClick={() => onShow(c)}>
                  Show
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
