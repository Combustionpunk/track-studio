#!/usr/bin/env python3
"""
Reference implementation of the rctrack geometry engine (format v1.2).
Reads a track file, (re)computes the "built" section from "design", writes it back.
The web designer (TypeScript) and the sim (C#) must produce the same results as this file:
the example tracks in examples/ double as test fixtures.

usage: python3 bake.py in.json [out.json]
"""
import json, math, sys
import numpy as np

GENERATOR = "rctrack-bake.py 1.2"
SAMPLE = 0.05          # internal sampling (m)
EXPORT_STEP = 0.25     # racing line export spacing (m)
MERGE_GAP = 0.6        # borders closer than this (from different parts of the track) are merged...
MERGE_FULL = 0.2       # ...fully below this, blended in between
MERGE_MIN_SEP = 3.0    # ...but only if they are this far apart along the track
MERGE_PARALLEL = 0.9   # ...and run roughly parallel (|cos| of the angle between them)
SIMPLIFY_TOL = 0.02    # divider polyline simplification tolerance (m)
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
        if c["th"] > 1e-6 and c["r"] > 0:
            nrm = np.array([-c["a"][1], c["a"][0]]) * c["sign"]
            ctr = c["start"] + nrm * c["r"]
            a0 = math.atan2(*(c["start"] - ctr)[::-1]); a1 = math.atan2(*(c["end"] - ctr)[::-1])
            da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
            m = max(2, int(abs(da) * c["r"] / SAMPLE))
            for k in range(m):
                ang = a0 + da * k / m
                out.append([ctr[0] + c["r"] * math.cos(ang), ctr[1] + c["r"] * math.sin(ang), W[i], c["sign"] / c["r"]])
        nxt = corners[(i + 1) % n]["start"]
        L = np.linalg.norm(nxt - c["end"]); m = max(1, int(L / SAMPLE))
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

# ------------------------------------------------------------------ dividers
def dividers(line):
    from scipy.spatial import cKDTree
    xy = line[:, :2]; n = len(xy)
    s, total = arclength(xy)
    t, left = frame(xy)
    hw = line[:, 2:3] / 2
    borders = np.concatenate([xy - left * hw, xy + left * hw])          # right side then left side
    idx = np.concatenate([np.arange(n), np.arange(n)])
    tree = cKDTree(borders)
    merged = borders.copy(); weight = np.zeros(len(borders)); partner = -np.ones(len(borders), int)
    for i, p in enumerate(borders):
        dd, jj = tree.query(p, k=48, distance_upper_bound=MERGE_GAP)
        for d, j in zip(dd, jj):
            if not np.isfinite(d) or j == i: continue
            ds = abs(s[idx[i]] - s[idx[j]]); ds = min(ds, total - ds)
            if ds < MERGE_MIN_SEP: continue
            if abs(float(t[idx[i]] @ t[idx[j]])) < MERGE_PARALLEL: continue   # only merge borders running alongside each other
            w = float(np.clip((MERGE_GAP - d) / (MERGE_GAP - MERGE_FULL), 0, 1))
            merged[i] = p + ((borders[i] + borders[j]) / 2 - p) * w
            weight[i] = w; partner[i] = j
            break
    # A fully shared divider is generated once: only by the border with the lower index
    skip = (weight > 0.99) & (partner >= 0) & (partner < np.arange(len(borders)))
    runs = []
    for side in (0, 1):
        B = merged[side * n:(side + 1) * n]; S = skip[side * n:(side + 1) * n]; Wt = weight[side * n:(side + 1) * n]
        # rotate so a run doesn't start in the middle
        start = int(np.argmax(S)) if S.any() and not S.all() else 0
        cur = []; shared = []
        for k in range(n + 1):
            i = (start + k) % n
            if k < n and not S[i]:
                cur.append(B[i]); shared.append(Wt[i] > 0.99)
            elif cur:
                if len(cur) > 1:
                    runs.append((np.array(cur), bool(np.mean(shared) > 0.5)))
                cur = []; shared = []
        if S.sum() == 0 and runs and len(runs[-1][0]) == n + 1: pass
    out = []
    for pts, sh in runs:
        closed = len(pts) >= n and np.linalg.norm(pts[0] - pts[-1]) < 0.2
        simp = rdp(pts, SIMPLIFY_TOL)
        out.append({"shared": sh, "closed": bool(closed), "points": [[r3(x), r3(z)] for x, z in simp]})
    return out, merged, weight

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

def lane_mask(line, cell=FOOT_CELL, origin=None, shape=None, extra=PIPE_R):
    """Raster of the area covered by lanes (plus pipe thickness). Returns mask, origin(x0,z0)."""
    xy = line[:, :2]; hw = line[:, 2] / 2 + extra
    if origin is None:
        lo = xy.min(0) - hw.max() - cell; hi = xy.max(0) + hw.max() + cell
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
    return m, origin

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
    divs, merged, weight = dividers(line)
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
    hw = line[:, 2] / 2
    t, left = frame(xy)
    edges = (xy - left * hw[:, None], xy + left * hw[:, None])      # lane edges, right then left
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
    mask, origin = lane_mask(line)
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
