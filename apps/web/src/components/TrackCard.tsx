import { useState } from "react";
import { Link } from "react-router-dom";
import * as fmt from "../lib/format.js";
import type { TrackSummary } from "../lib/api.js";
import { StatusBadge } from "./bits.js";

/** Library card. In "fits venue" mode (`fitVenueId`) it lists how the track fits and links to the fit preview. */
export function TrackCard({ track, fitVenueId }: { track: TrackSummary; fitVenueId?: string }) {
  const href = fitVenueId ? `/t/${track.id}?fit=${encodeURIComponent(fitVenueId)}` : `/t/${track.id}`;
  // in "fits venue" mode the picture shows the layout placed in the venue, as the hovered / first orientation fits
  const [shown, setShown] = useState(0);
  const fitShown = track.fit?.results[shown] ?? track.fit?.results[0];
  const preview = fitShown?.thumbUrl ?? track.previewUrl;
  const aspect = fitShown ? undefined : `${track.area.length + 5} / ${track.area.width + 5}`;
  return (
    <article className="card">
      <Link to={href} className="card-link" aria-label={`${track.name}, ${fmt.lap(track.lapLength)} lap`}>
        <img src={preview} alt="" loading="lazy" decoding="async" style={{ aspectRatio: aspect }} className="card-img" />
      </Link>
      <div className="card-body">
        <div className="card-title">
          <h3>
            <Link to={href}>{track.name}</Link>
          </h3>
          {track.approvedRevision !== null && track.status !== "archived" ? <StatusBadge status="approved" /> : <StatusBadge status={track.status} />}
        </div>
        {track.newerRevision && (
          <p className="card-note">
            Revision {track.newerRevision.revision} {track.newerRevision.status === "submitted" ? "submitted for approval" : "in progress"}
          </p>
        )}
        <dl className="card-stats">
          <div>
            <dt>Lap</dt>
            <dd>{fmt.lap(track.lapLength)}</dd>
          </div>
          <div>
            <dt>Corners</dt>
            <dd>{track.corners}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{fmt.size(track.size)}</dd>
          </div>
        </dl>
        <p className="card-meta">
          {track.venue ? <Link to={`/v/${track.venue.id}`}>{track.venue.name ?? track.venue.id}</Link> : <span>No venue</span>}
          <span aria-hidden="true"> · </span>
          <span>by {track.author.username}</span>
        </p>
        {track.fit && (
          <ul className="fit-chips" aria-label="Fits as">
            {track.fit.results.map((r, i) => (
              <li key={r.orientation}>
                <Link
                  to={`${href}&o=${encodeURIComponent(r.orientation)}`}
                  className={`chip ${i === shown ? "on" : ""}`}
                  title={fmt.spare(r)}
                  onMouseEnter={() => setShown(i)}
                  onFocus={() => setShown(i)}
                >
                  {r.orientation}
                  <small>{fmt.spare(r)}</small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
