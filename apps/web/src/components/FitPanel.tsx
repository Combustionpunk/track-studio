// "Fit to a venue": pick a venue, see every orientation the track fits in, preview it in the hall, make a copy.
import type { Built, RcVenue } from "@track-studio/engine";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { post, type FitAnswer, type TrackResponse, type VenueSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi } from "../lib/hooks.js";
import { rostrumPos, transformBuilt } from "../lib/plan.js";
import { useSession } from "../lib/session.js";
import { PlanView } from "./PlanView.js";
import { EmptyState, ErrorAlert, Skeleton } from "./states.js";

export function FitPanel({ trackId, built, initialVenue, initialOrientation }: { trackId: string; built: Built; initialVenue?: string; initialOrientation?: string }) {
  const { me, loginUrl } = useSession();
  const navigate = useNavigate();
  const [venueId, setVenueId] = useState(initialVenue ?? "");
  const [orientation, setOrientation] = useState(initialOrientation ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const venues = useApi<{ venues: VenueSummary[] }>("/api/venues");
  const venue = useApi<{ doc: RcVenue }>(venueId ? `/api/venues/${encodeURIComponent(venueId)}` : null);
  const fit = useApi<FitAnswer>(venueId ? `/api/tracks/${trackId}/fit/${encodeURIComponent(venueId)}` : null);

  const results = fit.data?.results ?? [];
  const chosen = results.find((r) => r.orientation === orientation) ?? results[0];
  useEffect(() => {
    if (results.length && !results.some((r) => r.orientation === orientation)) setOrientation(results[0].orientation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.data]);

  const placed = useMemo(() => (chosen && venue.data ? transformBuilt(built, chosen) : undefined), [built, chosen, venue.data]);
  const v = venue.data?.doc;

  const makeCopy = async () => {
    if (!chosen || !v) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await post<TrackResponse>(`/api/tracks/${trackId}/adapt/${encodeURIComponent(v.id)}`, { orientation: chosen.orientation });
      navigate(`/t/${res.track.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const venueName = venues.data?.venues.find((x) => x.id === venueId)?.name ?? v?.info.name ?? "this venue";
  return (
    <section className="ts-panel ts-fit" id="fit-panel" aria-labelledby="fit-h">
      <h2 id="fit-h" className="ts-heading">
        Fit to a venue
      </h2>
      <div className="ts-field">
        <label className="ts-label" htmlFor="fit-venue">
          Venue
        </label>
        <select id="fit-venue" className="ts-input" value={venueId} onChange={(e) => setVenueId(e.target.value)} disabled={!venues.data}>
          <option value="">{venues.data ? "Choose a venue…" : venues.error ? "Venues unavailable" : "Loading venues…"}</option>
          {venues.data?.venues.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      {venues.error && (
        <ErrorAlert title="Couldn't load the venues." onRetry={venues.reload}>
          {venues.error.message}.
        </ErrorAlert>
      )}
      {venueId && (fit.loading || venue.loading) && !fit.error && !venue.error && (
        <div className="ts-fit__loading" aria-busy="true" aria-label={`Checking how it fits ${venueName}`}>
          <Skeleton className="ts-skeleton--line ts-skeleton--short" />
          <Skeleton className="ts-plan-well ts-skeleton--fit" />
        </div>
      )}
      {(fit.error || venue.error) && (
        <ErrorAlert
          title={`Couldn't check how it fits ${venueName}.`}
          onRetry={() => {
            fit.reload();
            venue.reload();
          }}
        >
          {(fit.error ?? venue.error)!.message}.
        </ErrorAlert>
      )}
      {fit.data && !fit.loading && results.length === 0 && (
        <EmptyState title={`Doesn't fit ${venueName}`}>No way round fits this hall, in any orientation. Try another venue, or make a smaller version in the designer.</EmptyState>
      )}
      {results.length > 0 && v && !fit.loading && (
        <>
          <fieldset className="ts-fieldset ts-fit__options">
            <legend className="ts-label">Fits as</legend>
            {results.map((r) => (
              <label key={r.orientation} className="ts-fit-chip">
                <input type="radio" name="orientation" value={r.orientation} checked={r === chosen} onChange={() => setOrientation(r.orientation)} />
                <span>{r.orientation}</span>
                <small>{fmt.spare(r)}</small>
              </label>
            ))}
          </fieldset>
          {placed && (
            <PlanView
              area={v.area}
              obstacles={v.obstacles}
              built={{ ...placed, rostrum: { ...placed.rostrum, ...xz(rostrumPos(v.area, v.rostrum?.side, v.rostrum?.offset)), side: v.rostrum?.side ?? "south" } }}
              layers={{ lanes: true, racingLine: true, dividers: true, features: true, start: true, checks: false, obstacles: true, grid: true, rostrum: true }}
              label={`${chosen.orientation} in ${v.info.name}`}
              className="ts-plan-well fit-plan"
            />
          )}
          <p className="ts-help">
            Preview: the copy is re-built for {v.info.name} ({fmt.size(v.area)} area), with its obstacles and rostrum.
          </p>
          {error && <ErrorAlert title="Couldn't make the copy.">{error}</ErrorAlert>}
          <div>
            {me ? (
              <button type="button" className="ts-btn" onClick={makeCopy} disabled={busy}>
                {busy ? "Making copy…" : `Make a copy for ${v.info.name}`}
              </button>
            ) : (
              <a className="ts-btn" href={loginUrl()}>
                Log in to make a copy
              </a>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const xz = ([x, z]: [number, number]) => ({ x, z });
