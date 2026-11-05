import type { RcVenue } from "@track-studio/engine";
import { Download, Monitor, Pencil, Plus } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Loading, Message, VenueThumb } from "../components/bits.js";
import { PlanView } from "../components/PlanView.js";
import { TrackCard } from "../components/TrackCard.js";
import { ApiError, type TrackSummary, type VenueRevision, type VenueSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi } from "../lib/hooks.js";
import { rostrumPos } from "../lib/plan.js";
import { useSession } from "../lib/session.js";
import { obstacleName, toCorner } from "../venues/model.js";
import { NotFound } from "./NotFound.js";

export function Venues() {
  const list = useApi<{ venues: VenueSummary[] }>("/api/venues");
  const { me } = useSession();
  return (
    <div className="wrap page">
      <div className="page-head track-head">
        <div>
          <h1>Venues</h1>
          <p className="lede">Venue templates: each hall's usable track area, rostrum and fixed obstacles. New designs start from the latest revision.</p>
        </div>
        {me?.organiser && (
          <Link to="/v/new" className="btn btn-primary ve-edit-btn">
            <Plus size={16} aria-hidden /> New venue
          </Link>
        )}
      </div>
      {list.error ? (
        <Message kind="error">{list.error.message}</Message>
      ) : !list.data ? (
        <Loading what="Loading venues" />
      ) : list.data.venues.length === 0 ? (
        <Message>No venues yet. {me?.organiser ? <Link to="/v/new">Add the first hall</Link> : "An organiser adds them."}</Message>
      ) : (
        <div className="cards venue-cards">
          {list.data.venues.map((v) => (
            <VenueCard key={v.id} id={v.id} name={v.name} />
          ))}
        </div>
      )}
    </div>
  );
}

function VenueCard({ id, name }: { id: string; name: string }) {
  const v = useApi<{ doc: RcVenue }>(`/api/venues/${encodeURIComponent(id)}`);
  const doc = v.data?.doc;
  return (
    <article className="card">
      <Link to={`/v/${id}`} className="card-link" aria-label={name}>
        {doc ? <VenueThumb venue={doc} /> : <div className="venue-thumb" />}
      </Link>
      <div className="card-body">
        <div className="card-title">
          <h3>
            <Link to={`/v/${id}`}>{name}</Link>
          </h3>
        </div>
        {doc && (
          <dl className="card-stats">
            <div>
              <dt>Area</dt>
              <dd>{fmt.size(doc.area, true)}</dd>
            </div>
            <div>
              <dt>Rostrum</dt>
              <dd>{doc.rostrum?.side ?? "south"}</dd>
            </div>
            <div>
              <dt>Obstacles</dt>
              <dd>{doc.obstacles?.length ?? 0}</dd>
            </div>
          </dl>
        )}
      </div>
    </article>
  );
}

