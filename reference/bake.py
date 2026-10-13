#!/usr/bin/env python3
"""
Reference implementation of the rctrack geometry engine (format v1.3).
Reads a track file, (re)computes the "built" section from "design", writes it back.
The web designer (TypeScript) and the sim (C#) must produce the same results as this file:
the example tracks in examples/ double as test fixtures.

usage: python3 bake.py in.json [out.json]
"""
import json, math, sys
import numpy as np

GENERATOR = "rctrack-bake.py 1.3"
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

FEATURE_PROFILES = {   # along-track distance (m), height (m), for default length/height; scaled to the feature's values
    "tabletop": [[0, 0], [0.70, 1], [1.50, 1], [2.20, 0]],
    "double":   [[0, 0], [0.55, 1], [0.85, 0], [1.75, 0], [2.05, 1], [2.60, 0]],
    "kicker":   [[0, 0], [0.60, 1], [0.80, 0]],
    "stepup":   [[0, 0], [0.60, 1], [1.60, 1], [1.60, 0.0]],
    "stepdown": [[0, 0], [0.0, 1], [1.0, 1], [1.80, 0]],
    "whoops":   [[0, 0], [0.30, 1], [0.60, 0], [0.90, 1], [1.20, 0], [1.50, 1], [1.80, 0]],
    "bump":     [[0, 0], [0.25, 1], [0.50, 0]],
}
FEATURE_DEFAULTS = {"tabletop": (2.2, 0.14), "double": (2.6, 0.15), "kicker": (0.8, 0.12), "stepup": (1.6, 0.12),
                    "stepdown": (1.8, 0.12), "whoops": (1.8, 0.05), "bump": (0.5, 0.04)}

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
        t = r * math.tan(th / 2) if th > 1e-6 else 0.0
        tmax = 0.5 * min(la, lb)
        if t > tmax:                       # radius too big for the straights either side: shrink it
            t = tmax; r = t / math.tan(th / 2) if th > 1e-6 else 0.0
        corners.append(dict(start=P[i] - a * t, end=P[i] + b * t, r=r, sign=1 if cross > 0 else -1, a=a, b=b, th=th))
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
        if points[i].get("outer", "square") == "square":
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
        if not (c["th"] > 1e-6 and c["r"] > 0) or points[i].get("outer", "square") != "square": continue
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

def dividers(line, corners, points):
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
        simplified.append((remove_loops(list(rdp(pts, SIMPLIFY_TOL)), closed), sh, closed))
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

def remove_loops(pts, closed):
    """Cut out self-crossings. A closed divider keeps the longer of its two parts. An open one is split at the crossing
    into head, loop and tail, and loses the shortest: a small kink loses its loop, an end poking past a junction loses
    that stub, and the rest of the pipe stays."""
    pts = [np.asarray(p, float) for p in pts]
    for _ in range(100):
        n = len(pts); segs = n if closed else n - 1; hit = None
        for a in range(segs):
            for b in range(a + 2, segs):
                if closed and a == 0 and b == segs - 1: continue
                X = _cross(pts[a], pts[(a + 1) % n], pts[b], pts[(b + 1) % n])
                if X is not None: hit = (a, b, X); break
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

