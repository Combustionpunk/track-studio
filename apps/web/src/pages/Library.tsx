import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loading, Message } from "../components/bits.js";
import { TrackCard } from "../components/TrackCard.js";
import { qs, type TrackSummary, type VenueSummary } from "../lib/api.js";
import { useApi, useDebounced } from "../lib/hooks.js";

/** Filters live in the URL so a filtered library can be shared as a link. */
const KEYS = ["q", "status", "minLap", "maxLap", "minCorners", "maxCorners", "fits"] as const;
type Key = (typeof KEYS)[number];

export function Library() {
  const [params, setParams] = useSearchParams();
  const get = (k: Key) => params.get(k) ?? "";
  const set = (k: Key, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  // the search box updates the URL after a pause
  const [q, setQ] = useState(get("q"));
  const dq = useDebounced(q, 300);
  useEffect(() => {
    if (dq !== get("q")) set("q", dq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const fits = get("fits");
  const venues = useApi<{ venues: VenueSummary[] }>("/api/venues");
  const query = qs({
    q: get("q"),
    status: fits ? undefined : get("status"),
    minLap: get("minLap"),
    maxLap: get("maxLap"),
    minCorners: get("minCorners"),
    maxCorners: get("maxCorners"),
    fits,
  });
  const list = useApi<{ tracks: TrackSummary[] }>(`/api/tracks${query}`);
  const fitVenue = venues.data?.venues.find((v) => v.id === fits);
  const anyFilter = KEYS.some((k) => get(k));

  return (
    <div className="wrap page">
      <div className="page-head">
        <h1>Track library</h1>
        <p className="lede">Layouts designed by RC Misfits members. Pick a venue to see which approved layouts fit it.</p>
      </div>

      <form className="filters" onSubmit={(e) => e.preventDefault()} role="search" aria-label="Filter tracks">
        <label className="f-search">
          <span>Search</span>
          <input type="search" placeholder="Track name" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          <span>Status</span>
          <select value={fits ? "approved" : get("status")} onChange={(e) => set("status", e.target.value)} disabled={!!fits}>
            <option value="">Any (not archived)</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <fieldset>
          <legend>Lap (m)</legend>
          <input type="number" inputMode="numeric" min={0} placeholder="min" aria-label="Minimum lap length" value={get("minLap")} onChange={(e) => set("minLap", e.target.value)} />
          <span aria-hidden="true">–</span>
          <input type="number" inputMode="numeric" min={0} placeholder="max" aria-label="Maximum lap length" value={get("maxLap")} onChange={(e) => set("maxLap", e.target.value)} />
        </fieldset>
        <fieldset>
          <legend>Corners</legend>
          <input type="number" inputMode="numeric" min={0} placeholder="min" aria-label="Minimum corners" value={get("minCorners")} onChange={(e) => set("minCorners", e.target.value)} />
          <span aria-hidden="true">–</span>
          <input type="number" inputMode="numeric" min={0} placeholder="max" aria-label="Maximum corners" value={get("maxCorners")} onChange={(e) => set("maxCorners", e.target.value)} />
        </fieldset>
        <label className="f-fits">
          <span>Fits venue</span>
          <select value={fits} onChange={(e) => set("fits", e.target.value)}>
            <option value="">— any —</option>
            {venues.data?.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {anyFilter && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setQ("");
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Clear
          </button>
        )}
      </form>

      {fits && (
        <p className="fit-note">
          Approved layouts that fit <strong>{fitVenue?.name ?? fits}</strong>, with every orientation that works and the space left over. Pick one to
          preview it in the hall.
        </p>
      )}

      {list.error ? (
        <Message kind="error">{list.error.message}</Message>
      ) : !list.data ? (
        <Loading what={fits ? "Checking which layouts fit" : "Loading tracks"} />
      ) : list.data.tracks.length === 0 ? (
        <Message>{fits ? "No approved layout fits this venue yet." : anyFilter ? "No tracks match these filters." : "No tracks yet."}</Message>
      ) : (
        <>
          <p className="count" aria-live="polite">
            {list.data.tracks.length} {list.data.tracks.length === 1 ? "track" : "tracks"}
            {list.loading && " · updating…"}
          </p>
          <div className="cards">
            {list.data.tracks.map((t) => (
              <TrackCard key={t.id} track={t} fitVenueId={fits || undefined} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
