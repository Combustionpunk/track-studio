// Where a layout has been used: the forum owns events, and each event stores the layout's id. The forum plugin's
// GET /des/layouts/:layoutId/events lists the published, sold-out and completed ones (#66). Nothing is stored here;
// answers are cached (forum-cache.ts).

import { forumLink, isObject, ForumLayoutCache, type ForumCacheOptions } from "./forum-cache.js";


export interface ForumEvent {
  id: number;
  title: string;
  /** as the forum sends it (ISO date or date-time) */
  startDate: string;
  /** the event on the forum; null if the forum sent something that isn't an http(s) link */
  url: string | null;
  venue: { id: number; name: string } | null;
  venueTrack: { id: number; name: string } | null;
}

export interface UsedAt {
  /** newest first */
  events: ForumEvent[];
  /** distinct venues, most recently used first */
  venues: { id: number; name: string }[];
}

export type ForumEventsOptions = ForumCacheOptions;

const ref = (v: unknown) => (isObject(v) && typeof v.id === "number" && typeof v.name === "string" ? { id: v.id, name: v.name } : null);

function parse(body: unknown, forumUrl: string): ForumEvent[] | null {
  if (!isObject(body) || !Array.isArray(body.events)) return null;
  const events: ForumEvent[] = [];
  for (const e of body.events) {
    if (!isObject(e) || typeof e.id !== "number" || typeof e.title !== "string") continue;
    events.push({ id: e.id, title: e.title, startDate: typeof e.start_date === "string" ? e.start_date : "", url: forumLink(e.url, forumUrl), venue: ref(e.venue), venueTrack: ref(e.venue_track) });
  }
  // the forum sends newest first; don't rely on it
  return events.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : b.id - a.id));
}

export function usedAt(events: ForumEvent[]): UsedAt {
  const venues = new Map<number, { id: number; name: string }>();
  for (const e of events) if (e.venue && !venues.has(e.venue.id)) venues.set(e.venue.id, e.venue);
  return { events, venues: [...venues.values()] };
}

export class ForumEvents extends ForumLayoutCache<ForumEvent[]> {
  protected readonly what = "forum events unavailable";
  protected path(layoutId: string) {
    return `/des/layouts/${layoutId}/events`;
  }
  protected parse(body: unknown) {
    return parse(body, this.opts.forumUrl);
  }
}
