// The library's list: cards, or the loading, empty and error states.
import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import type { TrackSummary } from "../lib/api.js";
import type { Loadable } from "../lib/hooks.js";
import { CardGridSkeleton, EmptyState, ErrorAlert } from "./states.js";
import { TrackCard } from "./TrackCard.js";

interface Props {
  list: Loadable<{ tracks: TrackSummary[] }>;
  /** "fits my venue": the venue id, and its name once known */
  fits?: string;
  fitVenueName?: string;
  /** "Mine": only the signed-in member's tracks */
  mine?: boolean;
  /** any filter other than Mine */
  anyFilter: boolean;
  onClear: () => void;
}

const newTrack = (label: string) => (
  <Link to="/new" className="ts-btn">
    <Plus size={16} aria-hidden />
    {label}
  </Link>
);

export function LibraryResults({ list, fits, fitVenueName, mine, anyFilter, onClear }: Props) {
  if (list.error)
    return (
      <ErrorAlert title={fits ? "Couldn't check which tracks fit." : "Couldn't load the tracks."} onRetry={list.reload}>
        {list.error.message}. Check your connection and try again in a moment.
      </ErrorAlert>
    );
  if (!list.data) return <CardGridSkeleton label={fits ? "Checking which tracks fit" : "Loading tracks"} />;
  const { tracks } = list.data;
  if (tracks.length === 0) {
    if (fits)
      return (
        <EmptyState title={`No tracks fit ${fitVenueName ?? "this venue"} yet`} action={newTrack("Draw one")}>
          Draw one and be the first. Approved tracks that fit, in any orientation, show up here.
        </EmptyState>
      );
    // Mine is the only filter on: nothing of theirs to narrow down, so invite them to start one
    if (mine && !anyFilter)
      return (
        <EmptyState title="Nothing of yours here yet" action={newTrack("Start a design")}>
          Your drafts, submissions and approved tracks show up here (archived ones under Archived). Grab the carpet and some pipes.
        </EmptyState>
      );
    if (anyFilter)
      return (
        <EmptyState
          title="No tracks match these filters"
          action={
            <button type="button" className="ts-btn" onClick={onClear}>
              Clear filters
            </button>
          }
        >
          Try a wider lap or corner range, or another status.
        </EmptyState>
      );
    return (
      <EmptyState title="No tracks yet" action={newTrack("Draw the first track")}>
        The carpet's down and the pipes are stacked. Someone has to go first.
      </EmptyState>
    );
  }
  return (
    <div className="ts-cards" aria-busy={list.loading || undefined}>
      {tracks.map((t) => (
        <TrackCard key={t.id} track={t} fitVenueId={fits || undefined} />
      ))}
    </div>
  );
}
