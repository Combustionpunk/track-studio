// #190: the forum is the source of a linked venue template's surface. A template linked to a forum venue track is
// served with that track's surface (in the format's words, forum-venues.ts templateSurface), never one of its own, and
// saves don't store one. The forum's list is cached for 10 minutes; while the forum is down the last copy is used, and
// with none the template has no surface ("Not given"). Unlinked templates, and old ones linked to a venue but no track,
// keep the surface they were saved with.
import type { RcVenue, VenueSurface } from "@track-studio/engine";
import { HttpError } from "./errors.js";
import type { ForumVenues } from "./forum-venues.js";

/** What the forum says about a linked template's track; `known: false` when the forum can't say or no longer lists it. */
export interface ForumTrackFacts {
  known: boolean;
  /** the forum's own word (e.g. "carpet", "grass") */
  surface: string | null;
  environment: string | null;
  /** the forum didn't answer just now: this is from its last list */
  stale: boolean;
}

const UNKNOWN: ForumTrackFacts = { known: false, surface: null, environment: null, stale: false };

/** Does this template take its surface from the forum? (It names a forum track.) */
export const surfaceFromForum = (doc: { info?: { venue?: { trackId?: unknown } | null } }) => Number.isInteger(doc.info?.venue?.trackId);

/** The template as served: a linked one with the forum's surface, and what the forum said (null: not linked). */
export async function withForumSurface(doc: RcVenue, forumVenues: ForumVenues): Promise<{ doc: RcVenue; forumTrack: ForumTrackFacts | null }> {
  if (!surfaceFromForum(doc)) return { doc, forumTrack: null };
  const { id, trackId } = doc.info.venue!;
  let forumTrack = UNKNOWN;
  let surface: VenueSurface | null = null;
  try {
    const list = await forumVenues.list();
    const track = list.venues.find((v) => v.id === id)?.tracks.find((t) => t.id === trackId);
    if (track) {
      forumTrack = { known: true, surface: track.surface, environment: track.environment, stale: list.stale };
      surface = track.templateSurface;
    }
  } catch (e) {
    if (!(e instanceof HttpError && e.code === "forum-unavailable")) throw e;
  }
  const { surface: _own, ...rest } = doc;
  return { doc: surface ? { ...rest, surface } : rest, forumTrack };
}

/** A save of a linked template: drop the surface it sends (the forum's is served instead). Changes the body in place. */
export function dropLinkedSurface(venue: Record<string, unknown>): void {
  if (surfaceFromForum(venue as { info?: { venue?: { trackId?: unknown } } })) delete venue.surface;
}
