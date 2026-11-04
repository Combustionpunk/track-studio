import { Plus, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LibraryResults } from "../components/LibraryResults.js";
import { qs, type TrackStatus, type TrackSummary, type VenueSummary } from "../lib/api.js";
import { STATUS_LABEL } from "../lib/format.js";
import { useApi, useDebounced } from "../lib/hooks.js";
import { useSession } from "../lib/session.js";

/** Filters live in the URL so a filtered library can be shared as a link. */
const KEYS = ["q", "venue", "status", "minLap", "maxLap", "minCorners", "maxCorners", "fits", "mine"] as const;
type Key = (typeof KEYS)[number];
const STATUSES: TrackStatus[] = ["approved", "submitted", "draft", "archived"];

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

export function Library() {
  const [params, setParams] = useSearchParams();
  const { me, ready } = useSession();
  // "Mine" needs a member: signed out, a shared ?mine=1 link is ignored
  const get = (k: Key) => (k === "mine" && !me ? "" : (params.get(k) ?? ""));
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
  // phones: the filters other than search fold away behind a button
  const [open, setOpen] = useState(false);

  const fits = get("fits");
  const venues = useApi<{ venues: VenueSummary[] }>("/api/venues");
  const query = qs({
    q: get("q"),
    venue: get("venue"),
    status: fits ? undefined : get("status"),
    minLap: get("minLap"),
    maxLap: get("maxLap"),
    minCorners: get("minCorners"),
    maxCorners: get("maxCorners"),
    fits,
    author: get("mine") ? "me" : undefined,
  });
  // wait for the session before honouring ?mine=1, rather than flash every track
  const list = useApi<{ tracks: TrackSummary[] }>(ready || !params.get("mine") ? `/api/tracks${query}` : null);
  const fitVenue = venues.data?.venues.find((v) => v.id === fits);
  const anyFilter = KEYS.some((k) => get(k));
  const folded = KEYS.filter((k) => k !== "q" && get(k)).length;
  const clear = () => {
    setQ("");
    setParams(new URLSearchParams(), { replace: true });
  };
  const venueOptions = (none: string) => (
    <>
      <option value="">{venues.data ? none : venues.error ? "Venues unavailable" : "Loading venues…"}</option>
      {venues.data?.venues.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </>
  );

  return (
    <div className="ts-page">
      <div className="ts-page-head">
        <div>
          <h1 className="ts-title">Track library</h1>
          <p className="ts-page-head__sub" aria-live="polite">
            {list.data ? plural(list.data.tracks.length, "track") : "Counting tracks"}
            {venues.data && ` · ${plural(venues.data.venues.length, "venue")}`}
            {list.data && list.loading && " · updating…"}
          </p>
        </div>
        <Link to="/new" className="ts-btn ts-btn--primary">
          <Plus size={16} aria-hidden />
          New track
        </Link>
      </div>

      <form className="ts-filters" onSubmit={(e) => e.preventDefault()} role="search" aria-label="Filter tracks" data-open={open || undefined}>
        <div className="ts-field ts-filters__search">
          <label className="ts-label" htmlFor="f-q">
            Search
          </label>
          <div className="ts-filters__searchrow">
            <input id="f-q" className="ts-input" type="search" placeholder="Track name" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="ts-btn ts-btn--touch ts-filters__toggle" aria-expanded={open} aria-controls="f-more" onClick={() => setOpen((o) => !o)}>
              <SlidersHorizontal size={16} aria-hidden />
              Filters{folded ? ` · ${folded}` : ""}
            </button>
          </div>
        </div>
        <div className="ts-filters__more" id="f-more">
          <div className="ts-field">
            <label className="ts-label" htmlFor="f-venue">
              Venue
            </label>
            <select id="f-venue" className="ts-input" value={get("venue")} onChange={(e) => set("venue", e.target.value)} disabled={!venues.data}>
              {venueOptions("All venues")}
            </select>
          </div>
          <div className="ts-field">
            <label className="ts-label" htmlFor="f-fits">
              Fits my venue
            </label>
            <select id="f-fits" className="ts-input" value={fits} onChange={(e) => set("fits", e.target.value)} disabled={!venues.data}>
              {venueOptions("Any size")}
            </select>
          </div>
          <fieldset className="ts-field ts-fieldset">
            <legend className="ts-label">Status</legend>
            <div className="ts-toggles">
              {STATUSES.map((s) => {
                const on = fits ? s === "approved" : get("status") === s;
                return (
                  <button key={s} type="button" className="ts-btn" aria-pressed={on} disabled={!!fits} onClick={() => set("status", on ? "" : s)}>
                    {STATUS_LABEL[s]}
                  </button>
                );
              })}
              {me && (
                <button type="button" className="ts-btn" aria-pressed={!!get("mine")} onClick={() => set("mine", get("mine") ? "" : "1")}>
                  Mine
                </button>
              )}
            </div>
          </fieldset>
          <fieldset className="ts-field ts-fieldset">
            <legend className="ts-label">Lap (m)</legend>
            <div className="ts-range">
              <input className="ts-input" type="number" inputMode="numeric" min={0} placeholder="min" aria-label="Minimum lap length in metres" value={get("minLap")} onChange={(e) => set("minLap", e.target.value)} />
              <span aria-hidden="true">–</span>
              <input className="ts-input" type="number" inputMode="numeric" min={0} placeholder="max" aria-label="Maximum lap length in metres" value={get("maxLap")} onChange={(e) => set("maxLap", e.target.value)} />
            </div>
          </fieldset>
          <fieldset className="ts-field ts-fieldset">
            <legend className="ts-label">Corners</legend>
            <div className="ts-range">
              <input className="ts-input" type="number" inputMode="numeric" min={0} placeholder="min" aria-label="Minimum corners" value={get("minCorners")} onChange={(e) => set("minCorners", e.target.value)} />
              <span aria-hidden="true">–</span>
              <input className="ts-input" type="number" inputMode="numeric" min={0} placeholder="max" aria-label="Maximum corners" value={get("maxCorners")} onChange={(e) => set("maxCorners", e.target.value)} />
            </div>
          </fieldset>
          {anyFilter && (
            <button type="button" className="ts-btn ts-btn--quiet" onClick={clear}>
              <X size={16} aria-hidden />
              Clear filters
            </button>
          )}
        </div>
        {venues.error && <p className="ts-help ts-help--error ts-filters__note">Couldn't load the venues, so the venue filters are off. Reload the page to try again.</p>}
        {fits && (
          <p className="ts-help ts-filters__note">
            Approved tracks that fit <strong>{fitVenue?.name ?? fits}</strong>, with every orientation that works and the space left over. Pick one to preview it in the hall.
          </p>
        )}
      </form>

      <LibraryResults list={list} fits={fits || undefined} fitVenueName={fitVenue?.name} mine={!!get("mine")} anyFilter={KEYS.some((k) => k !== "mine" && get(k))} onClear={clear} />
    </div>
  );
}
