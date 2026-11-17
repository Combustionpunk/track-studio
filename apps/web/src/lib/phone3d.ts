// The 3D preview on a phone (#127): its switch, and the figures the Board writes down from a real phone.
//
// The toolbar's 3D button is behind a switch until the Board has measured it on a real iPhone and a real Android
// phone: `?phone3d=1` on any designer address turns it on for this device (kept in localStorage, so a reload or the
// next track keeps it), `?phone3d=0` turns it off again. With the switch on, the phone also shows how long 3D took
// from the tap to its first frame, and how the last orbit went (frames a second, the slowest frame).

/** the address's switch: `?phone3d=1` on, `?phone3d=0` off */
export const PHONE_3D_PARAM = "phone3d";
/** where the switch is kept on this device */
export const PHONE_3D_KEY = "designer-phone-3d";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Whether the phone's 3D button is on: the address's `phone3d` (kept for next time), else what this device kept. */
export function phone3dSwitch(param: string | null, storage: Store | undefined): boolean {
  const on = param === "1" ? true : param === "0" ? false : null;
  try {
    if (on === true) storage?.setItem(PHONE_3D_KEY, "1");
    else if (on === false) storage?.removeItem(PHONE_3D_KEY);
    else return storage?.getItem(PHONE_3D_KEY) === "1";
  } catch {
    /* private mode etc.: the address alone */
  }
  return on ?? false;
}

/** a run of frames drawn one after another (an orbit, a pinch) */
export interface FrameRun {
  frames: number;
  /** frames a second over the run */
  fps: number;
  /** the longest gap between two frames in it, ms */
  worstMs: number;
}

/** frames further apart than this start a new run: the view draws only when something moves */
export const RUN_GAP_MS = 250;
/** fewer frames than this is a tap or a nudge, not an orbit */
const MIN_RUN = 10;

/** The last run of frames in `times` (ms, in order), or null if it's too short to say anything. */
export function lastRun(times: number[], gap = RUN_GAP_MS): FrameRun | null {
  let start = times.length - 1;
  while (start > 0 && times[start] - times[start - 1] <= gap) start--;
  const run = times.slice(start);
  if (run.length < MIN_RUN) return null;
  let worstMs = 0;
  for (let i = 1; i < run.length; i++) worstMs = Math.max(worstMs, run[i] - run[i - 1]);
  const span = run[run.length - 1] - run[0];
  return { frames: run.length, fps: span > 0 ? ((run.length - 1) * 1000) / span : 0, worstMs };
}

/** The figures in words: "First frame 812 ms · Orbit 59 fps, slowest frame 33 ms". */
export function figures3d(firstMs: number | null, run: FrameRun | null): string {
  const parts: string[] = [];
  if (firstMs !== null) parts.push(`First frame ${Math.round(firstMs)} ms`);
  if (run) parts.push(`Orbit ${Math.round(run.fps)} fps, slowest frame ${Math.round(run.worstMs)} ms`);
  return parts.join(" · ");
}
