// Display formatting. Stored data is metres; people read whole metres for lap and size.
import type { FitResult, TrackStatus } from "./api.js";

export const lap = (m: number) => `${Math.round(m)} m`;

/** "22 × 12 m" (whole metres) or "22 × 11.8 m" with precise = true. */
export function size(s: { length: number; width: number } | null | undefined, precise = false): string {
  if (!s) return "—";
  const f = (v: number) => (precise ? String(Math.round(v * 10) / 10) : String(Math.round(v)));
  return `${f(s.length)} × ${f(s.width)} m`;
}

export const metres = (m: number, digits = 1) => `${Math.round(m * 10 ** digits) / 10 ** digits} m`;

export const spare = (f: FitResult) => `${f.spare[0]} × ${f.spare[1]} m spare`;

export const corners = (n: number) => `${n} corner${n === 1 ? "" : "s"}`;

export const STATUS_LABEL: Record<TrackStatus, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", archived: "Archived" };

export function date(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${date(iso)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export const FEATURE_LABEL: Record<string, string> = {
  tabletop: "Tabletop",
  double: "Double",
  kicker: "Kicker",
  stepup: "Step-up",
  stepdown: "Step-down",
  whoops: "Whoops",
  bump: "Bump",
};

/** Slug for download file names, like the server's. */
export const slug = (s: string) =>
  s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").toLowerCase().slice(0, 60) || "track";
