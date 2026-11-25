// Who may see a layout (#175). A draft that has never been approved is its author's and the organisers' (site admins
// are organisers); to anyone else it answers exactly as an id that doesn't exist: 404, never 403. Submitted, approved
// and archived layouts are public, and so is a draft a meeting uses (the forum says; unknown while it's down = hidden).
import type { User } from "./auth.js";
import type { DB } from "./db.js";
import { notFound } from "./errors.js";
import type { ForumEvents } from "./forum-events.js";
import { getTrackRow, type TrackRow } from "./store.js";

type Row = Pick<TrackRow, "id" | "status" | "approved_revision" | "author_forum_id">;

/** A draft with no approved revision: not public, unless a meeting uses it. (An approved layout with a newer draft is in the library.) */
export const isPrivateDraft = (row: Pick<Row, "status" | "approved_revision">) => row.status === "draft" && row.approved_revision === null;

/** The author and organisers see a layout whatever its state. */
export const isOwnOrOrganiser = (user: User | null, row: Pick<Row, "author_forum_id">) => !!user && (user.id === row.author_forum_id || user.organiser);

/** Hidden from this reader unless a meeting uses it. */
const needsMeeting = (user: User | null, row: Row) => isPrivateDraft(row) && !isOwnOrOrganiser(user, row);

/** Does a meeting use it? Cached by ForumEvents; null (the forum can't say) counts as no. */
const usedByMeeting = async (events: ForumEvents, id: string) => ((await events.forLayout(id))?.length ?? 0) > 0;

export async function canSee(events: ForumEvents, user: User | null, row: Row): Promise<boolean> {
  return !needsMeeting(user, row) || usedByMeeting(events, row.id);
}

/** The track, for a reader: 404 when there's none or it's a draft this reader may not see. */
export async function visibleTrackRow(db: DB, events: ForumEvents, user: User | null, id: string): Promise<TrackRow> {
  const row = getTrackRow(db, id);
  if (!(await canSee(events, user, row))) throw notFound("Track");
  return row;
}

/**
 * The track, for a change only its author or an organiser could make anyway (save, submit, approve, archive): someone
 * else's draft is a 404 without asking the forum, whether or not a meeting uses it.
 */
export function changeableTrackRow(db: DB, user: User | null, id: string): TrackRow {
  const row = getTrackRow(db, id);
  if (needsMeeting(user, row)) throw notFound("Track");
  return row;
}

/** The rows of a list this reader may see. The forum is asked only about drafts that aren't the reader's own. */
export async function visibleRows<T extends Row>(events: ForumEvents, user: User | null, rows: T[]): Promise<T[]> {
  const unsure = rows.filter((r) => needsMeeting(user, r));
  if (!unsure.length) return rows;
  const used = await events.forLayouts(unsure.map((r) => r.id));
  const hidden = new Set(unsure.filter((r) => !used.get(r.id)?.length).map((r) => r.id));
  return rows.filter((r) => !hidden.has(r.id));
}

/** Cache-Control for a layout's file or picture: never in a shared cache while it's a draft. */
export const cacheScope = (row: Pick<Row, "status" | "approved_revision">) => (isPrivateDraft(row) ? "private" : "public");
