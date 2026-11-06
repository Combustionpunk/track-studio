// Lap times (#76): the forum's typical lap and records per class, and an estimate from the lap length and the class
// speed settings (GET /api/class-speeds) where a layout hasn't been raced.
import type { ClassSpeed } from "./api.js";
import { useApi } from "./hooks.js";

/** the server's limits (PUT /api/class-speeds) */
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 30;

export const estimateSeconds = (lapLength: number, speed: number) => lapLength / speed;

/** "14.8 s"; an estimate reads "≈ 14.6 s est." */
export const lapTime = (seconds: number, est = false) => (est ? `≈ ${seconds.toFixed(1)} s est.` : `${seconds.toFixed(1)} s`);

/** records to a hundredth: "13.92 s" */
export const recordTime = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** The designer's figure beside the lap length, from the first class: "≈ 14.6 s lap (2WD Buggy, est.)". */
export function designerEstimate(lapLength: number, speeds: ClassSpeed[]): string | null {
  const first = speeds[0];
  if (!first || !(lapLength > 0)) return null;
  return `≈ ${estimateSeconds(lapLength, first.speed).toFixed(1)} s lap (${first.class}, est.)`;
}

/** The class speed settings; undefined until loaded (or if they can't be). */
export const useClassSpeeds = () => useApi<{ classes: ClassSpeed[] }>("/api/class-speeds").data?.classes;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The speed for a class, matched ignoring case and spacing like the forum's class names. */
export const speedFor = (speeds: ClassSpeed[] | undefined, cls: string) => speeds?.find((s) => norm(s.class) === norm(cls))?.speed ?? null;

/** The class speed editor's rows, checked as the server will: blank rows dropped. */
export function parseSpeedRows(rows: { class: string; speed: string }[]): { classes: ClassSpeed[] } | { error: string } {
  const classes: ClassSpeed[] = [];
  for (const r of rows) {
    const name = r.class.trim().replace(/\s+/g, " ");
    if (!name && !r.speed.trim()) continue;
    if (!name) return { error: "Every class with a speed needs a name" };
    const speed = Number(r.speed);
    if (!r.speed.trim() || !Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) return { error: `${name}: the speed must be ${MIN_SPEED} to ${MAX_SPEED} m/s` };
    if (classes.some((c) => norm(c.class) === norm(name))) return { error: `${name} is listed twice` };
    classes.push({ class: name, speed });
  }
  return { classes };
}
