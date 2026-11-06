// "Will it fit my venue?" search, the venue checks and adapt. A port of reference/fit.py. Pure: no DOM, no Node APIs.
import { bake, borders, EYE_HEIGHT, FOOT_CELL, laneMask, obstacleMask, racingLine, rostrumPosition, upgradeTrack } from "./bake.js";
import { pyRound, pyRoundInt, r3, radians } from "./num.js";
import type { PlanScene } from "./plan.js";
import type { BuiltRostrum, Built, Check, FitResult, ForumVenueRef, Point2, RcTrack, RcVenue, VenueCheck, VenueRef } from "./types.js";

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

/** Where the venue's rostrum stands. */
export function venueRostrumOf(venue: Pick<RcVenue, "area" | "rostrum">): BuiltRostrum {
  const side = venue.rostrum?.side ?? "south";
  const [x, z] = rostrumPosition(venue.area, side, venue.rostrum?.offset ?? 0.0);
  return { side, x: r3(x), z: r3(z), eyeHeight: EYE_HEIGHT };
}

/**
 * The layout where it is drawn (venue coordinates) against the venue (v1.7: these were built.checks): the lanes going
 * outside the venue's area (`outside-area`), the lanes + pipe thickness over a fixed obstacle (`obstacle`), and where
 * the venue's rostrum stands. Reads `design` (it's the designer's and the fit's), like fits().
 */
export function venueCheck(track: Pick<RcTrack, "design">, venue: RcVenue): VenueCheck {
  const pts = track.design.points;
  const L = venue.area.length, W = venue.area.width;
  const { line, corners } = racingLine(pts, track.design.laneWidth ?? 2.0);
  const checks: Check[] = [];
  const e = borders(line, corners, pts);
  outer: for (const [ex, ez] of [[e.rx, e.rz], [e.lx, e.lz]]) {
    for (let i = 0; i < line.n; i++) {
      if (Math.abs(ex[i]) > L / 2 + 0.01 || Math.abs(ez[i]) > W / 2 + 0.01) {
        checks.push({ level: "error", code: "outside-area", x: r3(ex[i]), z: r3(ez[i]), message: "Track goes outside the venue's track area" });
        break outer;
      }
    }
  }
  if (venue.obstacles?.length) {
    const fp = laneMask(line, corners, pts);
    const om = obstacleMask(venue.obstacles, fp.origin, fp.rows, fp.cols);
    const hit = fp.mask.findIndex((v, k) => v === 1 && om[k] === 1);
    if (hit >= 0) {
      const row = Math.floor(hit / fp.cols), col = hit % fp.cols;
      checks.push({ level: "error", code: "obstacle", x: r3(fp.origin[0] + (col + 0.5) * FOOT_CELL), z: r3(fp.origin[1] + (row + 0.5) * FOOT_CELL), message: "Track overlaps a fixed obstacle" });
    }
  }
  return { checks, rostrum: venueRostrumOf(venue) };
}

export interface AdaptOptions {
  /** id for the new track; default crypto.randomUUID() */
  id?: string;
}

/**
 * A template's forum link as a track's `info.venue` ({id, name}, rctrack): the forum track (rcvenue 1.1) stays on the
 * template. fit.py copies the whole object; the two agree on every 1.0 template, and `built` doesn't depend on it.
 */
export function trackVenueRef(v: ForumVenueRef | null | undefined): VenueRef | null {
  return v ? ({ id: v.id, ...(v.name !== undefined ? { name: v.name } : {}) } as VenueRef) : null;
}

/**
 * An adapted copy of the track for the venue, in the chosen fit's orientation and position, re-baked. v1.7: nothing of
 * the venue is copied in but its area (as the drawing area) and the "drawn for" label — no obstacles, no rostrum.
 */
export function adapt(track: RcTrack, venue: RcVenue, fit: FitResult, opts: AdaptOptions = {}): RcTrack {
  const t: RcTrack = structuredClone(upgradeTrack(track));
  for (const p of t.design.points) {
    const [x, z] = transformPt(p.x, p.z, fit.rotation, fit.mirror);
    p.x = pyRound(x + fit.shift[0], 3);
    p.z = pyRound(z + fit.shift[1], 3);
  }
  t.area = { ...venue.area };
  t.info.drawnFor = { venueTemplate: venue.id, name: venue.info.name };
  t.info.venue = trackVenueRef(venue.info.venue);
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
    ...(b.lanes ? { lanes: { right: b.lanes.right.map(([x, z]) => tp(x, z)), left: b.lanes.left.map(([x, z]) => tp(x, z)) } } : {}),
    features: b.features.map((f) => ({ ...f, ...xz(tp(f.x, f.z)), heading: th(f.heading) })),
    ...(b.crossings ? { crossings: b.crossings.map((c) => ({ ...c, ...xz(tp(c.x, c.z)), footprint: c.footprint && c.footprint.map(([x, z]) => tp(x, z)) })) } : {}),
    startLine: { ...b.startLine, ...xz(tp(b.startLine.x, b.startLine.z)), heading: th(b.startLine.heading) },
    checks: b.checks.map((c) => (c.x !== undefined && c.z !== undefined ? { ...c, ...xz(tp(c.x, c.z)) } : c)),
  };
}

/** The track drawn where a fit puts it in the venue: the venue's area, obstacles and rostrum round the moved `built`. */
export function fittedScene(track: RcTrack, venue: RcVenue, fit: FitResult): PlanScene {
  if (!track.built) throw new Error("fittedScene: track has no built section");
  return { area: { ...venue.area }, obstacles: venue.obstacles ?? [], rostrum: venueRostrumOf(venue), built: transformBuilt(track.built, fit) };
}
