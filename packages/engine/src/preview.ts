// 2D top-down preview, drawn ONLY from `built` (what the forum does). A port of reference/preview_svg.py.
import { pyFormat, radians } from "./num.js";
import type { RcTrack } from "./types.js";

const f1 = (v: number) => pyFormat(v, 1);

/** Python's `{v:g}` for the plain numbers used here (area sizes, rotations). */
const g = (v: number) => String(Number(v.toPrecision(6)));

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface PreviewOptions {
  pxPerM?: number;
}

/** SVG plan of the track. Requires `built`. */
export function previewSvg(doc: RcTrack, { pxPerM = 40 }: PreviewOptions = {}): string {
  const a = doc.area;
  const b = doc.built;
  if (!b) throw new Error("previewSvg: track has no built section (bake it first)");
  const L = a.length, W = a.width;
  const m = 2.5; // margin (m) for the rostrum label
  const vw = (L + 2 * m) * pxPerM, vh = (W + 2 * m) * pxPerM;
  const X = (x: number) => (x + L / 2 + m) * pxPerM;
  const Z = (z: number) => (W / 2 + m - z) * pxPerM; // +z (north) is up on the page
  const o: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pyFormat(vw, 0)}" height="${pyFormat(vh, 0)}" viewBox="0 0 ${pyFormat(vw, 0)} ${pyFormat(vh, 0)}" font-family="sans-serif">`,
    `<rect width="100%" height="100%" fill="#1e2a22"/>`,
    `<rect x="${f1(X(-L / 2))}" y="${f1(Z(W / 2))}" width="${f1(L * pxPerM)}" height="${f1(W * pxPerM)}" fill="#3a3d42" stroke="#888" stroke-width="2"/>`,
  ];
  // 1 m grid
  for (let x = -Math.floor(L / 2); x <= Math.floor(L / 2); x++) {
    o.push(`<line x1="${f1(X(x))}" y1="${f1(Z(W / 2))}" x2="${f1(X(x))}" y2="${f1(Z(-W / 2))}" stroke="#ffffff" stroke-opacity="0.05"/>`);
  }
  for (let z = -Math.floor(W / 2); z <= Math.floor(W / 2); z++) {
    o.push(`<line x1="${f1(X(-L / 2))}" y1="${f1(Z(z))}" x2="${f1(X(L / 2))}" y2="${f1(Z(z))}" stroke="#ffffff" stroke-opacity="0.05"/>`);
  }
  // fixed obstacles (pillars, exits)
  for (const ob of doc.obstacles ?? []) {
    if (ob.type === "circle") {
      o.push(`<circle cx="${f1(X(ob.x))}" cy="${f1(Z(ob.z))}" r="${f1(ob.radius * pxPerM)}" fill="#b03a3a"/>`);
    } else {
      o.push(
        `<rect x="${f1(X(ob.x - ob.length / 2))}" y="${f1(Z(ob.z + ob.width / 2))}" width="${f1(ob.length * pxPerM)}" height="${f1(ob.width * pxPerM)}" fill="#b03a3a" fill-opacity="0.45" stroke="#ff6060" stroke-dasharray="6 4" transform="rotate(${g(-(ob.rotation ?? 0))} ${f1(X(ob.x))} ${f1(Z(ob.z))})"/>`,
      );
    }
    if (ob.label) o.push(`<text x="${f1(X(ob.x))}" y="${f1(Z(ob.z) + 4)}" fill="#fff" font-size="12" text-anchor="middle">${esc(ob.label)}</text>`);
  }
  // lanes (carpet), when the file has them (rctrack 1.4)
  if (b.lanes) {
    const d = [b.lanes.right, b.lanes.left].map((ring) => `M ${ring.map(([x, z]) => `${f1(X(x))},${f1(Z(z))}`).join(" L ")} Z`).join(" ");
    o.push(`<path d="${d}" fill="#4a5d51" fill-rule="evenodd"/>`);
  }
  // racing line
  const pts = b.racingLine.map((p) => `${f1(X(p[0]))},${f1(Z(p[1]))}`).join(" ");
  o.push(`<polygon points="${pts}" fill="none" stroke="#ff4fb0" stroke-width="2" stroke-dasharray="8 6" opacity="0.7"/>`);
  // features
  const featureColours: Record<string, string> = { tabletop: "#ffb347", double: "#5ec8ff", kicker: "#ffe066" };
  for (const f of b.features) {
    const h = radians(f.heading);
    const tx = Math.cos(h), tz = Math.sin(h), nx = -tz, nz = tx;
    const c = ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([sl, sw]) => [
      f.x + (tx * sl * f.length) / 2 + (nx * sw * f.width) / 2,
      f.z + (tz * sl * f.length) / 2 + (nz * sw * f.width) / 2,
    ]);
    const col = featureColours[f.type] ?? "#c9a0ff";
    o.push(`<polygon points="${c.map(([x, z]) => `${f1(X(x))},${f1(Z(z))}`).join(" ")}" fill="${col}" opacity="0.9"/>`);
  }
  // dividers
  for (const d of b.dividers) {
    const p = d.points.map(([x, z]) => `${f1(X(x))},${f1(Z(z))}`).join(" ");
    const tag = d.closed ? "polygon" : "polyline";
    o.push(`<${tag} points="${p}" fill="none" stroke="${d.shared ? "#ffffff" : "#cfd2d6"}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  // start line + direction
  const s = b.startLine;
  const h = radians(s.heading);
  const nx = -Math.sin(h), nz = Math.cos(h);
  o.push(`<line x1="${f1(X(s.x + (nx * s.width) / 2))}" y1="${f1(Z(s.z + (nz * s.width) / 2))}" x2="${f1(X(s.x - (nx * s.width) / 2))}" y2="${f1(Z(s.z - (nz * s.width) / 2))}" stroke="#ffffff" stroke-width="8"/>`);
  const ax = s.x + Math.cos(h) * 2.5, az = s.z + Math.sin(h) * 2.5;
  o.push(`<line x1="${f1(X(s.x + Math.cos(h) * 0.6))}" y1="${f1(Z(s.z + Math.sin(h) * 0.6))}" x2="${f1(X(ax))}" y2="${f1(Z(az))}" stroke="#ff4fb0" stroke-width="5" marker-end="url(#a)"/>`);
  o.splice(1, 0, '<defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#ff4fb0"/></marker></defs>');
  // checks
  const checkColours: Record<string, string> = { error: "#ff4040", warning: "#ffb000" };
  for (const c of b.checks) {
    if (c.x !== undefined && c.z !== undefined) {
      o.push(`<circle cx="${f1(X(c.x))}" cy="${f1(Z(c.z))}" r="14" fill="none" stroke="${checkColours[c.level] ?? "#7fb2ff"}" stroke-width="4"/>`);
    }
  }
  // rostrum
  const r = b.rostrum;
  o.push(
    `<rect x="${f1(X(r.x) - 80)}" y="${f1(Z(r.z) - 14)}" width="160" height="28" rx="4" fill="#6a3da3"/>` +
      `<text x="${f1(X(r.x))}" y="${f1(Z(r.z) + 6)}" fill="#fff" font-size="16" text-anchor="middle">ROSTRUM</text>`,
  );
  o.push(`<text x="12" y="26" fill="#fff" font-size="20">${esc(doc.info.name)}  -  ${pyFormat(b.lapLength, 0)} m lap, ${b.features.length} features, area ${g(L)} x ${g(W)} m</text>`);
  o.push("</svg>");
  return o.join("\n");
}
