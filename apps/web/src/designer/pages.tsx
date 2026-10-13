// Routes into the designer: /new (choose a venue or a blank area), /new/design (a new track), /t/:id/edit.
import type { RcTrack, RcVenue } from "@track-studio/engine";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loading, Message, VenueThumb } from "../components/bits.js";
import { ApiError, post, type TrackResponse, type VenueSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi } from "../lib/hooks.js";
import { useSession } from "../lib/session.js";
import { NotFound } from "../pages/NotFound.js";
import { Designer, draftFromDoc, type Draft } from "./Designer.js";
import { starterDesign } from "./geometry.js";

export function NewTrackPage() {
  const navigate = useNavigate();
  const venues = useApi<{ venues: VenueSummary[] }>("/api/venues");
  const [name, setName] = useState("");
  const [length, setLength] = useState("22");
  const [width, setWidth] = useState("12");
  const blank = (e: FormEvent) => {
    e.preventDefault();
    const L = Number(length), W = Number(width);
    if (!(L >= 5 && L <= 100 && W >= 5 && W <= 100)) return;
    navigate(`/new/design?length=${L}&width=${W}${name.trim() ? `&name=${encodeURIComponent(name.trim())}` : ""}`);
  };
  return (
    <div className="wrap page">
      <div className="page-head">
        <h1>New track</h1>
        <p className="lede">Start from a venue template — its track area, rostrum and pillars are locked in — or from a blank area. Either way you get a simple loop to reshape.</p>
      </div>
      <h2 className="section-h">From a venue</h2>
      {venues.error ? (
        <Message kind="error">{venues.error.message}</Message>
      ) : !venues.data ? (
        <Loading />
      ) : (
        <div className="cards venue-cards">
          {venues.data.venues.map((v) => (
            <StartVenueCard key={v.id} id={v.id} name={v.name} />
          ))}
        </div>
      )}
      <h2 className="section-h">From a blank area</h2>
      <form className="panel blank-form" onSubmit={blank}>
        <label className="nfield">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New track" maxLength={80} />
        </label>
        <label className="nfield">
          <span>East–west (m)</span>
          <input type="number" min={5} max={100} step={0.5} value={length} onChange={(e) => setLength(e.target.value)} required />
        </label>
        <label className="nfield">
          <span>North–south (m)</span>
          <input type="number" min={5} max={100} step={0.5} value={width} onChange={(e) => setWidth(e.target.value)} required />
        </label>
        <button type="submit" className="btn btn-primary">
          Start drawing
        </button>
      </form>
    </div>
  );
}

function StartVenueCard({ id, name }: { id: string; name: string }) {
  const v = useApi<{ doc: RcVenue }>(`/api/venues/${encodeURIComponent(id)}`);
  const href = `/new/design?venue=${encodeURIComponent(id)}`;
  return (
    <article className="card">
      <Link to={href} className="card-link" aria-label={`Start from ${name}`}>
        {v.data ? <VenueThumb venue={v.data.doc} /> : <div className="venue-thumb" />}
      </Link>
      <div className="card-body">
        <div className="card-title">
          <h3>
            <Link to={href}>{name}</Link>
          </h3>
        </div>
        {v.data && (
          <p className="card-meta">
            {fmt.size(v.data.doc.area, true)} · rostrum {v.data.doc.rostrum?.side ?? "south"} · {v.data.doc.obstacles?.length ?? 0} obstacles
          </p>
        )}
        <Link to={href} className="btn btn-primary start-btn">
          Start here
        </Link>
      </div>
    </article>
  );
}

