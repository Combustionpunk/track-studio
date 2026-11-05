// Starting a new design (#14): from a venue template, or blank on an area the designer enters. Both open in step 1.
import type { Area, RcVenue } from "@track-studio/engine";
import { newDraft, type Draft } from "./Designer.js";

/** a blank area's length and width, each way (m) */
export const BLANK_MIN = 6;
export const BLANK_MAX = 60;
const BLANK_DEFAULT: Area = { length: 22, width: 12 };

/** plain metres, as typed: "22", "24.5" (not "1e1" or "0x10", which Number() would take) */
const DECIMAL = /^\d+(\.\d+)?$/;

export type BlankProblems = Partial<Record<keyof Area, string>>;

/** What to change in the blank-area form, keyed by field; empty when it's fine. */
export function blankProblems(input: Record<keyof Area, string>): BlankProblems {
  const p: BlankProblems = {};
  for (const k of ["length", "width"] as const) {
    const t = input[k].trim(), v = Number(t);
    const label = k === "length" ? "Length" : "Width";
    if (!DECIMAL.test(t)) p[k] = `Enter the ${k} in metres.`;
    else if (v < BLANK_MIN) p[k] = `${label} must be at least ${BLANK_MIN} m.`;
    else if (v > BLANK_MAX) p[k] = `${label} can be at most ${BLANK_MAX} m.`;
  }
  return p;
}

/** the designer for a blank area */
export function blankHref({ name, length, width }: { name: string } & Area): string {
  const q = new URLSearchParams({ length: String(length), width: String(width) });
  if (name.trim()) q.set("name", name.trim());
  return `/new/design?${q}`;
}

/** The area in a /new/design link, kept to the form's limits (a hand-edited link can't make a 200 m hall). */
export function blankArea(params: URLSearchParams): Area {
  const read = (k: keyof Area) => {
    const t = params.get(k)?.trim() ?? "";
    const v = DECIMAL.test(t) ? Number(t) : NaN;
    return Number.isFinite(v) ? Math.min(BLANK_MAX, Math.max(BLANK_MIN, v)) : BLANK_DEFAULT[k];
  };
  return { length: read("length"), width: read("width") };
}

/** Start blank: the area entered, no venue and no obstacles; the rostrum is the default one on the south side. */
export function blankDraft(area: Area, name = "New track"): Draft {
  return newDraft({ name, area, obstacles: [] });
}

/** From a venue: its area, obstacles and rostrum, pinned to its revision. */
export function venueDraft(v: RcVenue, name?: string): Draft {
  return newDraft({
    name: name || `New track at ${v.info.name}`,
    area: v.area,
    obstacles: v.obstacles ?? [],
    basedOn: { venueTemplate: v.id, revision: v.revision },
    rostrum: v.rostrum,
  });
}
