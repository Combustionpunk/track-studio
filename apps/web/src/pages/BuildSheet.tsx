// The printable build sheet (#17): what marshals lay a track out from. A3 landscape by default, A4 offered; saved to
// PDF with the browser's print dialog. Drawn from `built` (the engine's buildSheet and print plan), in the fixed print
// palette, measured from the south-west corner of the track area. Mockup: docs/design/mockups/BuildSheet.dc.html.
import { buildSheet, type BuildSheet, type RcTrack } from "@track-studio/engine";
import { ArrowLeft, Printer } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Loading, Message } from "../components/bits.js";
import { ApiError, type TrackResponse, type TrackSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi, useElementSize } from "../lib/hooks.js";
import { cornerRows, crossoverRows, figures, jumpRows, PAPER, paperFrom, qrModules, SHEET_PX, sheetPlan, sheetStatus, shortLink, startText, type Paper } from "../lib/sheet.js";
import { NotFound } from "./NotFound.js";

// the plan's room on the A3 layout: the plan column (narrower beside a split corner table) by what's left under the header
const PLAN_PX = { width: 1039, wideWidth: 939, height: 740 };
const SPLIT_ROWS = 22; // longer corner tables print as two side by side, in a wider column
const MIN_SCREEN_ZOOM = 0.45; // phones scroll sideways rather than shrink the sheet to nothing