/** /new/design?venue=<id> or ?length=&width=[&name=] */
export function NewDesignPage() {
  const [params] = useSearchParams();
  const venueId = params.get("venue");
  const venue = useApi<{ venue: VenueSummary; doc: RcVenue }>(venueId ? `/api/venues/${encodeURIComponent(venueId)}` : null);
  const L = Number(params.get("length")) || 22, W = Number(params.get("width")) || 12;
  const name = params.get("name") || "New track";
  const initial = useMemo<Draft | null>(() => {
    if (venueId) {
      if (!venue.data) return null;
      const v = venue.data.doc;
      return {
        info: { name: venue.data && name === "New track" ? `New track at ${v.info.name}` : name },
        area: v.area,
        obstacles: v.obstacles ?? [],
        basedOn: { venueTemplate: v.id, revision: v.revision },
        design: { ...starterDesign(v.area, v.obstacles ?? []), rostrum: { side: "south", ...v.rostrum } },
      };
    }
    const area = { length: Math.min(100, Math.max(5, L)), width: Math.min(100, Math.max(5, W)) };
    return { info: { name }, area, obstacles: [], basedOn: null, design: { ...starterDesign(area), rostrum: { side: "south" } } };
  }, [venueId, venue.data, L, W, name]);

  if (venue.error) return venue.error instanceof ApiError && venue.error.status === 404 ? <NotFound what="venue" /> : <div className="wrap page"><Message kind="error">{venue.error.message}</Message></div>;
  if (!initial) return <div className="wrap page"><Loading what="Loading venue" /></div>;
  const key = venueId ? `designer:new:venue:${venueId}` : `designer:new:blank`;
  return <Designer key={key} mode="new" initial={initial} storageKey={key} fromVenue={venueId && venue.data ? { id: venueId, name: venue.data.doc.info.name } : undefined} />;
}

/** /t/:id/edit — the latest revision of a track you may edit; otherwise an offer to make your own copy. */
export function EditTrackPage() {
  const { id = "" } = useParams();
  const { me, ready, loginUrl } = useSession();
  const navigate = useNavigate();
  const tr = useApi<TrackResponse>(`/api/tracks/${encodeURIComponent(id)}`);
  const latest = tr.data?.track.revision;
  const doc = useApi<RcTrack>(latest ? `/api/tracks/${encodeURIComponent(id)}/r/${latest}` : null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string>();

  if (tr.error) return tr.error instanceof ApiError && tr.error.status === 404 ? <NotFound what="track" /> : <div className="wrap page"><Message kind="error">{tr.error.message}</Message></div>;
  if (!tr.data || !ready || (tr.data.can.edit && !doc.data)) return <div className="wrap page"><Loading what="Loading the designer" /></div>;
  const { track, can } = tr.data;

  if (!can.edit) {
    const copy = async () => {
      setCopying(true);
      try {
        const res = await post<TrackResponse>(`/api/tracks/${track.id}/copy`);
        navigate(`/t/${res.track.id}/edit`);
      } catch (e) {
        setError((e as Error).message);
        setCopying(false);
      }
    };
    return (
      <div className="wrap page narrow">
        <h1>{track.name}</h1>
        {track.status === "archived" ? (
          <p>This track is archived and can't be changed.</p>
        ) : (
          <p>Only {track.author.username} (the author) and organisers can change this track. You can make your own copy to work on — it stays credited to the original.</p>
        )}
        {error && <Message kind="error">{error}</Message>}
        <p className="row">
          {me ? (
            <button type="button" className="btn btn-primary" onClick={copy} disabled={copying}>
              {copying ? "Copying…" : "Make my own copy"}
            </button>
          ) : (
            <a className="btn btn-primary" href={loginUrl()}>
              Log in to make a copy
            </a>
          )}
          <Link className="btn" to={`/t/${track.id}`}>
            Back to the track
          </Link>
        </p>
      </div>
    );
  }
  const d = doc.data!;
  return (
    <Designer
      key={`${track.id}:${d.revision}`}
      mode="edit"
      initial={draftFromDoc(d)}
      base={{ id: track.id, revision: d.revision, doc: d, track, can }}
      storageKey={`designer:${track.id}`}
    />
  );
}
