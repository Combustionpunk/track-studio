// "Will it fit my venue?" search and adapt. A port of reference/fit.py. Pure: no DOM, no Node APIs.
import { bake, FOOT_CELL, laneMask, obstacleMask, racingLine, rostrumPosition } from "./bake.js";
import { pyRound, pyRoundInt, radians } from "./num.js";
import type { Built, FitResult, Point2, RcTrack, RcVenue } from "./types.js";

/** [label, rotation (deg), mirror] in the order results are reported. */
export const ORIENTS: [string, number, boolean][] = [
  ["as designed", 0, false],
  ["mirrored", 0, true],
  ["rotated 180", 180, false],
  ["mirrored, rotated 180", 180, true],
  ["rotated 90", 90, false],
  ["rotated 270", 270, false],
  ["mirrored, rotated 90", 90, true],
  ["mirrored, rotated 270", 270, true],
];

/** Mirror (x -> -x) then rotate CCW by `rot` degrees. */
export function transformPt(x: number, z: number, rot: number, mirror: boolean): [number, number] {
  if (mirror) x = -x;
  const a = radians(rot);
  return [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
}

/**
 * Every orientation in which the track fits the venue: lanes inside the area, lanes + pipe thickness clear of every
 * obstacle, positioned on the 0.1 m grid as centrally as possible.
 */
export function fits(track: RcTrack, venue: RcVenue): FitResult[] {
  const L = venue.area.length, W = venue.area.width;
  const cell = FOOT_CELL;
  const areaOrigin: [number, number] = [-L / 2, -W / 2];
  const areaRows = pyRoundInt(W / cell), areaCols = pyRoundInt(L / cell);
  const obs = obstacleMask(venue.obstacles ?? [], areaOrigin, areaRows, areaCols);
  // only obstacle cells can block a position, so test those instead of the whole footprint
  const obsCells: [number, number][] = [];
  for (let k = 0; k < obs.length; k++) if (obs[k]) obsCells.push([Math.floor(k / areaCols), k % areaCols]);

  const results: FitResult[] = [];
  for (const [label, rot, mirror] of ORIENTS) {
    const pts = track.design.points.map((p) => {
      const [x, z] = transformPt(p.x, p.z, rot, mirror);
      return { ...p, x, z };
    });
    const { line, corners } = racingLine(pts, track.design.laneWidth ?? 2.0);
    const mObs = laneMask(line, corners, pts); // lanes + pipe thickness: obstacle test
    const mLane = laneMask(line, corners, pts, cell, mObs, -0.6 * cell); // lanes only: must sit inside the area
    const H = mObs.rows, Wc = mObs.cols;
    let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < Wc; c++) {
        if (!mLane.mask[r * Wc + c]) continue;
        r0 = Math.min(r0, r); r1 = Math.max(r1, r + 1);
        c0 = Math.min(c0, c); c1 = Math.max(c1, c + 1);
      }
    }
    if (r1 < 0) continue;
    const h = r1 - r0, w = c1 - c0;
    if (h > areaRows || w > areaCols) continue;
    let best: [number, number, number] | null = null;
    for (let oy = 0; oy <= areaRows - h; oy++) {
      for (let ox = 0; ox <= areaCols - w; ox++) {
        // place mObs so that its lane bbox starts at (ox, oy) in the area grid
        const ay0 = oy - r0, ax0 = ox - c0;
        let blocked = false;
        for (const [ar, ac] of obsCells) {
          const sr = ar - ay0, sc = ac - ax0;
          if (sr >= 0 && sr < H && sc >= 0 && sc < Wc && mObs.mask[sr * Wc + sc]) { blocked = true; break; }
        }
        if (blocked) continue;
        const dx = areaOrigin[0] + ax0 * cell - mObs.origin[0];
        const dz = areaOrigin[1] + ay0 * cell - mObs.origin[1];
        const cx = areaOrigin[0] + (ox + w / 2) * cell;
        const cz = areaOrigin[1] + (oy + h / 2) * cell;
        const score = cx * cx + cz * cz;
        if (best === null || score < best[0]) best = [score, dx, dz];
      }
    }
    if (best) {
      results.push({
        orientation: label,
        rotation: rot,
        mirror,
        shift: [pyRound(best[1], 2), pyRound(best[2], 2)],
        spare: [pyRound(L - w * cell, 1), pyRound(W - h * cell, 1)],
      });
    }
  }
  return results;
}

