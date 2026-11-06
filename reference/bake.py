#!/usr/bin/env python3
"""
Reference implementation of the rctrack geometry engine (format v1.7).
Reads a track file, (re)computes the "built" section from "design", writes it back.
The web designer (TypeScript) and the sim (C#) must produce the same results as this file:
the example tracks in examples/ double as test fixtures.

usage: python3 bake.py in.json [out.json]
"""
import json, math, sys
import numpy as np

GENERATOR = "rctrack-bake.py 1.8"
SAMPLE = 0.05          # internal sampling (m)
EXPORT_STEP = 0.25     # racing line export spacing (m)
MERGE_GAP = 0.6        # borders closer than this (from different parts of the track) are merged...
MERGE_FULL = 0.2       # ...fully below this, blended in between
MERGE_MIN_SEP = 3.0    # ...but only if they are this far apart along the track
MERGE_PARALLEL = 0.9   # ...and run roughly parallel (|cos| of the angle between them)
SIMPLIFY_TOL = 0.02    # divider polyline simplification tolerance (m)
MERGE_BLEND = 4        # shared <-> separate transitions are blended over this many samples either side (~0.4 m in all)
MIN_DIVIDER = 0.25     # divider fragments shorter than this (m) are dropped
BLEND_BREAK = math.radians(30)  # blending never reaches across a border turning more than this between samples (a corner)
COVERED = 0.06         # a divider end lying within this (m) of a longer divider is already drawn by it: trimmed
SQUARE_MAX_TURN = math.radians(120)    # square outer corners turning more than this get a bevel, not a mitre spike:
BEVEL_DIST = 1 / math.cos(math.radians(60))  # cut square to the bisector at (r + width/2) / cos(60°) from the arc centre —
                                             # as far out as a 120° mitre reaches (r = 0: width/2 / cos 60° from the point)
MIN_RADIUS = 0.6       # tightest racing-line radius a 1/10 buggy can follow (m)
MIN_WIDTH = 1.4        # narrowest sensible lane (m)
CORNER_MIN_TURN = math.radians(20)   # smaller changes of direction aren't corners
CORNER_JOIN_GAP = 3.0  # same-direction turns joined by less straight than this (m) are one corner (hairpins, carousels).
                       # The one setting for the corner count; the TypeScript engine has the same constant.
CROSSOVER_RAMP = 2.0   # crossover (bridge) defaults: ramp up / down along the over pass (m)...
CROSSOVER_HEIGHT = 0.4 # ...and the height of its flat top (m)
BRIDGE_CLEARANCE = 0.4 # a bridge lower than this (m) doesn't bridge: cars can't pass under
BRIDGE_MARGIN = 1.0    # a bridge's flat top spans the under pass's lane plus this each side (m)
CROSSING_MIN_ANGLE = 60.0  # crossings sharper than this (deg; i.e. outside 60-120° between the passes) are warned about
CROSSING_MIN_SEP = 1.0 # the racing line crossing itself less than this far along the lap is numerical noise, not a crossing
CROSSING_ZONE = 0.2    # divider self-crossings this close to where two lanes cross (m) are the crossing, not a loop to cut

FEATURE_PROFILES = {   # along-track distance (m), height (m), for default length/height; scaled to the feature's values
    "tabletop": [[0, 0], [0.70, 1], [1.50, 1], [2.20, 0]],
    "double":   [[0, 0], [0.55, 1], [0.85, 0], [1.75, 0], [2.05, 1], [2.60, 0]],
    "kicker":   [[0, 0], [0.60, 1], [0.80, 0]],
    "stepup":   [[0, 0], [0.60, 1], [1.60, 1], [1.60, 0.0]],
    "stepdown": [[0, 0], [0.0, 1], [1.0, 1], [1.80, 0]],
    "whoops":   [[0, 0], [0.30, 1], [0.60, 0], [0.90, 1], [1.20, 0], [1.50, 1], [1.80, 0]],
    "bump":     [[0, 0], [0.25, 1], [0.50, 0]],
    "crossover": [[0, 0], [2.0, 1], [6.0, 1], [8.0, 0]],   # nominal; the bake sizes each one (crossover_profile)
}
FEATURE_DEFAULTS = {"tabletop": (2.2, 0.14), "double": (2.6, 0.15), "kicker": (0.8, 0.12), "stepup": (1.6, 0.12),
                    "stepdown": (1.8, 0.12), "whoops": (1.8, 0.05), "bump": (0.5, 0.04), "crossover": (8.0, CROSSOVER_HEIGHT)}

def r3(v): return round(float(v), 3)

# ------------------------------------------------------------------ racing line
def racing_line(points, default_width):
    """Closed polyline through the corner points, each corner filleted with its radius.
    Returns samples [x, z, width, curvature(1/r, signed: + left)] and the corner info."""
    n = len(points)
    P = np.array([[p["x"], p["z"]] for p in points], float)
    W = [p.get("width", default_width) for p in points]
    corners = []
    for i in range(n):
        a = P[i] - P[i - 1]; b = P[(i + 1) % n] - P[i]
        la, lb = np.linalg.norm(a), np.linalg.norm(b)
        a, b = a / la, b / lb
        cross = a[0] * b[1] - a[1] * b[0]
        th = math.acos(float(np.clip(a @ b, -1, 1)))
        r = float(points[i].get("radius", 1.0))
        t = r * math.tan(th / 2) if th > 1e-6 else 0.0     # length the corner takes from each straight
        corners.append(dict(r=r, t=t, sign=1 if cross > 0 else -1, a=a, b=b, th=th))
    # each straight (corner i to i+1) is shared by what the two corners ask for; if they ask for more than its length,
    # each gets its share in proportion. A corner keeps the smaller of its two shares (rctrack 1.5)
    share = []
    for i in range(n):
        need = corners[i]["t"] + corners[(i + 1) % n]["t"]; L = float(np.linalg.norm(P[(i + 1) % n] - P[i]))
        share.append(L / need if need > L else 1.0)
    for i, c in enumerate(corners):
        f = min(share[i - 1], share[i])
        if f < 1.0 and c["t"] > 0:         # radius too big for the straights either side: shrink it
            c["t"] *= f; c["r"] = c["t"] / math.tan(c["th"] / 2)
        t = c.pop("t"); c.update(start=P[i] - c["a"] * t, end=P[i] + c["b"] * t)
    out = []
    for i in range(n):
        c = corners[i]
        c.update(P=P[i], w=W[i], arc0=len(out), m=0)   # arc samples: arc0 .. arc0+m-1
        if c["th"] > 1e-6 and c["r"] > 0:
            nrm = np.array([-c["a"][1], c["a"][0]]) * c["sign"]
            ctr = c["start"] + nrm * c["r"]
            a0 = math.atan2(*(c["start"] - ctr)[::-1]); a1 = math.atan2(*(c["end"] - ctr)[::-1])
            da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
            m = max(2, int(abs(da) * c["r"] / SAMPLE))
            c["m"] = m
            for k in range(m):
                ang = a0 + da * k / m
                out.append([ctr[0] + c["r"] * math.cos(ang), ctr[1] + c["r"] * math.sin(ang), W[i], c["sign"] / c["r"]])
        nxt = corners[(i + 1) % n]["start"]
        L = np.linalg.norm(nxt - c["end"]); m = max(1, int(L / SAMPLE))
        c.update(str0=len(out), strn=m)                 # straight samples after the corner: str0 .. str0+strn-1
        w1 = W[(i + 1) % n]
        for k in range(m):
            q = c["end"] + (nxt - c["end"]) * k / m
            out.append([q[0], q[1], W[i] + (w1 - W[i]) * k / m, 0.0])
    return np.array(out), corners

