import { useState } from "react";
import { Link } from "react-router-dom";
import * as fmt from "../lib/format.js";
import type { TrackSummary } from "../lib/api.js";
import { StatusBadge } from "./bits.js";

/**
 * Library card: plan, name, status, meta and three figures. The name's link covers the whole card. In "fits venue"
 * mode (`fitVenueId`) it also lists how the track fits, each linking to the fit preview.
 */
export function TrackCard({ track, fitVenueId }: { track: TrackSummary; fitVenueId?: string }) {
  const href = fitVenueId ? `/t/${track.id}?fit=${encodeURIComponent(fitVenueId)}` : `/t/${track.id}`;
  // in "fits venue" mode the picture shows the layout placed in the venue, as the hovered / first orientation fits
  const [shown, setShown] = useState(0);
  const fitShown = track.fit?.results[shown] ?? track.fit?.results[0];
  const preview = fitShown?.thumbUrl ?? track.previewUrl;
  const status = track.approvedRevision !== null && track.status !== "archived" ? "approved" : track.status;
  return (
    <article className="ts-card">
      <div className="ts-card__plan">
        <img src={preview} alt="" loading="lazy" decoding="async" />
      </div>
      <div className="ts-card__body">
        <div className="ts-card__top">
          <h2 className="ts-card__name">
            <Link to={href} className="ts-card__link">
              {track.name}
            </Link>
          </h2>
          <StatusBadge status={status} />
        </div>
        <p className="ts-card__meta">
          by {track.author.username} · {track.venue ? (track.venue.name ?? track.venue.id) : "No venue"} · revision {track.publicRevision}
        </p>
        {track.newerRevision && (
          <p className="ts-card__note">
            Revision {track.newerRevision.revision} {track.newerRevision.status === "submitted" ? "submitted for approval" : "in progress"}
          </p>
        )}
        <dl className="ts-figures">
          <div className="ts-figure">
            <dt className="ts-figure__l">Lap</dt>
            <dd className="ts-figure__v">{fmt.lap(track.lapLength)}</dd>
          </div>
          <div className="ts-figure">
            <dt className="ts-figure__l">Corners</dt>
            <dd className="ts-figure__v">{track.corners}</dd>
          </div>
          <div className="ts-figure">
            <dt className="ts-figure__l">Size</dt>
            <dd className="ts-figure__v">{fmt.size(track.size)}</dd>
          </div>
        </dl>
        {track.fit && (
          <ul className="ts-fits" aria-label="Fits as">
            {track.fit.results.map((r, i) => (
              <li key={r.orientation}>
                <Link
                  to={`${href}&o=${encodeURIComponent(r.orientation)}`}
                  className="ts-fit-chip"
                  aria-current={i === shown ? "true" : undefined}
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
