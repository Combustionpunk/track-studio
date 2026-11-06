// The venue editor's "Forum venue" field (#65): search the forum's venues, pick one, then pick its track (picked for
// you when there's only one). Works without the forum: the saved link still shows and the template still saves.
import type { Area, ForumVenueRef } from "@track-studio/engine";
import { CircleAlert } from "lucide-react";
import { useId, useState } from "react";
import * as fmt from "../lib/format.js";
import { useApi } from "../lib/hooks.js";
import { areaDiffers, filterForumVenues, linkName, type ForumTrack, type ForumVenue, type ForumVenueList } from "./forum.js";

interface Props {
  value: ForumVenueRef | null;
  /** the template's area, compared with the forum track's size */
  area: Area;
  isNew: boolean;
  /** a venue (track null: still to pick) or a venue and its track */
  onPick: (venue: ForumVenue, track: ForumTrack | null) => void;
  onClear: () => void;
  error?: string;
}

const MAX_SHOWN = 50;

const trackSummary = (t: ForumTrack) =>
  [t.surface, t.environment, t.width_m && t.length_m ? `${fmt.metres(t.width_m)} × ${fmt.metres(t.length_m)}` : null].filter(Boolean).join(" · ");

const venueSummary = (v: ForumVenue) => [v.town, v.tracks.length === 1 ? "1 track" : `${v.tracks.length} tracks`].filter(Boolean).join(" · ");

export function ForumVenuePicker({ value, area, isNew, onPick, onClear, error }: Props) {
  const id = useId();
  const list = useApi<ForumVenueList>("/api/forum-venues");
  const [changing, setChanging] = useState(false);
  const venues = list.data?.venues;
  const current = value ? venues?.find((v) => v.id === value.id) : undefined;
  const track = current && value?.trackId !== undefined ? current.tracks.find((t) => t.id === value.trackId) : undefined;
  const searching = !value || changing;
  const differs = !searching && value?.trackId !== undefined ? areaDiffers(area, track) : null;

  const status = list.error ? (
    <p className="ve-help fv-status" role="status">
      <CircleAlert size={14} aria-hidden /> Forum unavailable: its venues can't be listed right now. The template still saves{value ? " with the link it has" : ""}; pick again later.
    </p>
  ) : list.data?.stale ? (
    <p className="ve-help fv-status" role="status">
      The forum isn't answering; this is its list from {fmt.dateTime(list.data.fetchedAt)}.
    </p>
  ) : null;

  const pick = (v: ForumVenue, t: ForumTrack | null) => {
    setChanging(false);
    onPick(v, t);
  };

  return (
    <div className="ve-field wide fv" role="group" aria-labelledby={`${id}-l`}>
      <span className="ve-label" id={`${id}-l`}>
        Forum venue <span className="ve-label-hint">and track</span>
      </span>

      {searching ? (
        <>
          {list.data ? (
            <VenueSearch id={id} venues={list.data.venues} onPick={(v) => pick(v, v.tracks.length === 1 ? v.tracks[0] : null)} />
          ) : !list.error ? (
            <p className="ve-help">Loading the forum's venues…</p>
          ) : null}
          {status}
          {changing && (
            <button type="button" className="linkish fv-act" onClick={() => setChanging(false)}>
              Keep {value ? linkName(value) || `forum venue ${value.id}` : "the current link"}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="fv-current">
            <span className="fv-name">
              {value!.trackId !== undefined ? linkName(value!) : value!.name || `Forum venue ${value!.id}`}
              {current?.town && <span className="fv-town"> · {current.town}</span>}
            </span>
            <span className="fv-acts">
              <button type="button" className="linkish" onClick={() => setChanging(true)} disabled={!list.data}>
                Change
              </button>
              <button type="button" className="linkish" onClick={onClear}>
                Unlink
              </button>
            </span>
          </div>
          {value!.trackId === undefined && (
            <div className="fv-tracks">
              <p className={`ve-help${error ? " error" : ""}`}>
                <strong>Pick the track</strong> at this venue
                {list.data && !current ? ": it isn't on the forum's list any more, so change the venue." : "."}
              </p>
              {current && (
                <ul className="fv-list" aria-label={`Tracks at ${current.name}`}>
                  {current.tracks.map((t) => (
                    <li key={t.id}>
                      <button type="button" className="fv-option" onClick={() => pick(current, t)}>
                        <span className="fv-option-name">{t.name}</span>
                        <span className="fv-option-sum">{trackSummary(t)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {differs && (
            <p className="ve-help fv-differs" role="status">
              {differs} That's fine if the track area is deliberately smaller than the hall.
            </p>
          )}
          {status}
        </>
      )}
      {isNew && !value && list.data && <span className="ve-help">Optional: link the template to the forum venue and track it's for.</span>}
    </div>
  );
}

/** A search box over the forum's venues (a combobox with an always-open list). */
function VenueSearch({ id, venues, onPick }: { id: string; venues: ForumVenue[]; onPick: (v: ForumVenue) => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const found = filterForumVenues(venues, q);
  const shown = found.slice(0, MAX_SHOWN);
  const at = Math.min(active, shown.length - 1);
  const optId = (i: number) => `${id}-o${i}`;
  return (
    <>
      <input
        type="search"
        className="ve-input"
        role="combobox"
        aria-label="Search the forum's venues"
        aria-expanded={shown.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown.length ? optId(at) : undefined}
        placeholder="Search by venue, town or track"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive(Math.min(at + 1, shown.length - 1));
          else if (e.key === "ArrowUp") setActive(Math.max(at - 1, 0));
          else if (e.key === "Enter" && shown[at]) onPick(shown[at]);
          else return;
          e.preventDefault();
        }}
      />
      <ul className="fv-list fv-scroll" role="listbox" id={`${id}-list`} aria-label="Forum venues">
        {shown.map((v, i) => (
          <li key={v.id} id={optId(i)} role="option" aria-selected={i === at} className={`fv-option${i === at ? " on" : ""}`} onClick={() => onPick(v)} onPointerMove={() => i !== at && setActive(i)}>
            <span className="fv-option-name">{v.name}</span>
            <span className="fv-option-sum">{venueSummary(v)}</span>
          </li>
        ))}
      </ul>
      {found.length === 0 && <p className="ve-help">{venues.length ? `No forum venue matches "${q.trim()}".` : "The forum has no approved venues yet."}</p>}
      {found.length > MAX_SHOWN && <p className="ve-help">Showing {MAX_SHOWN} of {found.length}: type to narrow it down.</p>}
    </>
  );
}