def count_corners(corners, join_gap=CORNER_JOIN_GAP):
    """Corners as racers count them: every turn of more than CORNER_MIN_TURN, except that turns the same way joined
    by less than CORNER_JOIN_GAP of racing line (a hairpin, or turn - short straight - turn) count as one.
    A track that is one continuous same-direction turn counts as 1."""
    n = len(corners)
    sig = [i for i, c in enumerate(corners) if c["th"] > CORNER_MIN_TURN]
    if len(sig) < 2: return len(sig)
    straight = [math.dist(corners[i]["end"], corners[(i + 1) % n]["start"]) for i in range(n)]
    arc = [c["r"] * c["th"] for c in corners]
    links = 0
    for k, i in enumerate(sig):
        j = sig[(k + 1) % len(sig)]
        gap = straight[i]; m = (i + 1) % n          # racing line from the end of corner i to the start of corner j
        while m != j:
            gap += arc[m] + straight[m]; m = (m + 1) % n
        if corners[i]["sign"] == corners[j]["sign"] and gap < join_gap: links += 1
    return max(1, len(sig) - links)

def arclength(xy):
    d = np.linalg.norm(np.diff(np.vstack([xy, xy[:1]]), axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(d)])
    return s[:-1], s[-1]

def frame(xy):
    t = np.roll(xy, -1, 0) - np.roll(xy, 1, 0)
    t /= np.linalg.norm(t, axis=1)[:, None]
    left = np.stack([-t[:, 1], t[:, 0]], 1)
    return t, left

# ------------------------------------------------------------------ borders
def _left(d): return np.array([-d[1], d[0]])

def outer_normals(c):
    """Unit normals pointing to the outside of corner c, for its incoming and outgoing straights."""
    return -c["sign"] * _left(c["a"]), -c["sign"] * _left(c["b"])

def square_outline(c, hw):
    """Outer border of a square corner: from the incoming straight's outer edge to the mitre (where the two straights'
    outer offset lines meet), on to the outgoing straight's outer edge. Corners turning more than SQUARE_MAX_TURN are
    bevelled: cut square to the bisector at (r + hw) * BEVEL_DIST from the arc's centre."""
    o_a, o_b = outer_normals(c)
    P, a, b, half = c["P"], c["a"], c["b"], c["th"] / 2
    S = c["start"] + o_a * hw; E = c["end"] + o_b * hw
    if c["th"] <= SQUARE_MAX_TURN:
        return [S, P + o_a * hw + a * (hw * math.tan(half)), E]
    R = c["r"] + hw                      # the outer edge's distance from the arc centre
    s1 = (R * BEVEL_DIST - R * math.cos(half)) / math.sin(half)   # along each outer line from its tangent point
    return [S, S + a * s1, E - b * s1, E]

def spread(V, m):
    """m+1 points along polyline V (k = 0..m): V[0] at k=0, V[-1] at k=m, and each inner vertex exactly on the sample
    nearest its share of the length (skipped if there's no free sample for it); straight lines in between."""
    V = [np.asarray(v, float) for v in V]
    cum = [0.0]
    for p, q in zip(V, V[1:]): cum.append(cum[-1] + float(np.linalg.norm(q - p)))
    total = cum[-1] or 1.0
    keys = [(0, V[0])]
    for v in range(1, len(V) - 1):
        k = int(math.floor(cum[v] / total * m + 0.5))
        k = max(k, keys[-1][0] + 1)
        if k <= m - (len(V) - 1 - v): keys.append((k, V[v]))
    keys.append((m, V[-1]))
    out = []
    for (ka, pa), (kb, pb) in zip(keys, keys[1:]):
        for k in range(ka, kb): out.append(pa + (pb - pa) * ((k - ka) / (kb - ka)))
    out.append(V[-1])
    return out

def outer_style(point, c):
    """"square" or "round" for corner c: "auto" (the default) is square up to SQUARE_MAX_TURN, round beyond."""
    style = point.get("outer", "auto")
    if style == "auto": return "square" if c["th"] <= SQUARE_MAX_TURN else "round"
    return style

def lane_rings(R, L):
    """built.lanes: both lane edges as closed rings, simplified like the dividers (before any divider merging)."""
    def ring(B):
        pts = [B[0]]
        for p in B[1:]:
            if float(np.linalg.norm(p - pts[-1])) > 1e-6: pts.append(p)
        pts = np.array(pts + [pts[0]])
        simp = rdp(pts, SIMPLIFY_TOL)[:-1]
        return [[r3(x), r3(z)] for x, z in simp]
    return {"right": ring(R), "left": ring(L)}