def bake(doc):
    design = doc["design"]; area = doc["area"]
    W0 = design.get("laneWidth", 2.0)
    line, corners = racing_line(design["points"], W0)
    xy = line[:, :2]; s, total = arclength(xy)
    divs, merged, weight = dividers(line, corners, design["points"])
    checks = []

    # racing line export, ~EXPORT_STEP spacing
    step = max(1, int(EXPORT_STEP / SAMPLE))
    racing = [[r3(x), r3(z), r3(w)] for x, z, w, _ in line[::step]]

    # features
    feats = []
    for f in design.get("features", []):
        typ = f["type"]; L0, H0 = FEATURE_DEFAULTS[typ]
        length = f.get("length", L0); height = f.get("height", H0)
        p, t, i = at_distance(xy, s, total, f["distance"])
        prof = [[r3(a / FEATURE_PROFILES[typ][-1][0] * length if FEATURE_PROFILES[typ][-1][0] else 0), r3(h * height)] for a, h in FEATURE_PROFILES[typ]]
        width = float(line[i, 2]) - 0.08
        feats.append({"type": typ, "x": r3(p[0]), "z": r3(p[1]), "heading": heading_deg(t), "length": r3(length),
                      "width": r3(width), "height": r3(height), "profile": prof})
        # check: jump on or landing into a corner
        span = np.arange(int(np.searchsorted(s, (f["distance"] - length / 2) % total)), int(np.searchsorted(s, (f["distance"] + length / 2 + 1.0) % total)))
        if len(span) and np.max(np.abs(line[span % len(line), 3])) > 0:
            checks.append({"level": "warning", "code": "feature-in-corner", "x": r3(p[0]), "z": r3(p[1]),
                           "message": f"{typ} at {f['distance']:.1f} m is on or lands into a corner"})

    # start line
    sd = design.get("start", {}).get("distance", 0.0)
    sp, st, si = at_distance(xy, s, total, sd)
    start = {"x": r3(sp[0]), "z": r3(sp[1]), "heading": heading_deg(st), "width": r3(line[si, 2]), "distance": r3(sd)}

    # rostrum
    side = design.get("rostrum", {}).get("side", "south")
    off = design.get("rostrum", {}).get("offset", 0.0)
    L, Wd = area["length"], area["width"]
    pos = {"north": (off, Wd / 2 + 1.5), "south": (off, -Wd / 2 - 1.5), "east": (L / 2 + 1.5, off), "west": (-L / 2 - 1.5, off)}[side]
    rostrum = {"side": side, "x": r3(pos[0]), "z": r3(pos[1]), "eyeHeight": 2.8}

    # checks: area, radius, width
    edges = borders(line, corners, design["points"])               # lane edges, right then left
    for B in edges:
        out = (np.abs(B[:, 0]) > L / 2 + 0.01) | (np.abs(B[:, 1]) > Wd / 2 + 0.01)
        if out.any():
            q = B[np.argmax(out)]
            checks.append({"level": "error", "code": "outside-area", "x": r3(q[0]), "z": r3(q[1]), "message": "Track goes outside the venue's track area"})
            break
    for i, c in enumerate(corners):
        if c["th"] > 1e-3 and 0 < c["r"] < MIN_RADIUS:
            checks.append({"level": "warning", "code": "tight-corner", "x": r3(design["points"][i]["x"]), "z": r3(design["points"][i]["z"]),
                           "message": f"Corner radius {c['r']:.2f} m is tighter than a buggy can turn ({MIN_RADIUS} m)"})
        if c["th"] > 1e-3 and abs(c["r"] - float(design["points"][i].get("radius", 1.0))) > 0.01:
            checks.append({"level": "info", "code": "radius-reduced", "x": r3(design["points"][i]["x"]), "z": r3(design["points"][i]["z"]),
                           "message": f"Corner radius reduced to {c['r']:.2f} m to fit the straights either side"})
    if np.min(line[:, 2]) < MIN_WIDTH:
        checks.append({"level": "warning", "code": "narrow-lane", "message": f"Lane narrower than {MIN_WIDTH} m"})

    # footprint + obstacles
    mask, origin = lane_mask(line, corners, design["points"])
    obs = doc.get("obstacles", [])
    if obs:
        om = obstacle_mask(obs, origin, mask.shape)
        hit = mask & om
        if hit.any():
            r, c = np.argwhere(hit)[0]
            checks.append({"level": "error", "code": "obstacle", "x": r3(origin[0] + (c + 0.5) * FOOT_CELL),
                           "z": r3(origin[1] + (r + 0.5) * FOOT_CELL), "message": "Track overlaps a fixed obstacle"})
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
        "startLine": start,
        "rostrum": rostrum,
        "checks": checks,
        "footprint": footprint,
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