export function VenuePage() {
  const { id = "" } = useParams();
  const v = useApi<{ venue: VenueSummary; doc: RcVenue; can: { edit: boolean } }>(`/api/venues/${encodeURIComponent(id)}`);
  const revs = useApi<{ revisions: VenueRevision[] }>(`/api/venues/${encodeURIComponent(id)}/revisions`);
  const fitting = useApi<{ tracks: TrackSummary[] }>(`/api/tracks?fits=${encodeURIComponent(id)}`);
  if (v.error) return v.error instanceof ApiError && v.error.status === 404 ? <NotFound what="venue" /> : <div className="wrap page"><Message kind="error">{v.error.message}</Message></div>;
  if (!v.data) return <div className="wrap page"><Loading what="Loading venue" /></div>;
  const { doc, venue, can } = v.data;
  const side = doc.rostrum?.side ?? "south";
  const [rx, rz] = rostrumPos(doc.area, side, doc.rostrum?.offset);
  return (
    <div className="wrap page">
      <div className="track-head">
        <div>
          <p className="crumbs">
            <Link to="/v">Venues</Link> /
          </p>
          <h1>{doc.info.name}</h1>
          <p className="byline">
            {fmt.size(doc.area, true)} track area · revision {venue.revision} · updated {fmt.date(venue.updatedAt)} · {venue.tracks === 1 ? "1 track uses it" : `${venue.tracks} tracks use it`}
          </p>
        </div>
        {can.edit && (
          <Link to={`/v/${venue.id}/edit`} className="btn btn-primary ve-edit-btn">
            <Pencil size={16} aria-hidden /> Edit venue
          </Link>
        )}
      </div>
      {can.edit && (
        <p className="ve-narrow" role="note">
          <Monitor size={16} aria-hidden className="ve-narrow-icon" />
          <span>Editing a venue works on a laptop or tablet.</span>
        </p>
      )}
      <div className="track-grid">
        <div className="track-main">
          <PlanView area={doc.area} obstacles={doc.obstacles} rostrum={{ side, x: rx, z: rz }} label={`Plan of ${doc.info.name}`} className="track-plan venue-plan" />
        </div>
        <aside className="track-side">
          <section className="panel" aria-labelledby="vd-h">
            <h2 id="vd-h">Details</h2>
            <dl className="details">
              <dt>Track area</dt>
              <dd>
                {doc.area.length} m east–west × {doc.area.width} m north–south
              </dd>
              <dt>Rostrum</dt>
              <dd>
                {side[0].toUpperCase() + side.slice(1)} wall, {fmt.metres(toCorner(doc.area, side, doc.rostrum?.offset ?? 0))} from the {side === "north" || side === "south" ? "west" : "south"} corner
                {doc.rostrum?.offset ? "" : " (centred)"}
              </dd>
              {doc.info.venue?.id !== undefined && doc.info.venue !== null && (
                <>
                  <dt>Forum venue</dt>
                  <dd>
                    {doc.info.venue.name ? `${doc.info.venue.name} · ` : ""}ID {doc.info.venue.id}
                  </dd>
                </>
              )}
              {doc.info.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{doc.info.notes}</dd>
                </>
              )}
            </dl>
          </section>
          <section className="panel" aria-labelledby="vo-h">
            <h2 id="vo-h">
              Obstacles <span className="count-pill">{doc.obstacles?.length ?? 0}</span>
            </h2>
            {doc.obstacles?.length ? (
              <ul className="obstacles">
                {doc.obstacles.map((o, i) => (
                  <li key={i}>
                    <strong>{obstacleName(o)}</strong>
                    <span>
                      {o.type === "circle" ? `${fmt.metres(o.radius * 2)} across` : `${fmt.metres(o.length)} × ${fmt.metres(o.width)}${o.rotation ? `, turned ${o.rotation}°` : ""}`} at{" "}
                      {fmt.metres(o.x)}, {fmt.metres(o.z)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ok">None — the whole area is usable.</p>
            )}
          </section>
          <VenueRevisions id={venue.id} current={venue.revision} revs={revs.data?.revisions} error={revs.error} />
        </aside>
      </div>

      <section className="fitting" aria-labelledby="fit-h">
        <h2 id="fit-h">Approved layouts that fit</h2>
        {fitting.error ? (
          <Message kind="error">{fitting.error.message}</Message>
        ) : !fitting.data ? (
          <Loading what="Checking which layouts fit" />
        ) : fitting.data.tracks.length === 0 ? (
          <Message>No approved layout fits this venue yet.</Message>
        ) : (
          <div className="cards">
            {fitting.data.tracks.map((t) => (
              <TrackCard key={t.id} track={t} fitVenueId={id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Every saved revision, newest first. Tracks keep the revision they were drawn on. */
function VenueRevisions({ id, current, revs, error }: { id: string; current: number; revs?: VenueRevision[]; error?: Error }) {
  return (
    <section className="panel" aria-labelledby="vr-h">
      <h2 id="vr-h">
        Revisions <span className="count-pill">{current}</span>
      </h2>
      {error ? (
        <Message kind="error">{error.message}</Message>
      ) : !revs ? (
        <Loading what="Loading revisions" />
      ) : (
        <ol className="revisions" aria-label={`Revisions of venue ${id}`}>
          {revs.map((r) => (
            <li key={r.revision} className={r.revision === current ? "on" : undefined}>
              <span className="rev-btn">
                <span className="rev-n">r{r.revision}</span>
                <span className="rev-meta">
                  {fmt.date(r.createdAt)} · {fmt.author(r.createdBy)} · {fmt.size(r.area, true)} · {r.obstacles === 1 ? "1 obstacle" : `${r.obstacles} obstacles`}
                  {r.revision === current ? " · latest" : ""}
                </span>
              </span>
              <a className="btn btn-quiet btn-icon rev-dl" href={r.downloadUrl} aria-label={`Download revision ${r.revision}`} title={`Download revision ${r.revision} (.rcvenue.json)`}>
                <Download size={16} aria-hidden />
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
