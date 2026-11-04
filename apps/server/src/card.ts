// The link-preview card (Open Graph image), 1200 × 630: the header band with the logo, the track's name, status and
// figures, and its plan drawn by the engine's shared renderer. Frame colours follow the synced theme; the plan keeps
// its fixed palette. Rendered to PNG with resvg (previews.ts), which has no CSS: every colour is an attribute.
import { escapeXml, PLAN_PALETTE, planInBox, planScene, type RcTrack, type TrackStatus } from "@track-studio/engine";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "./config.js";
import type { Tokens } from "./theme.js";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const LOGO_FILE = join(ROOT_DIR, "apps", "web", "src", "brand", "logo.svg");

const STATUS_LABEL: Record<TrackStatus, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", archived: "Archived" };
const statusColour = (s: TrackStatus, c: Tokens) => (s === "approved" ? c.successText : s === "submitted" ? c.warning : c.muted);

const DISPLAY = `Oswald, 'DejaVu Sans', sans-serif`;
const BODY = `Inter, 'DejaVu Sans', sans-serif`;
const NAME_SIZE = 52;
const NAME_CHARS = 17; // what fits the 440 px column in Oswald at 52 px

/** The track name on at most two lines of `max` characters, shortened with "…" when it doesn't fit. */
export function wrapName(name: string, max = NAME_CHARS, lines = 2): string[] {
  const cut = (s: string) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  const out: string[] = [];
  let line = "";
  const words = name.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = line ? `${line} ${w}` : w;
    if (next.length <= max) {
      line = next;
      continue;
    }
    if (line) out.push(cut(line));
    line = w;
    if (out.length === lines - 1) {
      // last line: the rest, shortened
      const rest = words.slice(i).join(" ");
      out.push(rest.length > max ? `${rest.slice(0, max - 1).trimEnd()}…` : rest);
      return out;
    }
  }
  if (line) out.push(cut(line));
  return out.length ? out : [""];
}

const logoCache = new Map<string, string | null>();
const readLogo = (file: string) => {
  if (!logoCache.has(file)) logoCache.set(file, existsSync(file) ? readFileSync(file, "utf8") : null);
  return logoCache.get(file)!;
};

/** The logo file as plain SVG for resvg: theme variables become this theme's colours (or the file's fallbacks). */
export function logoMarkup(colors: Tokens, file = LOGO_FILE): string | null {
  const svg = readLogo(file);
  if (svg === null) return null;
  const box = /<svg\b[^>]*viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 244 48";
  const inner = svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<view\b[^>]*\/>/g, "")
    .replace(/var\(--([\w-]+),\s*([^)]+)\)/g, (_m, name: string, fallback: string) => {
      const key = name.replace(/-(\w)/g, (_x, ch: string) => ch.toUpperCase()).replace(/-/g, "") as keyof Tokens;
      return colors[key] ?? fallback.trim();
    });
  return `<svg class="logo" x="48" y="20" width="${Math.round((44 * Number(box.split(/\s+/)[2])) / Number(box.split(/\s+/)[3]))}" height="44" viewBox="${box}">${inner.trim()}</svg>`;
}

export function cardSvg(doc: RcTrack, status: TrackStatus, colors: Tokens): string {
  const b = doc.built;
  if (!b) throw new Error("cardSvg: track has no built section");
  const t = (x: number, y: number, size: number, fill: string, text: string, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${escapeXml(text)}</text>`;
  const o: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`,
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${colors.bg}"/>`,
    `<rect width="${CARD_WIDTH}" height="84" fill="${colors.headerBg}"/>`,
    `<rect y="84" width="${CARD_WIDTH}" height="1" fill="${colors.border}"/>`,
  ];
  const logo = logoMarkup(colors);
  const logoW = logo ? Number(/width="(\d+)"/.exec(logo)![1]) : 0;
  if (logo) o.push(logo);
  o.push(t(logo ? 48 + logoW + 18 : 48, 56, 28, colors.accent, logo ? "TRACK STUDIO" : "RC MISFITS TRACK STUDIO", ` font-family="${DISPLAY}" font-weight="500" letter-spacing="1"`));

  // name, status, figures
  let y = 112;
  for (const line of wrapName(doc.info.name)) {
    y += 60; // first baseline 172, then a 60 px line height
    o.push(t(48, y, NAME_SIZE, colors.text, line, ` font-family="${DISPLAY}" font-weight="500"`));
  }
  const badgeY = y + 28;
  const word = STATUS_LABEL[status];
  const badgeW = Math.round(word.length * 11.5 + 36);
  const sc = statusColour(status, colors);
  o.push(`<rect x="49" y="${badgeY}" width="${badgeW}" height="36" rx="18" fill="none" stroke="${sc}" stroke-width="2"/>`);
  o.push(t(48 + badgeW / 2, badgeY + 25, 20, sc, word, ` font-family="${BODY}" font-weight="600" text-anchor="middle"`));

  const size = b.size ? `${Math.round(b.size.length)} × ${Math.round(b.size.width)} m` : "—";
  const figures: [string, string][] = [
    [`${Math.round(b.lapLength)} m`, "LAP"],
    [String(b.stats.corners), "CORNERS"],
    [size, "SIZE"],
  ];
  let fy = badgeY + 36 + 60;
  for (const [value, label] of figures) {
    o.push(t(48, fy, 44, colors.text, value, ` font-family="${DISPLAY}" font-weight="500"`));
    o.push(t(48, fy + 26, 16, colors.muted, label, ` font-family="${BODY}" font-weight="600" letter-spacing="1.5"`));
    fy += 84;
  }

  // the plan, in a plan well
  const well = { x: 520, y: 116, w: 632, h: 482 };
  o.push(`<rect x="${well.x}" y="${well.y}" width="${well.w}" height="${well.h}" rx="10" fill="${PLAN_PALETTE["plan-floor"]}" stroke="${colors.border}" stroke-width="1"/>`);
  o.push(planInBox(planScene(doc), { x: well.x + 12, y: well.y + 12, w: well.w - 24, h: well.h - 24 }, { id: "card", pixelRatio: 1.5 })); // the card is usually shown at ~600 px
  o.push("</svg>");
  return o.join("");
}