export interface AdaptOptions {
  /** id for the new track; default crypto.randomUUID() */
  id?: string;
}

/** An adapted copy of the track for the venue, in the chosen fit's orientation and position, re-baked. */
export function adapt(track: RcTrack, venue: RcVenue, fit: FitResult, opts: AdaptOptions = {}): RcTrack {
  const t: RcTrack = structuredClone(track);
  for (const p of t.design.points) {
    const [x, z] = transformPt(p.x, p.z, fit.rotation, fit.mirror);
    p.x = pyRound(x + fit.shift[0], 3);
    p.z = pyRound(z + fit.shift[1], 3);
  }
  t.area = { ...venue.area };
  t.obstacles = structuredClone(venue.obstacles ?? []);
  t.design.rostrum = { ...(venue.rostrum ?? { side: "south" }) };
  t.basedOn = { venueTemplate: venue.id, revision: venue.revision };
  t.info.venue = venue.info.venue ?? null;
  t.info.derivedFrom = { id: track.id, revision: track.revision, orientation: fit.orientation };
  t.info.name = `${track.info.name} @ ${venue.info.name}`;
  t.info.status = "draft";
  t.id = opts.id ?? globalThis.crypto.randomUUID();
  t.revision = 1;
  return bake(t);
}

/**
 * A track's built geometry moved the way a fit result moves it (mirror, rotate, shift) — for drawing a fit in the
 * venue without re-baking. The adapted copy itself is re-baked from the moved design (adapt()).
 */
export function transformBuilt(b: Built, fit: Pick<FitResult, "rotation" | "mirror" | "shift">): Built {
  const tp = (x: number, z: number): Point2 => {
    const [a, c] = transformPt(x, z, fit.rotation, fit.mirror);
    return [a + fit.shift[0], c + fit.shift[1]];
  };
  const th = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    const [dx, dz] = transformPt(Math.cos(r), Math.sin(r), fit.rotation, fit.mirror);
    return ((Math.atan2(dz, dx) * 180) / Math.PI + 360) % 360;
  };
  const xz = ([x, z]: Point2) => ({ x, z });
  return {
    ...b,
    racingLine: b.racingLine.map(([x, z, w]) => [...tp(x, z), w] as [number, number, number]),
    dividers: b.dividers.map((d) => ({ ...d, points: d.points.map(([x, z]) => tp(x, z)) })),
    features: b.features.map((f) => ({ ...f, ...xz(tp(f.x, f.z)), heading: th(f.heading) })),
    startLine: { ...b.startLine, ...xz(tp(b.startLine.x, b.startLine.z)), heading: th(b.startLine.heading) },
    checks: b.checks.map((c) => (c.x !== undefined && c.z !== undefined ? { ...c, ...xz(tp(c.x, c.z)) } : c)),
  };
}

/** The track drawn where a fit puts it in the venue (venue area, obstacles and rostrum), for previews. */
export function fittedPreviewDoc(track: RcTrack, venue: RcVenue, fit: FitResult): RcTrack {
  if (!track.built) throw new Error("fittedPreviewDoc: track has no built section");
  const placed = transformBuilt(track.built, fit);
  const side = venue.rostrum?.side ?? "south";
  const [rx, rz] = rostrumPosition(venue.area, side, venue.rostrum?.offset ?? 0);
  return {
    ...track,
    info: { ...track.info, name: `${track.info.name} · ${fit.orientation} in ${venue.info.name}` },
    area: { ...venue.area },
    obstacles: venue.obstacles ?? [],
    built: { ...placed, rostrum: { ...placed.rostrum, side, x: rx, z: rz } },
  };
}
