// "Fit to a venue": pick a venue, see every orientation the track fits in, preview it in the hall, make a copy.
import type { Built, RcVenue } from "@track-studio/engine";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { post, type FitAnswer, type TrackResponse, type VenueSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi } from "../lib/hooks.js";
import { rostrumPos, transformBuilt } from "../lib/plan.js";
import { useSession } from "../lib/session.js";
import { Loading, Message } from "./bits.js";
import { PlanView } from "./PlanView.js";

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

  return (
    <section className="panel fit-panel" aria-labelledby="fit-h">
      <h2 id="fit-h">Fit to a venue</h2>
      <label className="field">
        <span>Venue</span>
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">Choose a venue…</option>
          {venues.data?.venues.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {venueId && (fit.loading || venue.loading) && <Loading what="Searching" />}
      {fit.error && <Message kind="error">{fit.error.message}</Message>}
      {fit.data && !fit.loading && results.length === 0 && <Message>Doesn't fit this venue in any orientation.</Message>}
      {results.length > 0 && v && (
        <>
          <fieldset className="fit-options">
            <legend>Fits as</legend>
            {results.map((r) => (
              <label key={r.orientation} className={r === chosen ? "on" : ""}>
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
              className="fit-plan"
            />
          )}
          <p className="hint">
            Preview: the copy is re-built for {v.info.name} ({fmt.size(v.area)} area), with its obstacles and rostrum.
          </p>
          {error && <Message kind="error">{error}</Message>}
          {me ? (
            <button type="button" className="btn btn-primary" onClick={makeCopy} disabled={busy}>
              {busy ? "Making copy…" : `Make a copy for ${v.info.name}`}
            </button>
          ) : (
            <a className="btn" href={loginUrl()}>
              Log in to make a copy
            </a>
          )}
        </>
      )}
    </section>
  );
}

const xz = ([x, z]: [number, number]) => ({ x, z });
