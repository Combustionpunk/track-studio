// The build sheet page (#17): the figures as printed, paper sizes, the DRAFT rule, the plan with its edge labels and the
// QR code. The figures themselves come from the engine's buildSheet (drawn from `built`, measured from the south-west
// corner of the track area).
import { PLAN_MARGIN, planLayers, planScene, type BuildSheet, type RcTrack, type TrackStatus } from "@track-studio/engine";
import qrcode from "qrcode-generator";
import { FEATURE_LABEL, size } from "./format.js";

/** "4.0 m": one decimal, always (a marshal reads 4.0 as exact). */
export function metres1(m: number): string {
  const r = Math.round(m * 10) / 10;
  return `${(Object.is(r, -0) ? 0 : r).toFixed(1)} m`;
}

const trim = (v: number, digits = 2) => String(Math.round(v * 10 ** digits) / 10 ** digits);

export interface CornerRow {
  label: string;
  fromWest: string;
  fromSouth: string;
  turn: string;
}

export function cornerRows(s: BuildSheet): CornerRow[] {
  return s.cornerPoints.map((c) => ({
    label: c.label,
    fromWest: metres1(c.fromWest),
    fromSouth: metres1(c.fromSouth),
    turn: `${c.turn === "left" ? "Left" : "Right"}${c.hairpin ? ", hairpin" : ""}`,
  }));
}

export function jumpRows(s: BuildSheet): { type: string; position: string; size: string }[] {
  return s.jumps.map((j) => ({
    type: FEATURE_LABEL[j.type] ?? j.type,
    position: `${metres1(j.fromWest)}, ${metres1(j.fromSouth)}`,
    size: `${trim(j.length)} × ${trim(j.height)} m`,
  }));
}

export function figures(s: BuildSheet): { label: string; value: string }[] {
  const { min, max } = s.laneWidth;
  return [
    { label: "Lap length", value: metres1(s.lapLength) },
    { label: "Corners", value: String(s.corners) },
    { label: "Track size", value: size(s.size, true) },
    { label: "Track area", value: size(s.area, true) },
    { label: `Pipe, in ${s.pipe.runs} run${s.pipe.runs === 1 ? "" : "s"}`, value: metres1(s.pipe.length) },
    { label: "Lane width", value: max - min < 0.05 ? metres1(max) : `${trim(min, 1)}–${metres1(max)}` },
  ];
}

export function startText(s: BuildSheet): string {
  return (
    `Start line ${metres1(s.start.fromWest)} from the west wall, ${metres1(s.start.fromSouth)} from the south wall, cars heading ${s.start.heading}. ` +
    `Travel is ${s.direction}, shown by the arrows on the racing line. Rostrum on the ${s.rostrum} side.`
  );
}

// ---------------------------------------------------------------------------------------------------- status

export interface SheetStatus {
  status: TrackStatus;
  /** the DRAFT watermark: until this revision is the approved one */
  watermark: boolean;
  banner: string;
}

/** What the printed revision is. Only the approved revision prints without the DRAFT watermark. */
export function sheetStatus(track: { status: TrackStatus; revision: number; approvedRevision: number | null }, rev: number): SheetStatus {
  if (rev === track.approvedRevision) return track.status === "archived" ? { status: "archived", watermark: false, banner: "ARCHIVED" } : { status: "approved", watermark: false, banner: "APPROVED" };
  const status: TrackStatus = rev === track.revision ? track.status : "draft";
  const word = status === "submitted" ? "SUBMITTED" : status === "archived" ? "ARCHIVED" : "DRAFT";
  return { status, watermark: true, banner: `${word} · NOT YET APPROVED` };
}

// ---------------------------------------------------------------------------------------------------- paper

export type Paper = "a3" | "a4";

/** The sheet is laid out for A3 landscape at 96 dpi (the mockup's 1587 × 1123); A4 is the same layout scaled. */
export const SHEET_PX = { width: 1587, height: 1123 } as const;

export const PAPER: Record<Paper, { label: string; page: string; scale: number }> = {
  a3: { label: "A3", page: "A3 landscape", scale: 1 },
  a4: { label: "A4", page: "A4 landscape", scale: 297 / 420 },
};

export const paperFrom = (q: string | null | undefined): Paper => (q?.toLowerCase() === "a4" ? "a4" : "a3");

// ---------------------------------------------------------------------------------------------------- plan

export interface EdgeLabel {
  text: string;
  x: number;
  y: number;
}

export interface SheetPlan {
  /** viewBox: svg units are metres, y = -z */
  viewBox: { x: number; y: number; w: number; h: number };
  /** the plan drawing in the print palette (no checks) */
  svg: string;
  /** one svg unit's size in output pixels */
  pxPerM: number;
  /** labels every 5 m (and at the far wall) along the south and west edges, measured from the south-west corner */
  south: EdgeLabel[];
  west: EdgeLabel[];
}

const LABEL_ROOM = 1.4; // m outside the plan margin for the edge labels

/** The print plan fitted to `widthPx`, with room round the area for the rostrum and the edge labels. */
export function sheetPlan(doc: Pick<RcTrack, "area" | "obstacles" | "built">, widthPx: number, id = "sheet"): SheetPlan {
  const { length: L, width: W } = doc.area;
  const x = -L / 2 - PLAN_MARGIN - LABEL_ROOM, y = -W / 2 - PLAN_MARGIN;
  const viewBox = { x, y, w: L + 2 * PLAN_MARGIN + LABEL_ROOM, h: W + 2 * PLAN_MARGIN + LABEL_ROOM };
  const px = viewBox.w / widthPx;
  const svg = planLayers(planScene(doc), { px, palette: "print", layers: { checks: false }, id });
  const marks = (len: number) => [...Array.from({ length: Math.floor(len / 5) + 1 }, (_, k) => k * 5), ...(len % 5 > 0.05 ? [len] : [])];
  const label = (m: number) => (m === 0 ? "0" : `${trim(m, 1)} m`);
  // just outside the wall, or outside the rostrum when it stands on that side
  const side = doc.built?.rostrum.side;
  const southAt = W / 2 + (side === "south" ? PLAN_MARGIN + LABEL_ROOM / 2 : 0.7);
  const westAt = -L / 2 - (side === "west" ? PLAN_MARGIN + 0.35 : 0.35);
  return {
    viewBox,
    svg,
    pxPerM: 1 / px,
    south: marks(L).map((m) => ({ text: label(m), x: -L / 2 + m, y: southAt })),
    west: marks(W).map((m) => ({ text: label(m), x: westAt, y: W / 2 - m })),
  };
}

// ---------------------------------------------------------------------------------------------------- link

export function shortLink(origin: string, id: string, rev?: number): { url: string; text: string } {
  const url = `${origin}/t/${id}${rev ? `?r=${rev}` : ""}`;
  return { url, text: url.replace(/^https?:\/\//, "") };
}

/** A QR code as one SVG path of unit squares (draw it in a viewBox of size × size with fill currentColor). */
export function qrModules(text: string): { size: number; path: string } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const d: string[] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (qr.isDark(r, c)) d.push(`M${c} ${r}h1v1h-1z`);
  return { size, path: d.join("") };
}