export function BuildSheetPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const paper = paperFrom(params.get("paper"));
  const tr = useApi<TrackResponse>(`/api/tracks/${encodeURIComponent(id)}`);
  const current = tr.data?.track.publicRevision;
  const r = Number(params.get("r")) || undefined;
  const viewing = r && current && r !== current ? r : undefined;
  const old = useApi<RcTrack>(viewing ? `/api/tracks/${encodeURIComponent(id)}/r/${viewing}` : null);
  const [stageRef, stage] = useElementSize<HTMLDivElement>();

  const setPaper = (p: Paper) => {
    const next = new URLSearchParams(params);
    if (p === "a3") next.delete("paper");
    else next.set("paper", p);
    setParams(next, { replace: true });
  };

  const doc = viewing ? old.data : tr.data?.doc;
  const rev = viewing ?? current;
  const error = tr.error ?? old.error;
  const back = `/t/${id}${viewing ? `?r=${viewing}` : ""}`;
  // on screen the sheet is scaled to fit the window; in print it is the paper's size
  const screenZoom = stage.width ? Math.max(MIN_SCREEN_ZOOM, Math.min(1, stage.width / SHEET_PX.width)) : 1;

  let body;
  if (error) body = error instanceof ApiError && error.status === 404 ? <NotFound what="track" /> : <div className="wrap page"><Message kind="error">{error.message}</Message></div>;
  else if (!tr.data || !doc || !rev) body = <div className="wrap page"><Loading what="Loading build sheet" /></div>;
  else if (!doc.built) body = <div className="wrap page"><Message kind="error">Revision {rev} has no plan yet, so there's nothing to print. Open it in the designer and save it.</Message></div>;
  else
    body = (
      <div className="sheet-zoom" style={{ "--screen-zoom": screenZoom, "--print-zoom": PAPER[paper].scale } as React.CSSProperties}>
        <Sheet track={tr.data.track} doc={doc} rev={rev} />
      </div>
    );

  return (
    <div className="sheet-page">
      <style>{`@page { size: ${PAPER[paper].page}; margin: 0; }`}</style>
      <div className="sheet-toolbar wrap">
        <Link className="btn btn-quiet" to={back}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to the track
        </Link>
        <div className="seg" role="group" aria-label="Paper size">
          {(Object.keys(PAPER) as Paper[]).map((p) => (
            <button key={p} type="button" className={p === paper ? "on" : ""} aria-pressed={p === paper} onClick={() => setPaper(p)}>
              {PAPER[p].label} landscape
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!doc?.built}>
          <Printer size={16} aria-hidden="true" /> Print or save as PDF
        </button>
        <p className="sheet-hint">The sheet is A3: print it from a computer, or save it as a PDF.</p>
      </div>
      <div className="sheet-stage" ref={stageRef}>
        {body}
      </div>
    </div>
  );
}

function Sheet({ track, doc, rev }: { track: TrackSummary; doc: RcTrack; rev: number }) {
  const s: BuildSheet = useMemo(() => buildSheet(doc), [doc]);
  const split = s.cornerPoints.length > SPLIT_ROWS;
  const plan = useMemo(() => sheetPlan(doc, split ? PLAN_PX.wideWidth : PLAN_PX.width, PLAN_PX.height), [doc, split]);
  const status = sheetStatus(track, rev);
  // the QR code and link always pin the printed revision: the sheet shouldn't follow later edits
  const link = shortLink(window.location.origin, track.id, rev);
  const qr = useMemo(() => qrModules(link.url), [link.url]);
  const corners = cornerRows(s);
  const jumps = jumpRows(s);
  const crossovers = crossoverRows(s);
  const venue = track.venue?.name ?? doc.info.venue?.name;
  const m = 1 / plan.pxPerM; // one output pixel in metres
  const disc = 11 * m;
  const vb = plan.viewBox;
  const halves = split ? [corners.slice(0, Math.ceil(corners.length / 2)), corners.slice(Math.ceil(corners.length / 2))] : [corners];

  return (
    <article className="sheet" aria-label={`Build sheet for ${doc.info.name}`}>
      {status.watermark && (
        <div className="sheet-watermark" aria-hidden="true">
          <span>DRAFT</span>
        </div>
      )}
      <header className="sheet-head">
        <div className="sheet-title">
          <span className="sheet-kicker">RC Misfits · Build sheet</span>
          <h1>{doc.info.name}</h1>
          <span className="sheet-meta">
            Revision {rev}
            {venue && (
              <>
                {" · "}
                {venue}
                {doc.basedOn && ` (venue revision ${doc.basedOn.revision})`}
              </>
            )}
            {" · "}by {fmt.author(track.author)} · printed {fmt.date(new Date().toISOString())}
          </span>
        </div>
        <div className="sheet-head-side">
          <span className={`sheet-banner sheet-banner-${status.status}`}>{status.banner}</span>
          <div className="sheet-link">
            <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} role="img" aria-label="QR code linking to the track page" shapeRendering="crispEdges">
              <path d={qr.path} />
            </svg>
            <span>{link.text}</span>
          </div>
        </div>
      </header>

      <div className={`sheet-body ${halves.length > 1 ? "sheet-body-wide" : ""}`}>
        <section className="sheet-plan" aria-label="Plan">
          <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width={vb.w * plan.pxPerM} height={vb.h * plan.pxPerM} role="img" aria-label="Plan with a 1 metre grid, measured from the south-west corner">
            <g dangerouslySetInnerHTML={{ __html: plan.svg }} />
            <g className="sheet-ticks" strokeWidth={m}>
              {plan.south.map((l) => (
                <line key={`s${l.text}`} x1={l.x} x2={l.x} y1={doc.area.width / 2} y2={doc.area.width / 2 + 0.3} />
              ))}
              {plan.west.map((l) => (
                <line key={`w${l.text}`} x1={-doc.area.length / 2} x2={-doc.area.length / 2 - 0.3} y1={l.y} y2={l.y} />
              ))}
            </g>
            <g className="sheet-edge" fontSize={13 * m}>
              {plan.south.map((l) => (
                <text key={`s${l.text}`} x={l.x} y={l.y} dy="0.35em" textAnchor="middle">
                  {l.text}
                </text>
              ))}
              {plan.west.map((l) => (
                <text key={`w${l.text}`} x={l.x} y={l.y} dy="0.35em" textAnchor="end">
                  {l.text}
                </text>
              ))}
            </g>
            <g className="sheet-corners" fontSize={(s.cornerPoints.some((c) => c.label.length > 2) ? 9.5 : 11) * m}>
              {s.cornerPoints.map((c) => (
                <g key={c.label}>
                  <circle cx={c.x} cy={-c.z} r={disc} />
                  <text x={c.x} y={-c.z} dy="0.35em" textAnchor="middle">
                    {c.label}
                  </text>
                </g>
              ))}
            </g>
            <g className="sheet-crossovers" fontSize={11 * m} strokeWidth={1.5 * m}>
              {s.crossovers.map((c) => (
                <g key={c.number}>
                  <rect x={c.x - 1.5 * disc} y={-c.z - disc} width={3 * disc} height={2 * disc} rx={3 * m} />
                  <text x={c.x} y={-c.z} dy="0.35em" textAnchor="middle">
                    X{c.number}
                  </text>
                </g>
              ))}
            </g>
          </svg>
          <p className="sheet-note">
            Grid: 1 m squares, bold every 5 m. All positions are measured from the south-west corner of the track area: across from the west wall, up from the south wall. Corner points are
            where the centre lines of the straights either side meet; the points of one corner share its number (5a, 5b).
          </p>
        </section>

        <aside className="sheet-side">
          <dl className="sheet-figures">
            {figures(s).map((f) => (
              <div key={f.label}>
                <dd>{f.value}</dd>
                <dt>{f.label}</dt>
              </div>
            ))}
          </dl>

          <div className="sheet-corner-tables">
            {halves.map((rows, k) => (
              <table key={k} className="sheet-table">
                <caption>{k === 0 ? "Corner points" : <span aria-hidden="true">&nbsp;</span>}</caption>
                <thead>
                  <tr>
                    <th scope="col">No.</th>
                    <th scope="col" className="num">From west</th>
                    <th scope="col" className="num">From south</th>
                    <th scope="col">Turn</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.label}>
                      <td className="no">{c.label}</td>
                      <td className="num">{c.fromWest}</td>
                      <td className="num">{c.fromSouth}</td>
                      <td>{c.turn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>

          <table className="sheet-table">
            <caption>Jumps</caption>
            {jumps.length ? (
              <>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">Position (west, south)</th>
                    <th scope="col" className="num">Length × height</th>
                  </tr>
                </thead>
                <tbody>
                  {jumps.map((j, i) => (
                    <tr key={i}>
                      <td>{j.type}</td>
                      <td className="num">{j.position}</td>
                      <td className="num">{j.size}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <tbody>
                <tr>
                  <td>No jumps on this track.</td>
                </tr>
              </tbody>
            )}
          </table>
          {crossovers.length > 0 && (
            <table className="sheet-table">
              <caption>Crossovers</caption>
              <thead>
                <tr>
                  <th scope="col">No.</th>
                  <th scope="col" className="num">Position (west, south)</th>
                  <th scope="col">Goes over</th>
                  <th scope="col" className="num">Size</th>
                </tr>
              </thead>
              <tbody>
                {crossovers.map((c) => (
                  <tr key={c.label}>
                    <td className="no">{c.label}</td>
                    <td className="num">{c.position}</td>
                    <td>{c.over}</td>
                    <td className="num">{c.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="sheet-note">{startText(s)}</p>
        </aside>
      </div>
    </article>
  );
}
