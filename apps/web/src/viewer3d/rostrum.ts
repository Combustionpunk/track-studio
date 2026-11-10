// The rostrum view's side (#84): the default (the drawn-for venue's rostrum, else south) and the URL that keeps the
// choice (?view=rostrum&side=n). Pure, so it's tested without a browser.
import { venueRostrumOf, type RcVenue, type Side } from "@track-studio/engine";

export const SIDES: readonly Side[] = ["north", "east", "south", "west"];
const LETTER: Record<Side, string> = { north: "n", east: "e", south: "s", west: "w" };

/** The side the layout's venue template has its rostrum on (as venueCheck reports it); south without one. */
export function defaultRostrumSide(venue: Pick<RcVenue, "area" | "rostrum"> | null | undefined): Side {
  return venue ? venueRostrumOf(venue).side : "south";
}

export interface RostrumChoice {
  /** standing at the rostrum (?view=rostrum), not orbiting */
  at: boolean;
  /** the side picked (?side=n|e|s|w); none: the default */
  side?: Side;
}

/** The choice in the page's URL. */
export function readRostrum(params: URLSearchParams): RostrumChoice {
  const s = params.get("side")?.toLowerCase();
  const side = SIDES.find((k) => LETTER[k] === s || k === s);
  return { at: params.get("view") === "rostrum", side };
}

/** A copy of `params` with the choice in it. */
export function writeRostrum(params: URLSearchParams, c: RostrumChoice): URLSearchParams {
  const p = new URLSearchParams(params);
  p.delete("view");
  p.delete("side");
  if (c.at) p.set("view", "rostrum");
  if (c.side) p.set("side", LETTER[c.side]);
  return p;
}