def borders(line, corners, points, extra=0.0):
    """Both lane edges at every sample (right side, left side), offset by width/2 + extra.
    Straights: the racing line offset sideways. Corners: the inner edge follows the arc (radius r - width/2) or, where
    that is <= 0, collapses to the apex where the two straights' inner edges meet (straight samples that would pass it
    are held there); the outer edge follows the arc ("round") or meets in a square corner ("square", the default)."""
    xy = line[:, :2]; n = len(xy)
    t, left = frame(xy)
    hw = line[:, 2:3] / 2 + extra
    R = xy - left * hw; L = xy + left * hw
    for i, c in enumerate(corners):
        if not (c["th"] > 1e-6 and c["r"] > 0): continue
        a0, m, e = c["arc0"], c["m"], c["str0"] % n
        hwc = c["w"] / 2 + extra
        outer, inner = (R, L) if c["sign"] > 0 else (L, R)
        if outer_style(points[i], c) == "square":
            for k, q in enumerate(spread(square_outline(c, hwc), m)):
                outer[(a0 + k) % n] = q
        if c["r"] - hwc <= 1e-9:                          # (radius reduced to exactly half the lane counts)
            o_a, o_b = outer_normals(c)
            u = -(o_a + o_b); u = u / np.linalg.norm(u)
            half = c["th"] / 2
            Q = c["P"] + u * (hwc / max(math.cos(half), 0.05))   # where the straights' inner edges meet
            for k in range(m): inner[(a0 + k) % n] = Q
            prev = corners[i - 1]
            for k in range(prev["strn"]):                  # incoming straight, backwards from the corner
                j = (a0 - 1 - k) % n
                if float((inner[j] - Q) @ c["a"]) <= 0: break
                inner[j] = Q
            for k in range(c["strn"]):                     # outgoing straight
                j = (e + k) % n
                if float((inner[j] - Q) @ c["b"]) >= 0: break
                inner[j] = Q
    return R, L

def square_corner_polygons(line, corners, points, extra=0.0):
    """For the footprint: the outer half of each square corner out to the mitre (racing-line arc + outer outline)."""
    xy = line[:, :2]; n = len(xy); polys = []
    for i, c in enumerate(corners):
        if not (c["th"] > 1e-6 and c["r"] > 0) or outer_style(points[i], c) != "square": continue
        V = square_outline(c, c["w"] / 2 + extra)
        arc = [xy[(c["arc0"] + k) % n] for k in range(c["m"])]
        polys.append(np.array(V + [xy[c["str0"] % n]] + arc[::-1], float))
    return polys

# ------------------------------------------------------------------ dividers
def _nearest_on_segment(p, a, b):
    ab = b - a; L2 = float(ab @ ab)
    t = 0.0 if L2 == 0 else min(1.0, max(0.0, float((p - a) @ ab) / L2))
    return a + ab * t

def _breaks(Bs):
    """Samples where a (closed) border turns sharply: corners that blending must not reach across."""
    n = len(Bs); out = np.zeros(n, bool)
    for k in range(n):
        d0 = Bs[k] - Bs[k - 1]; d1 = Bs[(k + 1) % n] - Bs[k]
        l0, l1 = float(np.linalg.norm(d0)), float(np.linalg.norm(d1))
        if (l0 > 1e-9) != (l1 > 1e-9): out[k] = True     # entering / leaving a collapsed inside apex
        elif l0 > 1e-9 and float(d0 @ d1) / (l0 * l1) < math.cos(BLEND_BREAK): out[k] = True
    return out

def _blend(v, half, brk):
    """Moving average over up to +-half samples along a closed border, not reaching past a break (a corner)."""
    n = len(v); out = np.zeros_like(v)
    for i in range(n):
        lo = 0
        while lo < half and not brk[(i - lo) % n]: lo += 1
        hi = 0
        while hi < half and not brk[(i + hi) % n]: hi += 1
        out[i] = sum(v[(i + k) % n] for k in range(-lo, hi + 1)) / (lo + hi + 1)
    return out

