// Routes into the designer: /new (from a venue or start blank), /new/design (a new track), /t/:id/edit.
import type { RcTrack, RcVenue } from "@track-studio/engine";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loading, Message, VenueThumb } from "../components/bits.js";
import { ApiError, post, type TrackResponse, type VenueSummary } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi } from "../lib/hooks.js";
import { useSession } from "../lib/session.js";
import { NotFound } from "../pages/NotFound.js";
import { Designer, draftFromDoc, type Draft } from "./Designer.js";
import { BLANK_MAX, BLANK_MIN, blankArea, blankDraft, blankHref, blankProblems, venueDraft } from "./start.js";

export function NewTrackPage() {
  const venues = useApi<{ venues: VenueSummary[] }>("/api/venues");
  return (
    <div className="wrap page">
      <div className="page-head">
        <h1>New track</h1>
        <p className="lede">Start from a venue template — its track area, rostrum and pillars are locked in — or start blank on an area you set. Either way you start by laying the lanes on a grid.</p>
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
      <h2 className="section-h">Start blank</h2>
      <BlankStartForm />
    </div>
  );
}

/** Start blank: a name and the track area's length × width. Problems show under each field after the first try. */
export function BlankStartForm({ initial = { name: "", length: "22", width: "12", tried: false } }: { initial?: { name: string; length: string; width: string; tried: boolean } }) {
  const navigate = useNavigate();
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [size, setSize] = useState({ length: initial.length, width: initial.width });
  const [tried, setTried] = useState(initial.tried);
  const problems = tried ? blankProblems(size) : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(blankProblems(size)).length) return;
    navigate(blankHref({ name, length: Number(size.length), width: Number(size.width) }));
  };
  return (
    <form className="panel blank-form" onSubmit={submit} noValidate>
      <p className="ts-help blank-help">
        No venue, no obstacles: just the track area, {BLANK_MIN}–{BLANK_MAX} m each way.
      </p>
      <div className="ts-field blank-name">
        <label className="ts-label" htmlFor={`${id}-name`}>
          Name
        </label>
        <input id={`${id}-name`} className="ts-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New track" maxLength={80} />
      </div>
      {(["length", "width"] as const).map((k) => (
        <div className="ts-field" key={k}>
          <label className="ts-label" htmlFor={`${id}-${k}`}>
            {k === "length" ? "Length" : "Width"} <span className="blank-hint">{k === "length" ? "east–west" : "north–south"}</span>
          </label>
          <span className="ts-unit">
            <input
              id={`${id}-${k}`}
              className={`ts-input${problems[k] ? " ts-input--invalid" : ""}`}
              inputMode="decimal"
              value={size[k]}
              aria-invalid={problems[k] ? true : undefined}
              aria-describedby={problems[k] ? `${id}-${k}-e` : undefined}
              onChange={(e) => setSize((s) => ({ ...s, [k]: e.target.value }))}
            />
            m
          </span>
          {problems[k] && (
            <p id={`${id}-${k}-e`} className="ts-help ts-help--error">
              {problems[k]}
            </p>
          )}
        </div>
      ))}
      <button type="submit" className="btn btn-primary blank-go">
        Start drawing
      </button>
    </form>
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
  const area = blankArea(params);
  const name = params.get("name") || "";
  const initial = useMemo<Draft | null>(() => {
    if (venueId) return venue.data ? venueDraft(venue.data.doc, name) : null;
    return blankDraft(area, name || undefined);
  }, [venueId, venue.data, area.length, area.width, name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (venue.error) return venue.error instanceof ApiError && venue.error.status === 404 ? <NotFound what="venue" /> : <div className="wrap page"><Message kind="error">{venue.error.message}</Message></div>;
  if (!initial) return <div className="wrap page"><Loading what="Loading venue" /></div>;
  // one kept draft per venue, and per blank area (a new 40 × 30 m blank isn't offered an old 22 × 12 m one)
  const key = venueId ? `designer:new:venue:${venueId}` : `designer:new:blank:${area.length}x${area.width}`;
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
          <p>Only {track.author.username !== null ? `${track.author.username} (the author)` : "the author"} and organisers can change this track. You can make your own copy to work on — it stays credited to the original.</p>
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
