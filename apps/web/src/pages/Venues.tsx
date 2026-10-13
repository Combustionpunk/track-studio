import type { RcVenue } from "@track-studio/engine";
import { Link, useParams } from "react-router-dom";
import { Loading, Message, VenueThumb } from "../components/bits.js";
import { PlanView } from "../components/PlanView.js";
import { TrackCard } from "../components/TrackCard.js";
import { ApiError, type TrackSummary, type VenueSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi } from "../lib/hooks.js";
import { rostrumPos } from "../lib/plan.js";
import { NotFound } from "./NotFound.js";

export function Venues() {
  const list = useApi<{ venues: VenueSummary[] }>("/api/venues");
  return (
    <div className="wrap page">
      <div className="page-head">
        <h1>Venues</h1>
        <p className="lede">Venue templates: each hall's usable track area, rostrum and fixed obstacles. Organisers will be able to edit them here soon.</p>
      </div>
      {list.error ? (
        <Message kind="error">{list.error.message}</Message>
      ) : !list.data ? (
        <Loading what="Loading venues" />
      ) : list.data.venues.length === 0 ? (
        <Message>No venues yet.</Message>
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
  const v = useApi<{ venue: VenueSummary; doc: RcVenue }>(`/api/venues/${encodeURIComponent(id)}`);
  const fitting = useApi<{ tracks: TrackSummary[] }>(`/api/tracks?fits=${encodeURIComponent(id)}`);
  if (v.error) return v.error instanceof ApiError && v.error.status === 404 ? <NotFound what="venue" /> : <div className="wrap page"><Message kind="error">{v.error.message}</Message></div>;
  if (!v.data) return <div className="wrap page"><Loading what="Loading venue" /></div>;
  const { doc, venue } = v.data;
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
            {fmt.size(doc.area, true)} track area · revision {venue.revision} · updated {fmt.date(venue.updatedAt)}
          </p>
        </div>
      </div>
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
                {side} side{doc.rostrum?.offset ? `, ${Math.abs(doc.rostrum.offset)} m ${offsetWord(side, doc.rostrum.offset)} of centre` : ", centred"}
              </dd>
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
                    <strong>{o.label || (o.type === "circle" ? "Obstacle" : "Keep-out area")}</strong>
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

/** Which way a positive offset runs along a side (offset is along x for north/south, along z for east/west). */
function offsetWord(side: string, offset: number) {
  if (side === "north" || side === "south") return offset > 0 ? "east" : "west";
  return offset > 0 ? "north" : "south";
}