def dividers(line, corners, points, zones=()):
    from scipy.spatial import cKDTree
    xy = line[:, :2]; n = len(xy)
    s, total = arclength(xy)
    t, left = frame(xy)
    R, L = borders(line, corners, points)
    B = np.concatenate([R, L])                                           # right side then left side
    idx = np.concatenate([np.arange(n), np.arange(n)])
    tree = cKDTree(B)
    # each border's own direction (central difference); None where it has collapsed to a point (an inside apex)
    tb = np.zeros_like(B); has_dir = np.zeros(len(B), bool)
    for side in (0, 1):
        for k in range(n):
            i = side * n + k
            d = B[side * n + (k + 1) % n] - B[side * n + (k - 1) % n]; L = float(np.linalg.norm(d))
            if L > 1e-9: tb[i] = d / L; has_dir[i] = True
    disp = np.zeros_like(B); weight = np.zeros(len(B)); partner = -np.ones(len(B), int)
    for i, p in enumerate(B):
        # the 48 nearest within MERGE_GAP, ties broken by index (collapsed apexes put many samples on one spot, and
        # the partner's index decides which side draws a shared pipe: this must not depend on the tree's tie order)
        jj = np.array(tree.query_ball_point(p, MERGE_GAP), int)
        d2 = (B[jj, 0] - p[0]) ** 2 + (B[jj, 1] - p[1]) ** 2
        near = sorted((float(a), int(b)) for a, b in zip(d2, jj) if a < MERGE_GAP * MERGE_GAP)[:48]
        for _, j in near:
            if j == i: continue
            ds = abs(s[idx[i]] - s[idx[j]]); ds = min(ds, total - ds)
            if ds < MERGE_MIN_SEP: continue
            # only merge borders running alongside each other (a collapsed apex goes with anything)
            if has_dir[i] and has_dir[j] and abs(float(tb[i] @ tb[j])) < MERGE_PARALLEL: continue
            # the partner border's nearest point (on its segments either side of j), not just its nearest sample
            base = (j // n) * n; jn = j - base
            q = min((_nearest_on_segment(p, B[base + (jn + o) % n], B[base + (jn + o + 1) % n]) for o in (-1, 0)),
                    key=lambda q: float(np.linalg.norm(p - q)))
            w = float(np.clip((MERGE_GAP - float(np.linalg.norm(p - q))) / (MERGE_GAP - MERGE_FULL), 0, 1))
            disp[i] = ((p + q) / 2 - p) * w
            weight[i] = w; partner[i] = j
            break
    # blend in and out of shared sections, so a pipe peels away smoothly instead of kinking; corners stay sharp:
    # blending stops at them, and a corner vertex moves to where its two (moved) legs meet
    for side in (0, 1):
        sl = slice(side * n, (side + 1) * n)
        Bs = B[sl]; brk = _breaks(Bs)
        d_s = _blend(disp[sl], MERGE_BLEND, brk); w_s = _blend(weight[sl], MERGE_BLEND, brk)
        for k in np.flatnonzero(brk):
            a, b = (k - 1) % n, (k + 1) % n
            e1 = Bs[k] - Bs[a]; e2 = Bs[b] - Bs[k]
            den = e1[0] * e2[1] - e1[1] * e2[0]
            if abs(den) > 1e-12:
                p1 = Bs[a] + d_s[a]; p2 = Bs[b] + d_s[b]; w_ = p2 - p1
                X = p1 + e1 * ((w_[0] * e2[1] - w_[1] * e2[0]) / den)
                d_s[k] = X - Bs[k]
            nb = a if w_s[a] >= w_s[b] else b
            w_s[k] = w_s[nb]; partner[side * n + k] = partner[side * n + nb]
        disp[sl] = d_s; weight[sl] = w_s
    merged = B + disp
    # A fully shared divider is generated once: only by the border with the lower index
    skip = (weight > 0.99) & (partner >= 0) & (partner < np.arange(len(B)))
    runs = []
    for side in (0, 1):
        Bs = merged[side * n:(side + 1) * n]; S = skip[side * n:(side + 1) * n]; Wt = weight[side * n:(side + 1) * n]
        # rotate so a run doesn't start in the middle
        start = int(np.argmax(S)) if S.any() and not S.all() else 0
        cur = []; shared = []
        for k in range(n + 1):
            i = (start + k) % n
            if k < n and not S[i]:
                cur.append(Bs[i]); shared.append(Wt[i] > 0.99)
            elif cur:
                if len(cur) > 1:
                    runs.append((np.array(cur), bool(np.mean(shared) > 0.5)))
                cur = []; shared = []
    simplified = []
    for pts, sh in runs:
        closed = len(pts) >= n and np.linalg.norm(pts[0] - pts[-1]) < 0.2
        simplified.append((remove_loops(list(rdp(pts, SIMPLIFY_TOL)), closed, zones), sh, closed))
    # longest first; ends already drawn by a longer divider are trimmed, fragments dropped (order of runs kept)
    order = sorted(range(len(simplified)), key=lambda k: -polyline_length(simplified[k][0], simplified[k][2]))
    kept = {}
    for k in order:
        pts, sh, closed = simplified[k]
        others = [kept[o][0] for o in kept]
        if not closed: pts = trim_covered(pts, others)
        if len(pts) < 2 or polyline_length(pts, closed) < MIN_DIVIDER: continue
        kept[k] = (pts, sh, closed)
    out = [{"shared": sh, "closed": bool(closed), "points": [[r3(x), r3(z)] for x, z in pts]} for k, (pts, sh, closed) in sorted(kept.items())]
    return out, merged, weight

def _dist_to_polyline(p, line):
    return min(float(np.linalg.norm(p - _nearest_on_segment(p, line[i], line[i + 1]))) for i in range(len(line) - 1))

def trim_covered(pts, others):
    """Drop end vertices of an open divider while the next one in also lies on another divider (within COVERED):
    that stretch is drawn already; the end left over touches the other pipe."""
    covered = lambda p: any(_dist_to_polyline(p, o) <= COVERED for o in others)
    while len(pts) > 2 and covered(pts[0]) and covered(pts[1]): pts = pts[1:]
    while len(pts) > 2 and covered(pts[-1]) and covered(pts[-2]): pts = pts[:-1]
    if len(pts) == 2 and covered(pts[0]) and covered(pts[1]): return []
    return pts

def polyline_length(pts, closed=False):
    L = sum(float(np.linalg.norm(np.asarray(q) - np.asarray(p))) for p, q in zip(pts, pts[1:]))
    return L + (float(np.linalg.norm(np.asarray(pts[0]) - np.asarray(pts[-1]))) if closed and len(pts) > 2 else 0.0)

def _cross(p1, p2, p3, p4):
    """Where segments p1-p2 and p3-p4 cross (strictly inside both), else None."""
    d1 = p2 - p1; d2 = p4 - p3
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-12: return None
    w = p3 - p1
    ta = (w[0] * d2[1] - w[1] * d2[0]) / den; tb = (w[0] * d1[1] - w[1] * d1[0]) / den
    if 1e-9 < ta < 1 - 1e-9 and 1e-9 < tb < 1 - 1e-9: return p1 + d1 * ta
    return None

def in_zone(X, zones):
    """Is X where two lanes of the track cross (crossing_zones)? There a divider crossing itself is the crossing."""
    for C, t1, h1, t2, h2 in zones:
        d = X - C
        if abs(d[0] * t1[1] - d[1] * t1[0]) <= h1 and abs(d[0] * t2[1] - d[1] * t2[0]) <= h2: return True
    return False

def remove_loops(pts, closed, zones=()):
    """Cut out self-crossings. A closed divider keeps the longer of its two parts. An open one is split at the crossing
    into head, loop and tail, and loses the shortest: a small kink loses its loop, an end poking past a junction loses
    that stub, and the rest of the pipe stays. Crossings inside a zone where the track crosses itself stay (v1.6)."""
    pts = [np.asarray(p, float) for p in pts]
    for _ in range(100):
        n = len(pts); segs = n if closed else n - 1; hit = None
        for a in range(segs):
            for b in range(a + 2, segs):
                if closed and a == 0 and b == segs - 1: continue
                X = _cross(pts[a], pts[(a + 1) % n], pts[b], pts[(b + 1) % n])
                if X is not None and not in_zone(X, zones): hit = (a, b, X); break
            if hit: break
        if not hit: break
        a, b, X = hit
        head = pts[:a + 1] + [X]; loop = [X] + pts[a + 1:b + 1] + [X]; tail = [X] + pts[b + 1:]
        if closed:
            pts = loop[:-1] if polyline_length(loop) > polyline_length(pts[:a + 1] + [X] + pts[b + 1:], True) else pts[:a + 1] + [X] + pts[b + 1:]
            continue
        lh, ll, lt = polyline_length(head), polyline_length(loop), polyline_length(tail)
        if ll <= lh and ll <= lt: pts = head + tail[1:]
        elif lh <= lt: pts = loop + tail[1:]
        else: pts = head + loop[1:]
    return tidy_ends(pts, closed)

def tidy_ends(pts, closed):
    """Drop repeated points, and short end segments that double back (> 120°) at a junction."""
    out = [pts[0]]
    for p in pts[1:]:
        if float(np.linalg.norm(p - out[-1])) > 1e-6: out.append(p)
    if closed: return out
    def doubles_back(a, b, c):   # b->c turns back on a->b
        u = b - a; v = c - b; lu, lv = float(np.linalg.norm(u)), float(np.linalg.norm(v))
        return lv < MIN_DIVIDER and lu > 1e-9 and float(u @ v) / (lu * lv) < math.cos(math.radians(120))
    while len(out) >= 3 and doubles_back(out[-3], out[-2], out[-1]): out = out[:-1]
    while len(out) >= 3 and doubles_back(out[2], out[1], out[0]): out = out[1:]
    return out

def rdp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    ab = b - a; L = np.linalg.norm(ab)
    if L < 1e-9: d = np.linalg.norm(pts - a, axis=1)
    else: d = np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / L
    i = int(np.argmax(d))
    if d[i] > tol:
        return np.vstack([rdp(pts[:i + 1], tol)[:-1], rdp(pts[i:], tol)])
    return np.array([a, b])

# ------------------------------------------------------------------ features, start, checks
def at_distance(xy, s, total, d):
    d %= total
    i = int(np.searchsorted(s, d, side="right") - 1)
    j = (i + 1) % len(xy)
    seg = xy[j] - xy[i]; L = np.linalg.norm(seg) or 1.0
    p = xy[i] + seg * ((d - s[i]) / L)
    return p, seg / L, i

VERTEX_EPS = 1e-6      # a lap distance this close (m) to a racing-line sample is on it

def tangent_at(line, s, total, d):
    """Direction of travel at lap distance d (1.8, the start line): the segment's, except on a sample. A start at a
    corner join (where an arc meets a straight) sits on a sample, and the segment after it is the arc one way round and
    the straight the other. There it is the true tangent: each segment is a chord of a straight or an arc (curvature
    line[k, 3] for the one from sample k), so it turns either way from the tangent by half the angle it subtends; the
    mean of the two segments' estimates is exact at a join or on an arc, and the same both ways round."""
    xy = line[:, :2]
    _, t, i = at_distance(xy, s, total, d)
    d %= total; n = len(xy)
    if d - s[i] < VERTEX_EPS: k = i
    elif (s[i + 1] if i + 1 < n else total) - d < VERTEX_EPS: k = (i + 1) % n
    else: return t
    a, b = xy[k] - xy[k - 1], xy[(k + 1) % n] - xy[k]
    la, lb = np.linalg.norm(a), np.linalg.norm(b)
    ta = math.atan2(a[1], a[0]) + math.asin(float(np.clip(line[k - 1, 3] * la / 2, -1, 1)))     # at the end of a
    tb = math.atan2(b[1], b[0]) - math.asin(float(np.clip(line[k, 3] * lb / 2, -1, 1)))         # at the start of b
    u = np.array([math.cos(ta) + math.cos(tb), math.sin(ta) + math.sin(tb)])
    return u / (np.linalg.norm(u) or 1.0)

def heading_deg(t): return r3((math.degrees(math.atan2(t[1], t[0])) + 360) % 360)

FOOT_CELL = 0.1        # footprint raster cell (m)
PIPE_R = 0.04          # half the pipe thickness, added round the lanes

def lane_mask(line, corners, points, cell=FOOT_CELL, origin=None, shape=None, extra=PIPE_R):
    """Raster of the area covered by lanes (plus pipe thickness): discs along the racing line, plus the outer half of
    every square corner out to its mitre. Returns mask, origin(x0,z0)."""
    xy = line[:, :2]; hw = line[:, 2] / 2 + extra
    polys = square_corner_polygons(line, corners, points, extra)
    if origin is None:
        lo = xy.min(0) - hw.max() - cell; hi = xy.max(0) + hw.max() + cell
        for poly in polys: lo = np.minimum(lo, poly.min(0) - cell); hi = np.maximum(hi, poly.max(0) + cell)
        origin = lo; shape = (int(np.ceil((hi[1] - lo[1]) / cell)), int(np.ceil((hi[0] - lo[0]) / cell)))
    m = np.zeros(shape, bool)
    for (x, z), r in zip(xy[::2], hw[::2]):
        c0 = int((x - r - origin[0]) / cell); c1 = int((x + r - origin[0]) / cell) + 1
        r0 = int((z - r - origin[1]) / cell); r1 = int((z + r - origin[1]) / cell) + 1
        c0, r0 = max(c0, 0), max(r0, 0); c1, r1 = min(c1, shape[1]), min(r1, shape[0])
        if c0 >= c1 or r0 >= r1: continue
        cx = origin[0] + (np.arange(c0, c1) + 0.5) * cell; cz = origin[1] + (np.arange(r0, r1) + 0.5) * cell
        d2 = (cx[None, :] - x) ** 2 + (cz[:, None] - z) ** 2
        m[r0:r1, c0:c1] |= d2 <= r * r
    for poly in polys:
        lo = poly.min(0); hi = poly.max(0)
        c0 = max(int((lo[0] - origin[0]) / cell), 0); c1 = min(int((hi[0] - origin[0]) / cell) + 1, shape[1])
        r0 = max(int((lo[1] - origin[1]) / cell), 0); r1 = min(int((hi[1] - origin[1]) / cell) + 1, shape[0])
        if c0 >= c1 or r0 >= r1: continue
        X, Z = np.meshgrid(origin[0] + (np.arange(c0, c1) + 0.5) * cell, origin[1] + (np.arange(r0, r1) + 0.5) * cell)
        m[r0:r1, c0:c1] |= inside_polygon(X, Z, poly)
    return m, origin

def inside_polygon(X, Z, poly):
    """Even-odd test of cell centres against a polygon."""
    inside = np.zeros(X.shape, bool); j = len(poly) - 1
    with np.errstate(divide="ignore", invalid="ignore"):
        for i in range(len(poly)):
            xi, zi = poly[i]; xj, zj = poly[j]
            inside ^= ((zi > Z) != (zj > Z)) & (X < (xj - xi) * (Z - zi) / (zj - zi) + xi)
            j = i
    return inside

def obstacle_mask(obstacles, origin, shape, cell=FOOT_CELL):
    m = np.zeros(shape, bool)
    cx = origin[0] + (np.arange(shape[1]) + 0.5) * cell; cz = origin[1] + (np.arange(shape[0]) + 0.5) * cell
    X, Z = np.meshgrid(cx, cz)
    for o in obstacles or []:
        if o["type"] == "circle":
            m |= (X - o["x"]) ** 2 + (Z - o["z"]) ** 2 <= o["radius"] ** 2
        else:   # rect, optional rotation (deg)
            a = math.radians(o.get("rotation", 0)); dx, dz = X - o["x"], Z - o["z"]
            u = dx * math.cos(a) + dz * math.sin(a); v = -dx * math.sin(a) + dz * math.cos(a)
            m |= (np.abs(u) <= o["length"] / 2) & (np.abs(v) <= o["width"] / 2)
    return m

def rle(mask):
    """Row-major run-length string of a bool mask: alternating run lengths starting with False."""
    flat = mask.ravel(); runs = []; cur = False; n = 0
    for v in flat:
        if v == cur: n += 1
        else: runs.append(n); cur = v; n = 1
    runs.append(n)
    return " ".join(map(str, runs))

# ------------------------------------------------------------------ crossings (v1.6)
def self_crossings(xy, s, total):
    """Where the closed racing line crosses itself: [(X, d, t, i)] with both passes' lap distances d (from point 0),
    unit directions t and segment indices i, in the order the segments come in the line."""
    n = len(xy); P = xy; D = np.roll(xy, -1, 0) - xy
    lo = np.minimum(P, P + D); hi = np.maximum(P, P + D)
    seg = np.linalg.norm(D, axis=1)
    found = []
    for i in range(n - 2):
        j = np.arange(i + 2, n - 1 if i == 0 else n)          # not the segment itself or its neighbours
        j = j[(lo[j, 0] <= hi[i, 0]) & (hi[j, 0] >= lo[i, 0]) & (lo[j, 1] <= hi[i, 1]) & (hi[j, 1] >= lo[i, 1])]
        if not len(j): continue
        den = D[i, 0] * D[j, 1] - D[i, 1] * D[j, 0]
        w = P[j] - P[i]
        ok = np.abs(den) > 1e-12; den = np.where(ok, den, 1.0)
        ta = (w[:, 0] * D[j, 1] - w[:, 1] * D[j, 0]) / den; tb = (w[:, 0] * D[i, 1] - w[:, 1] * D[i, 0]) / den
        # each segment owns its start, not its end, so a crossing on a sample is found once
        hit = ok & (ta >= -1e-9) & (ta < 1 - 1e-9) & (tb >= -1e-9) & (tb < 1 - 1e-9)
        for k in np.flatnonzero(hit):
            jk = int(j[k])
            X = P[i] + D[i] * ta[k]
            da = float(s[i] + ta[k] * seg[i]); db = float(s[jk] + tb[k] * seg[jk])
            sep = abs(db - da); sep = min(sep, total - sep)
            if sep < CROSSING_MIN_SEP: continue
            if any(float(np.linalg.norm(X - f[0])) < 1e-3 for f in found): continue
            found.append((X, (da % total, db % total), (D[i] / seg[i], D[jk] / seg[jk]), (i, jk)))
    return found

def cyc(a, b, total):
    """Signed distance from b to a along a closed lap, in (-total/2, total/2]."""
    d = (a - b) % total
    return d - total if d > total / 2 else d

def bridge_span(c, over):
    """Flat-top length a bridge on pass `over` (0 = first, 1 = second) needs: the under pass's lane, crossed at the
    crossing's angle, plus BRIDGE_MARGIN each side."""
    w_under = c["w"][1 - over]
    return w_under / max(math.sin(math.radians(c["angle"])), 0.1) + 2 * BRIDGE_MARGIN

def crossover_size(f, top_default):
    """(ramp, top, height) of a crossover feature: its own values, else the defaults."""
    return (float(f.get("rampLength", CROSSOVER_RAMP)), float(f.get("topLength", top_default)),
            float(f.get("height", CROSSOVER_HEIGHT)))

def crossover_profile(ramp, top, height):
    return [[r3(0), r3(0)], [r3(ramp), r3(height)], [r3(ramp + top), r3(height)], [r3(2 * ramp + top), r3(0)]]

def rect(x, z, heading, length, width):
    """Corners of a length x width rectangle centred on (x, z), its length along `heading` (deg)."""
    a = math.radians(heading); u = np.array([math.cos(a), math.sin(a)]); v = np.array([-u[1], u[0]]); c = np.array([x, z])
    return [c - u * length / 2 - v * width / 2, c + u * length / 2 - v * width / 2,
            c + u * length / 2 + v * width / 2, c - u * length / 2 + v * width / 2]

def rects_overlap(A, B):
    """Separating-axis test for two convex quadrilaterals."""
    for poly in (A, B):
        for k in range(4):
            e = poly[(k + 1) % 4] - poly[k]; ax = np.array([-e[1], e[0]])
            pa = [float(p @ ax) for p in A]; pb = [float(p @ ax) for p in B]
            if max(pa) <= min(pb) + 1e-9 or max(pb) <= min(pa) + 1e-9: return False
    return True

def find_crossings(line, s, total, design):
    """The racing line's self-crossings, each pass labelled first / second in driving order from the start line."""
    sd = design.get("start", {}).get("distance", 0.0)
    out = []
    for X, d, t, i in self_crossings(line[:, :2], s, total):
        if (d[1] - sd) % total < (d[0] - sd) % total: d, t, i = d[::-1], t[::-1], i[::-1]
        angle = math.degrees(math.acos(abs(float(np.clip(t[0] @ t[1], -1, 1)))))   # 0..90°, 90 = square
        out.append(dict(X=X, d=d, t=t, w=(float(line[i[0], 2]), float(line[i[1], 2])), angle=angle,
                        bridge=None, over=None, claim=None, why=None, low=None))
    out.sort(key=lambda c: (c["d"][0] - sd) % total)
    return out

def crossing_zones(cr):
    """Where the lanes of each crossing overlap (plus CROSSING_ZONE): (centre, t1, half-width 1, t2, half-width 2)."""
    return [(c["X"], c["t"][0], c["w"][0] / 2 + CROSSING_ZONE, c["t"][1], c["w"][1] / 2 + CROSSING_ZONE) for c in cr]

def bridge_crossings(cr, features, total):
    """Which feature bridges each crossing. A crossover claims the nearest unclaimed crossing within half its length of
    either pass's distance and goes over pass `over` (default first); a tabletop on a pass bridges the crossing if its
    flat top spans bridge_span. Either must be at least BRIDGE_CLEARANCE high; one that is in place and long enough but
    lower sets the crossing's `low` (crossing-too-low). Crossovers that bridge the crossing they find claim first (in
    feature order), then the rest, so a low or short one can't lock out a good one. Returns {feature index: (crossing,
    over)} for the crossovers that claimed one."""
    claimed = {}
    for sound in (True, False):
        for fi, f in enumerate(features):
            if f["type"] != "crossover" or fi in claimed: continue
            over = 1 if f.get("over", "first") == "second" else 0
            best = None
            for c in cr:
                if c["claim"] is not None: continue
                ramp, top, _ = crossover_size(f, bridge_span(c, over))
                gap = min(abs(cyc(f["distance"], c["d"][p], total)) for p in (0, 1))
                if gap <= ramp + top / 2 and (best is None or gap < best[0]): best = (gap, c, top)
            if best is None: continue
            _, c, top = best; height = crossover_size(f, top)[2]
            short = top < bridge_span(c, over) - 1e-9; low = height < BRIDGE_CLEARANCE - 1e-9
            if sound and (short or low): continue
            claimed[fi] = (c, over); c["claim"] = fi
            if short: c["why"] = f"the crossover's flat top is {top:.1f} m; it needs {bridge_span(c, over):.1f} m"
            elif low: c["low"] = too_low("crossover", f["distance"], height)
            else: c["bridge"] = fi; c["over"] = over
    prof = FEATURE_PROFILES["tabletop"]; top0, top1 = prof[1][0] / prof[-1][0], prof[2][0] / prof[-1][0]
    for c in cr:
        if c["bridge"] is not None: continue
        for fi, f in enumerate(features):
            if f["type"] != "tabletop": continue
            L = float(f.get("length", FEATURE_DEFAULTS["tabletop"][0]))
            for p in (0, 1):
                off = cyc(c["d"][p], f["distance"], total)        # crossing, from the tabletop's centre
                if abs(off) > L / 2: continue
                need = bridge_span(c, p)
                if -L / 2 + top0 * L <= off - need / 2 + 1e-9 and off + need / 2 <= -L / 2 + top1 * L + 1e-9:
                    H = float(f.get("height", FEATURE_DEFAULTS["tabletop"][1]))
                    if H >= BRIDGE_CLEARANCE - 1e-9: c["bridge"] = fi; c["over"] = p; c["why"] = None; c["low"] = None; break
                    if c["low"] is None: c["low"] = too_low("tabletop", f["distance"], H)
                elif c["why"] is None:
                    c["why"] = f"the tabletop at {f['distance']:.1f} m is too short to bridge it (flat top needs {need:.1f} m)"
            if c["bridge"] is not None: break
    return claimed

def too_low(typ, distance, height):
    return f"The {typ} at {distance:.1f} m is {height:.2f} m high; cars need {BRIDGE_CLEARANCE:.2f} m to pass under"

def crossing_checks(cr, built_feats, design, total, checks):
    """crossing-unbridged (or crossing-too-low), crossing-angle and crossing-too-close; returns built.crossings."""
    W0 = design.get("laneWidth", 2.0); out = []; foot = []
    for c in cr:
        X = c["X"]; da, db = c["d"]
        if c["bridge"] is None and c["low"] is not None:   # in place and long enough, but cars can't pass under
            checks.append({"level": "error", "code": "crossing-too-low", "x": r3(X[0]), "z": r3(X[1]), "message": c["low"]})
        elif c["bridge"] is None:
            checks.append({"level": "error", "code": "crossing-unbridged", "x": r3(X[0]), "z": r3(X[1]),
                           "message": f"Track crosses itself at {da:.1f} m and {db:.1f} m with no bridge" + (f": {c['why']}" if c["why"] else "")})
        if c["angle"] < CROSSING_MIN_ANGLE:
            checks.append({"level": "warning", "code": "crossing-angle", "x": r3(X[0]), "z": r3(X[1]),
                           "message": f"Track crosses itself at {c['angle']:.0f}°, more than {90 - CROSSING_MIN_ANGLE:.0f}° off square"})
        if c["bridge"] is not None:
            bf = built_feats[c["bridge"]]
            R = rect(bf["x"], bf["z"], bf["heading"], bf["length"], bf["width"])
        else:   # where a default crossover on the first pass would stand
            R = rect(X[0], X[1], heading_deg(c["t"][0]), 2 * CROSSOVER_RAMP + bridge_span(c, 0), c["w"][0])
        foot.append(R)
        out.append({"x": r3(X[0]), "z": r3(X[1]), "distances": [r3(da), r3(db)], "angle": r3(c["angle"]),
                    "over": None if c["over"] is None else ("first", "second")[c["over"]],
                    "bridge": None if c["bridge"] is None else {"type": design["features"][c["bridge"]]["type"], "feature": c["bridge"]},
                    "footprint": None if c["bridge"] is None else [[r3(p[0]), r3(p[1])] for p in R]})
    for a in range(len(cr)):
        for b in range(a + 1, len(cr)):
            if rects_overlap(foot[a], foot[b]):
                X = (cr[a]["X"] + cr[b]["X"]) / 2
                checks.append({"level": "error", "code": "crossing-too-close", "x": r3(X[0]), "z": r3(X[1]),
                               "message": f"Crossings at {cr[a]['d'][0]:.1f} m and {cr[b]['d'][0]:.1f} m are too close for a bridge each"})
    return out

FEATURE_LABEL = {"tabletop": "Tabletop", "double": "Double", "kicker": "Kicker", "stepup": "Step-up", "stepdown": "Step-down",
                 "whoops": "Whoops", "bump": "Bump"}

def feature_in_corner(typ, dist, p):
    """The feature-in-corner check. 1.8: a jump on or landing into a corner is a technical section racers enjoy, so it
    is info; a crossover's ramps need straight track (Crossings), so for it this stays a warning."""
    if typ == "crossover":
        return {"level": "warning", "code": "feature-in-corner", "x": r3(p[0]), "z": r3(p[1]),
                "message": f"crossover at {dist:.1f} m is on or lands into a corner"}
    return {"level": "info", "code": "feature-in-corner", "x": r3(p[0]), "z": r3(p[1]),
            "message": f"{FEATURE_LABEL[typ]} at {dist:.1f} m is on or lands into a corner (technical section)"}

VENUE_CHECKS = ("outside-area", "obstacle")   # 1.7: checks against a venue belong to the fit (fit.check), not the layout

def upgrade(doc, venue_name=None):
    """Load a file written before 1.7: a layout belongs to no venue. Drops `obstacles`, `design.rostrum`,
    `built.rostrum` and the venue checks; `basedOn` becomes `info.drawnFor` (named `venue_name`, else the forum venue's
    name, else the template id). Returns doc (changed in place)."""
    based = doc.pop("basedOn", None)
    doc.pop("obstacles", None)
    doc["design"].pop("rostrum", None)
    info = doc.setdefault("info", {})
    if based and not info.get("drawnFor"):
        info["drawnFor"] = {"venueTemplate": based["venueTemplate"],
                            "name": venue_name or (info.get("venue") or {}).get("name") or based["venueTemplate"]}
    b = doc.get("built")
    if b:
        b.pop("rostrum", None)
        b["checks"] = [c for c in b.get("checks", []) if c["code"] not in VENUE_CHECKS]
    return doc

def drawing_area(doc):
    """The box to draw a layout on: its `area` if it has one, else the smallest box centred on the origin, in whole
    metres, holding `built.size` (or the footprint) with at least 0.5 m to spare."""
    if doc.get("area"): return doc["area"]
    b = doc["built"]; x0, z0, x1, z1 = (b.get("size") or b["footprint"])["bbox"]   # (files baked before 1.2 have no size)
    return {"length": 2 * math.ceil(max(-x0, x1) + 0.5), "width": 2 * math.ceil(max(-z0, z1) + 0.5)}

def bake(doc):
    upgrade(doc)
    design = doc["design"]
    W0 = design.get("laneWidth", 2.0)
    line, corners = racing_line(design["points"], W0)
    xy = line[:, :2]; s, total = arclength(xy)
    cr = find_crossings(line, s, total, design)
    divs, merged, weight = dividers(line, corners, design["points"], crossing_zones(cr))
    claimed = bridge_crossings(cr, design.get("features", []), total)
    checks = []

    # racing line export, ~EXPORT_STEP spacing
    step = max(1, int(EXPORT_STEP / SAMPLE))
    racing = [[r3(x), r3(z), r3(w)] for x, z, w, _ in line[::step]]

    # features
    feats = []
    for fi, f in enumerate(design.get("features", [])):
        typ = f["type"]; L0, H0 = FEATURE_DEFAULTS[typ]; dist = f["distance"]
        if typ == "crossover":   # sits on the crossing it bridges (the over pass's distance), sized for it
            if fi in claimed:
                c, over = claimed[fi]; dist = c["d"][over]; ramp, top, height = crossover_size(f, bridge_span(c, over))
            else: ramp, top, height = crossover_size(f, W0 + 2 * BRIDGE_MARGIN)
            length = 2 * ramp + top; prof = crossover_profile(ramp, top, height)
        else:
            length = f.get("length", L0); height = f.get("height", H0)
            prof = [[r3(a / FEATURE_PROFILES[typ][-1][0] * length if FEATURE_PROFILES[typ][-1][0] else 0), r3(h * height)] for a, h in FEATURE_PROFILES[typ]]
        p, t, i = at_distance(xy, s, total, dist)
        width = float(line[i, 2]) - 0.08
        feats.append({"type": typ, "x": r3(p[0]), "z": r3(p[1]), "heading": heading_deg(t), "length": r3(length),
                      "width": r3(width), "height": r3(height), "profile": prof})
        # check: jump on or landing into a corner
        i0, i1 = int(np.searchsorted(s, (dist - length / 2) % total)), int(np.searchsorted(s, (dist + length / 2 + 1.0) % total))
        if i1 < i0: i1 += len(line)   # across lap distance 0 (1.8: every type; 1.5-1.7 only crossovers)
        span = np.arange(i0, i1)
        if len(span) and np.max(np.abs(line[span % len(line), 3])) > 0:
            checks.append(feature_in_corner(typ, dist, p))
        if typ == "crossover" and (fi not in claimed or claimed[fi][0]["bridge"] not in (None, fi)):
            # away from any crossing, a second on one already claimed, or on one a tabletop bridges instead
            checks.append({"level": "warning", "code": "crossover-unused", "x": r3(p[0]), "z": r3(p[1]),
                           "message": f"crossover at {dist:.1f} m bridges no crossing"})
    crossings = crossing_checks(cr, feats, design, total, checks)

    # start line
    sd = design.get("start", {}).get("distance", 0.0)
    sp, _, si = at_distance(xy, s, total, sd)
    start = {"x": r3(sp[0]), "z": r3(sp[1]), "heading": heading_deg(tangent_at(line, s, total, sd)), "width": r3(line[si, 2]), "distance": r3(sd)}

    # checks: radius, width (the track only: venue checks are the fit's, fit.check)
    edges = borders(line, corners, design["points"])               # lane edges, right then left
    for i, c in enumerate(corners):
        if c["th"] > 1e-3 and 0 < c["r"] < MIN_RADIUS:
            checks.append({"level": "warning", "code": "tight-corner", "x": r3(design["points"][i]["x"]), "z": r3(design["points"][i]["z"]),
                           "message": f"Corner radius {c['r']:.2f} m is tighter than a buggy can turn ({MIN_RADIUS} m)"})
        if c["th"] > 1e-3 and abs(c["r"] - float(design["points"][i].get("radius", 1.0))) > 0.01:
            checks.append({"level": "info", "code": "radius-reduced", "x": r3(design["points"][i]["x"]), "z": r3(design["points"][i]["z"]),
                           "message": f"Corner radius reduced to {c['r']:.2f} m to fit the straights either side"})
    if np.min(line[:, 2]) < MIN_WIDTH:
        checks.append({"level": "warning", "code": "narrow-lane", "message": f"Lane narrower than {MIN_WIDTH} m"})

    # footprint
    mask, origin = lane_mask(line, corners, design["points"])
    footprint = {"cell": FOOT_CELL, "origin": [r3(origin[0]), r3(origin[1])], "rows": mask.shape[0], "cols": mask.shape[1],
                 "bbox": [r3(origin[0]), r3(origin[1]), r3(origin[0] + mask.shape[1] * FOOT_CELL), r3(origin[1] + mask.shape[0] * FOOT_CELL)],
                 "rle": rle(mask)}

    # real size of the track: lane edges (no pipe padding; the footprint keeps that for fit checks)
    E = np.concatenate(edges); lo, hi = E.min(0), E.max(0)
    size = {"length": r3(hi[0] - lo[0]), "width": r3(hi[1] - lo[1]), "bbox": [r3(lo[0]), r3(lo[1]), r3(hi[0]), r3(hi[1])]}

    pipe = sum(sum(math.dist(a, b) for a, b in zip(d["points"], d["points"][1:])) for d in divs)
    doc["built"] = {
        "generator": GENERATOR,
        "lapLength": r3(total),
        "racingLine": racing,
        "dividers": divs,
        "features": feats,
        **({"crossings": crossings} if crossings else {}),   # v1.6: only when the track crosses itself
        "startLine": start,
        "checks": checks,
        "footprint": footprint,
        "lanes": lane_rings(*edges),
        "size": size,
        "stats": {"dividerLength": r3(pipe), "dividerRuns": len(divs), "corners": count_corners(corners)},
    }
    return doc

if __name__ == "__main__":
    src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else src
    doc = json.load(open(src))
    json.dump(bake(doc), open(dst, "w"), indent=1)
    b = doc["built"]
    print(f"{doc['info']['name']}: lap {b['lapLength']} m, {b['stats']['dividerRuns']} divider runs, {b['stats']['dividerLength']} m of pipe, {len(b['checks'])} checks")
