// Typical lap per class (#76): the forum's median when the layout has been raced in that class, else an estimate from
// the lap length and the class's speed setting (class_speeds, edited by track-admins).
import type { DB } from "./db.js";
import { badRequest } from "./errors.js";
import type { LapStats } from "./forum-stats.js";

export interface ClassSpeed {
  class: string;
  /** m/s along the racing line */
  speed: number;
}

/** what a library card shows for the picked class; est: from the lap length, not race data */
export interface TypicalLapFigure {
  seconds: number;
  est: boolean;
}

export const MAX_CLASSES = 30;
export const MAX_CLASS_NAME = 40;
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 30;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The forum normalises class names; match them ignoring case and spacing. */
export const sameClass = (a: string, b: string) => norm(a) === norm(b);

export const estimateSeconds = (lapLength: number, speed: number) => lapLength / speed;

export function typicalLap(stats: LapStats | null, cls: string, lapLength: number, speed: number | null): TypicalLapFigure | null {
  const raced = stats?.classes.find((c) => sameClass(c.class, cls))?.typicalLap;
  if (raced) return { seconds: raced.medianMs / 1000, est: false };
  if (speed && lapLength > 0) return { seconds: estimateSeconds(lapLength, speed), est: true };
  return null;
}

export function getClassSpeeds(db: DB): ClassSpeed[] {
  return db.prepare("SELECT class, speed FROM class_speeds ORDER BY position, class").all() as ClassSpeed[];
}

export function speedFor(speeds: ClassSpeed[], cls: string): number | null {
  return speeds.find((s) => sameClass(s.class, cls))?.speed ?? null;
}

/** Replaces the list ({classes: [{class, speed}]}, in display order). */
export function setClassSpeeds(db: DB, body: unknown): ClassSpeed[] {
  const list = (body as { classes?: unknown } | null)?.classes;
  if (!Array.isArray(list)) throw badRequest("bad-request", "classes must be a list of {class, speed}");
  if (list.length > MAX_CLASSES) throw badRequest("bad-request", `at most ${MAX_CLASSES} classes`);
  const out: ClassSpeed[] = [];
  for (const c of list as { class?: unknown; speed?: unknown }[]) {
    const name = typeof c?.class === "string" ? c.class.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > MAX_CLASS_NAME) throw badRequest("bad-request", `each class needs a name of 1 to ${MAX_CLASS_NAME} characters`);
    if (typeof c.speed !== "number" || !Number.isFinite(c.speed) || c.speed < MIN_SPEED || c.speed > MAX_SPEED)
      throw badRequest("bad-request", `${name}: speed must be ${MIN_SPEED} to ${MAX_SPEED} m/s`);
    if (out.some((o) => sameClass(o.class, name))) throw badRequest("bad-request", `${name} is listed twice`);
    out.push({ class: name, speed: c.speed });
  }
  db.transaction(() => {
    db.prepare("DELETE FROM class_speeds").run();
    const ins = db.prepare("INSERT INTO class_speeds (class, speed, position) VALUES (?, ?, ?)");
    out.forEach((c, i) => ins.run(c.class, c.speed, i));
  })();
  return out;
}
