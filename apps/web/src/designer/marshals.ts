// Marshal points (#151, rctrack 1.11): numbered cones where marshals stand, design.marshals = {number, x, z}. The
// number is the fill order (with 6 marshals, cones 1-6 are manned); a cone stands beside the track or round the edge
// of the hall, up to MARSHAL_PLACE_MARGIN outside the drawing area. Pure edits: each returns a new list.
import type { Area, DesignMarshal, Point2 } from "@track-studio/engine";

/** a cone can be placed up to this far (m) outside the drawing area (the Board's margin, #151) */
export const MARSHAL_PLACE_MARGIN = 2;
export const MARSHAL_NUMBER_MAX = 99;

const cm = (v: number) => Math.round(v * 100) / 100 || 0;

/** The lowest number no cone has: a new cone fills the first gap (99 when 1-99 are all taken: the format's highest). */
export function nextMarshalNumber(list: readonly DesignMarshal[]): number {
  const used = new Set(list.map((m) => m.number));
  let n = 1;
  while (used.has(n)) n++;
  return Math.min(n, MARSHAL_NUMBER_MAX);
}

/** A plan point held within the placement limit (the area plus MARSHAL_PLACE_MARGIN each side), to the centimetre. */
export function clampToPlacement([x, z]: Point2, area: Area): Point2 {
  const X = area.length / 2 + MARSHAL_PLACE_MARGIN, Z = area.width / 2 + MARSHAL_PLACE_MARGIN;
  return [cm(Math.min(X, Math.max(-X, x))), cm(Math.min(Z, Math.max(-Z, z)))];
}

/** A new cone at `p` with the lowest unused number, last in the list. */
export function addMarshal(list: readonly DesignMarshal[], p: Point2, area: Area): { marshals: DesignMarshal[]; index: number } {
  const [x, z] = clampToPlacement(p, area);
  return { marshals: [...list, { number: nextMarshalNumber(list), x, z }], index: list.length };
}

export function moveMarshal(list: readonly DesignMarshal[], i: number, p: Point2, area: Area): DesignMarshal[] {
  const [x, z] = clampToPlacement(p, area);
  return list.map((m, k) => (k === i ? { ...m, x, z } : m));
}

export function deleteMarshal(list: readonly DesignMarshal[], i: number): DesignMarshal[] {
  return list.filter((_, k) => k !== i);
}

/** Cone i's number, a whole number from 1 to 99. Renumbering never moves a cone, and no other cone changes. */
export function renumberMarshal(list: readonly DesignMarshal[], i: number, n: number): DesignMarshal[] {
  const number = Math.min(MARSHAL_NUMBER_MAX, Math.max(1, Math.round(n)));
  return list.map((m, k) => (k === i ? { ...m, number } : m));
}
