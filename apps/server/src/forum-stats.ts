// Lap times on a layout: the forum computes them from published race results (discourse-event-system "Layout stats")
// and serves them at GET /des/layouts/:layoutId/stats.json, per class: the typical lap (median of the cleaned laps,
// 10% trimmed mean, IQR, how many laps and meetings) and two track records (fastest lap, best 3 consecutive laps).
// Nothing is stored here; answers are cached (forum-cache.ts) (#76).
import { forumLink, isObject, ForumLayoutCache } from "./forum-cache.js";

export interface TypicalLap {
  medianMs: number;
  trimmedMeanMs: number;
  iqrMs: number;
  laps: number;
  meetings: number;
  updatedAt: string | null;
}

export interface LapRecord {
  /** one lap, or the three consecutive laps together */
  ms: number;
  /** username null: the driver has no forum account (any more) */
  driver: { name: string; username: string | null };
  car: string | null;
  /** url null when the forum sent no usable link */
  meeting: { id: number; title: string; date: string; url: string | null } | null;
}

export interface ClassLapStats {
  class: string;
  typicalLap: TypicalLap | null;
  recordLap: LapRecord | null;
  record3: LapRecord | null;
}

export interface LapStats {
  classes: ClassLapStats[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);
/** an ISO date or date-time the web app can show; anything else is dropped */
const dateOrEmpty = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)) ? v : "");

function typical(v: unknown): TypicalLap | null {
  if (!isObject(v)) return null;
  const medianMs = num(v.median_ms);
  if (medianMs === null || medianMs <= 0) return null;
  return { medianMs, trimmedMeanMs: num(v.trimmed_mean_ms) ?? medianMs, iqrMs: num(v.iqr_ms) ?? 0, laps: num(v.laps) ?? 0, meetings: num(v.meetings) ?? 0, updatedAt: str(v.updated_at) };
}

function lapRecord(v: unknown, forumUrl: string): LapRecord | null {
  if (!isObject(v) || !isObject(v.driver)) return null;
  const ms = num(v.ms);
  const name = str(v.driver.name);
  if (ms === null || ms <= 0 || !name) return null;
  const m = v.meeting;
  const meeting = isObject(m) && typeof m.id === "number" && typeof m.title === "string" ? { id: m.id, title: m.title, date: dateOrEmpty(m.date), url: forumLink(m.url, forumUrl) } : null;
  return { ms, driver: { name, username: str(v.driver.username) }, car: str(v.car), meeting };
}

export function parseStats(body: unknown, forumUrl: string): LapStats | null {
  if (!isObject(body) || !Array.isArray(body.classes)) return null;
  const classes: ClassLapStats[] = [];
  for (const c of body.classes) {
    if (!isObject(c) || typeof c.class !== "string" || !c.class.trim()) continue;
    classes.push({ class: c.class.trim(), typicalLap: typical(c.typical_lap), recordLap: lapRecord(c.record_lap, forumUrl), record3: lapRecord(c.record_3, forumUrl) });
  }
  return { classes };
}

export class ForumStats extends ForumLayoutCache<LapStats> {
  protected readonly what = "forum lap stats unavailable";
  protected path(layoutId: string) {
    return `/des/layouts/${layoutId}/stats.json`;
  }
  protected parse(body: unknown) {
    return parseStats(body, this.opts.forumUrl);
  }
}
