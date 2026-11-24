// Who may create and edit a venue template (#173). Organisers (forum admins and the ORGANISER_GROUP, track-admins) may
// edit any. A club's committee (its officers included) may edit the templates of the forum venues that club manages:
// the forum names the managing club (ForumVenues.managingClub), and the member's forum groups name their clubs
// (User.clubs, read from DiscourseConnect at sign-in). A template with no forum venue is the organisers' alone.
import type { RcVenue } from "@track-studio/engine";
import type { User } from "./auth.js";
import { forbidden } from "./errors.js";
import type { ForumVenues } from "./forum-venues.js";

type Link = Pick<NonNullable<RcVenue["info"]["venue"]>, "id" | "name"> | null | undefined;

/** May the user edit a template linked to this forum venue? Throws a 503 when the forum can't say (and the user isn't an organiser). */
export async function mayEditVenueLink(user: User | null, link: Link, forumVenues: ForumVenues): Promise<boolean> {
  if (!user) return false;
  if (user.organiser) return true;
  if (!user.clubs.length || !link || !Number.isInteger(link.id)) return false;
  const club = await forumVenues.managingClub(link.id);
  return club !== null && user.clubs.includes(club);
}

/** For GET: false rather than a 503 while the forum is down. */
export async function canEditVenue(user: User | null, link: Link, forumVenues: ForumVenues): Promise<boolean> {
  try {
    return await mayEditVenueLink(user, link, forumVenues);
  } catch {
    return false;
  }
}

/** Throws 403 unless the user may save a template linked to every one of `links` (before and after an edit). */
export async function assertMayEditVenue(user: User, links: Link[], forumVenues: ForumVenues): Promise<void> {
  if (user.organiser) return;
  for (const link of links) {
    if (await mayEditVenueLink(user, link, forumVenues)) continue;
    const where = link?.name ?? (link ? `forum venue ${link.id}` : "a template with no forum venue");
    throw forbidden(
      user.clubs.length
        ? `Only organisers and the committee of the club that runs ${where} can edit its venue templates.`
        : "Only organisers and a club's committee can edit venue templates.",
    );
  }
}
