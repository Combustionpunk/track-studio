// Linking a venue template to the forum (#65): one forum venue and one of its tracks, picked from the forum's list
// (GET /api/forum-venues). Pure, so it can be tested without a browser. Forum sizes are metres: length_m east–west
// (the template's area.length), width_m north–south (area.width).
import type { Area } from "@track-studio/engine";
import { blankVenue, type VenueDraft } from "./model.js";

export interface ForumTrack {
  id: number;
  name: string;
  surface?: string | null;
  environment?: string | null;
  width_m?: number | null;
  length_m?: number | null;
}

export interface ForumVenue {
  id: number;
  name: string;
  town?: string | null;
  tracks: ForumTrack[];
}

/** GET /api/forum-venues */
export interface ForumVenueList {
  venues: ForumVenue[];
  fetchedAt: string;
  /** the forum didn't answer just now: this is the server's last copy */
  stale: boolean;
}

type Link = NonNullable<VenueDraft["info"]["venue"]>;

/** The venue's track when it has only one (picked for you). */
export const onlyTrack = (v: ForumVenue): ForumTrack | null => (v.tracks.length === 1 ? v.tracks[0] : null);

/** "<venue> – <track>", or the venue's name before a track is picked. */
export const linkName = (l: Pick<Link, "name" | "trackName">) => [l.name, l.trackName].filter(Boolean).join(" – ");

/** The template name follows the link while it's empty or still the name a pick gave it. */
function nameAfter(d: VenueDraft, next: Link): string {
  const prev = d.info.venue;
  const cur = d.info.name.trim();
  return !cur || (prev && cur === linkName(prev)) ? linkName(next) : d.info.name;
}

const sized = (a: Area) => Number.isFinite(a.length) && a.length > 0 && Number.isFinite(a.width) && a.width > 0;

/** An area nobody has drawn yet: not a size, or a new template still on the blank one. */
function areaIsEmpty(d: VenueDraft, isNew: boolean): boolean {
  const blank = blankVenue().area;
  return !sized(d.area) || (isNew && d.area.length === blank.length && d.area.width === blank.width);
}

function link(d: VenueDraft, venue: ForumVenue, track: ForumTrack | null, opts: { isNew: boolean }): VenueDraft {
  const next: Link = track ? { id: venue.id, name: venue.name, trackId: track.id, trackName: track.name } : { id: venue.id, name: venue.name };
  const fill = track?.length_m && track.width_m && areaIsEmpty(d, opts.isNew) ? { length: track.length_m, width: track.width_m } : d.area;
  return { ...d, info: { ...d.info, name: nameAfter(d, next), venue: next }, area: fill };
}

/** Pick a forum venue: its track too if it has only one, else the track is still to pick. */
export const pickForumVenue = (d: VenueDraft, venue: ForumVenue, opts: { isNew: boolean }) => link(d, venue, onlyTrack(venue), opts);

/** Pick a forum venue and track. Fills an empty area from the forum's numbers; a drawn area stays as it is. */
export const pickForumTrack = (d: VenueDraft, venue: ForumVenue, track: ForumTrack, opts: { isNew: boolean }) => link(d, venue, track, opts);

const num = (v: number) => String(Math.round(v * 100) / 100);

/** "Differs from the forum (W × L m)." when the forum track has a size and the area isn't it; else null. */
export function areaDiffers(area: Area, track: ForumTrack | null | undefined): string | null {
  if (!track?.width_m || !track.length_m) return null;
  const same = Math.abs(area.length - track.length_m) < 0.005 && Math.abs(area.width - track.width_m) < 0.005;
  return same ? null : `Differs from the forum (${num(track.width_m)} × ${num(track.length_m)} m).`;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Venues whose name, town or a track's name contains `q` (case and accents ignored). */
export function filterForumVenues(venues: ForumVenue[], q: string): ForumVenue[] {
  const needle = fold(q.trim());
  if (!needle) return venues;
  return venues.filter((v) => [v.name, v.town ?? "", ...v.tracks.map((t) => t.name)].some((s) => fold(s).includes(needle)));
}

/** The forum's page for a venue. */
export const forumVenueUrl = (forumUrl: string, id: number) => `${forumUrl.replace(/\/+$/, "")}/venues/${id}`;
