// "Check against venue" (#63): the fit check while drawing. A layout belongs to no venue (rctrack 1.7), so this tests
// the design as it stands against a venue template, in the browser: where it is drawn (obstacles hit, area left) and
// in which orientations it fits. Nothing of the venue goes into the design.
import { fits, venueCheck, type Check, type RcTrack, type RcVenue, type VenueCheck } from "@track-studio/engine";
import { CircleCheck, CircleX } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api, type VenueSummary } from "../lib/api.js";
import { useApi } from "../lib/hooks.js";

export interface VenueCheckResult {
  venue: { id: string; name: string };
  /** orientations it fits in, as fits() labels them; empty: it doesn't fit */
  fits: string[];
  /** the design where it is drawn, against the venue */
  asDrawn: VenueCheck;
}

/** Both checks for a design against a venue (the engine's fits and venueCheck; pure). */
export function checkAgainstVenue(design: RcTrack["design"], venue: RcVenue): VenueCheckResult {
  const track: RcTrack = { format: "rctrack", version: 1, id: "check", revision: 1, info: { name: "check" }, design };
  return { venue: { id: venue.id, name: venue.info.name }, fits: fits(track, venue).map((f) => f.orientation), asDrawn: venueCheck(track, venue) };
}

/** One line on whether it fits: "Fits Sports hall B as drawn.", "Fits Sports hall B rotated 180 or mirrored." … */
export function fitSummary(r: VenueCheckResult): string {
  if (!r.fits.length) return `Doesn't fit ${r.venue.name} in any orientation.`;
  if (r.fits.includes("as designed") && !r.asDrawn.checks.length) return `Fits ${r.venue.name} where it's drawn.`;
  const list = r.fits.length > 2 ? `${r.fits.slice(0, -1).join(", ")} or ${r.fits[r.fits.length - 1]}` : r.fits.join(" or ");
  return `Fits ${r.venue.name}: ${list}.`;
}

export function VenueCheckPanel({ design, drawnFor, onShow }: { design: RcTrack["design"]; drawnFor?: { venueTemplate: string }; onShow: (x: number, z: number) => void }) {
  const id = useId();
  const venues = useApi<{ venues: VenueSummary[] }>("/api/venues");
  const list = venues.data?.venues ?? [];
  const [chosen, setChosen] = useState<string>(drawnFor?.venueTemplate ?? "");
  const venueId = chosen || list[0]?.id || "";
  const [state, setState] = useState<{ result?: VenueCheckResult; of?: RcTrack["design"]; busy?: boolean; error?: string }>({});
  useEffect(() => {
    if (!chosen && drawnFor) setChosen(drawnFor.venueTemplate);
  }, [drawnFor, chosen]);

  const run = async () => {
    setState({ busy: true });
    try {
      const { doc } = await api<{ doc: RcVenue }>(`/api/venues/${encodeURIComponent(venueId)}`);
      // the fit search takes a moment on a big hall: let "Checking…" show first
      await new Promise((r) => setTimeout(r, 0));
      setState({ result: checkAgainstVenue(design, doc), of: design });
    } catch (e) {
      setState({ error: (e as Error).message });
    }
  };
  const { result, busy, error } = state;
  const stale = !!result && state.of !== design;

  if (venues.error || (venues.data && !list.length)) return null;
  return (
    <section className="checks-panel venue-check" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Check against a venue</h2>
      <div className="venue-check-row">
        <label className="nfield">
          <span>Venue</span>
          <select value={venueId} onChange={(e) => setChosen(e.target.value)} disabled={!list.length}>
            {list.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={run} disabled={busy || !venueId || design.points.length < 3}>
          {busy ? "Checking…" : result && !stale && result.venue.id === venueId ? "Check again" : "Check"}
        </button>
      </div>
      {error && <p className="hint lvl-error">{error}</p>}
      {result && (
        <div aria-live="polite" className={stale ? "venue-check-stale" : undefined}>
          <ul className="checks">
            <li className={`check ${result.fits.length ? "check-ok" : "check-error"}`}>
              {result.fits.length ? <CircleCheck size={16} aria-hidden="true" /> : <CircleX size={16} aria-label="Error" />}
              <span>{fitSummary(result)}</span>
            </li>
            {result.asDrawn.checks.map((c: Check, i) => (
              <li key={i} className={`check check-${c.level}`}>
                <CircleX size={16} aria-label="Error" />
                <span>Where it's drawn: {c.message.toLowerCase().replace(/^track/, "the track")}.</span>
                {c.x !== undefined && c.z !== undefined && (
                  <button type="button" className="check-show" onClick={() => onShow(c.x!, c.z!)}>
                    Show
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">
            Rostrum on the {result.asDrawn.rostrum.side} side.{stale && " The track has changed since: check again."}
          </p>
        </div>
      )}
    </section>
  );
}
