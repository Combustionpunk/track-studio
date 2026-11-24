#!/usr/bin/env python3
"""
Reference "will it fit my venue?" search (rctrack v1.7; adapt moves marshal points, v1.11; the timing loop, v1.13).
For a track and a venue template, tries 8 orientations (as designed, mirrored, rotated 90/180/270, and
mirrored + rotated), slides the track's footprint around the venue's area on a 0.1 m grid, and keeps
positions where it stays inside the area and clear of every obstacle. Can write the adapted track.
check() tests a layout where it is drawn against a venue: the venue checks (outside-area, obstacle, timing-loop) and the rostrum.
Since 1.13 an obstacle may be the pit area or the rostrum (`kind`): to the fit and the checks it is an obstacle like any other.

usage: python3 fit.py track.rctrack.json venue.rcvenue.json [adapted-out.rctrack.json]
"""
import json, math, sys, copy
import numpy as np
import bake

ORIENTS = [("as designed", 0, False), ("mirrored", 0, True), ("rotated 180", 180, False), ("mirrored, rotated 180", 180, True),
           ("rotated 90", 90, False), ("rotated 270", 270, False), ("mirrored, rotated 90", 90, True), ("mirrored, rotated 270", 270, True)]

def transform_pt(x, z, rot, mirror):
    if mirror: x = -x
    a = math.radians(rot)
    return x * math.cos(a) - z * math.sin(a), x * math.sin(a) + z * math.cos(a)

def fits(track, venue):
    L, W = venue["area"]["length"], venue["area"]["width"]
    cell = bake.FOOT_CELL
    area_origin = (-L / 2, -W / 2); area_shape = (int(round(W / cell)), int(round(L / cell)))
    obs = bake.obstacle_mask(venue.get("obstacles", []), area_origin, area_shape)
    results = []
    for label, rot, mirror in ORIENTS:
        pts = [dict(p, **dict(zip(("x", "z"), transform_pt(p["x"], p["z"], rot, mirror)))) for p in track["design"]["points"]]
        line, corners = bake.racing_line(pts, track["design"].get("laneWidth", 2.0))
        m_obs, origin = bake.lane_mask(line, corners, pts)                                       # lanes + pipe thickness: obstacle test
        m_lane, _ = bake.lane_mask(line, corners, pts, origin=origin, shape=m_obs.shape, extra=-0.6 * cell)  # lanes only: inside the area
        rows = np.flatnonzero(m_lane.any(1)); cols = np.flatnonzero(m_lane.any(0))
        r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
        h, w = r1 - r0, c1 - c0
        if h > area_shape[0] or w > area_shape[1]: continue
        H, Wc = m_obs.shape
        best = None
        for oy in range(0, area_shape[0] - h + 1):
            for ox in range(0, area_shape[1] - w + 1):
                # place m_obs so that its lane bbox starts at (ox, oy) in the area grid, clip to the area
                ay0, ax0 = oy - r0, ox - c0
                sy0, sx0 = max(0, -ay0), max(0, -ax0)
                sy1, sx1 = min(H, area_shape[0] - ay0), min(Wc, area_shape[1] - ax0)
                if (m_obs[sy0:sy1, sx0:sx1] & obs[ay0 + sy0:ay0 + sy1, ax0 + sx0:ax0 + sx1]).any(): continue
                dx = area_origin[0] + ax0 * cell - origin[0]; dz = area_origin[1] + ay0 * cell - origin[1]
                cx = area_origin[0] + (ox + w / 2) * cell; cz = area_origin[1] + (oy + h / 2) * cell
                score = cx * cx + cz * cz
                if best is None or score < best[0]: best = (score, dx, dz)
        if best:
            spare = (round(L - w * cell, 1), round(W - h * cell, 1))
            results.append({"orientation": label, "rotation": rot, "mirror": mirror, "shift": [round(best[1], 2), round(best[2], 2)], "spare": spare})
    return results

ROSTRUM_SETBACK = 1.5   # the rostrum stands this far (m) outside the middle of its side of the area...
EYE_HEIGHT = 2.8        # ...with the drivers' eyes this high (m)

def rostrum(venue):
    """Where the venue's rostrum stands: {side, x, z, eyeHeight}, offset metres along its side from the middle."""
    L, W = venue["area"]["length"], venue["area"]["width"]
    side = venue.get("rostrum", {}).get("side", "south"); off = venue.get("rostrum", {}).get("offset", 0.0)
    s = ROSTRUM_SETBACK
    pos = {"north": (off, W / 2 + s), "south": (off, -W / 2 - s), "east": (L / 2 + s, off), "west": (-L / 2 - s, off)}[side]
    return {"side": side, "x": bake.r3(pos[0]), "z": bake.r3(pos[1]), "eyeHeight": EYE_HEIGHT}

LOOP_ALONG = 0.5   # (1.13) the start line counts as over the timing loop this far (m) before or after it...
LOOP_ANGLE = 30    # ...crossing it no more than this far (degrees) off the loop's direction

def timing_loop(track, venue):
    """(1.13) The `timing-loop` warning, or None: the venue has a timing loop and the layout's start/finish line
    (built.startLine) isn't over it, square to it and going its way. Over it: the start line's centre is within
    LOOP_ALONG of the loop along the loop's direction and within the loop's span across it."""
    loop = venue.get("timingLoop"); start = (track.get("built") or {}).get("startLine")
    if not loop or not start: return None
    a = math.radians(loop["heading"]); dx, dz = start["x"] - loop["x"], start["z"] - loop["z"]
    along = dx * math.cos(a) + dz * math.sin(a); across = -dx * math.sin(a) + dz * math.cos(a)
    turn = abs((start["heading"] - loop["heading"] + 180) % 360 - 180)      # 0 = the loop's way, 180 = against it
    over = abs(along) <= LOOP_ALONG and abs(across) <= loop["length"] / 2
    if over and turn <= LOOP_ANGLE: return None
    if not over: msg = "Start/finish isn't over the timing loop"
    elif turn >= 180 - LOOP_ANGLE: msg = "Start/finish runs the wrong way over the timing loop"
    else: msg = "Start/finish crosses the timing loop at an angle"
    return {"level": "warning", "code": "timing-loop", "x": bake.r3(loop["x"]), "z": bake.r3(loop["z"]), "message": msg}

def check(track, venue):
    """The layout where it is drawn (venue coordinates) against the venue: {checks, rostrum}. Checks: the lanes go
    outside the venue's area (`outside-area`), the lanes + pipe thickness overlap a fixed obstacle, the pit area or the
    rostrum (`obstacle`), the start/finish isn't over the venue's timing loop (`timing-loop`, 1.13)."""
    pts = track["design"]["points"]; L, W = venue["area"]["length"], venue["area"]["width"]
    line, corners = bake.racing_line(pts, track["design"].get("laneWidth", 2.0))
    checks = []
    for B in bake.borders(line, corners, pts):
        out = (np.abs(B[:, 0]) > L / 2 + 0.01) | (np.abs(B[:, 1]) > W / 2 + 0.01)
        if out.any():
            q = B[np.argmax(out)]
            checks.append({"level": "error", "code": "outside-area", "x": bake.r3(q[0]), "z": bake.r3(q[1]), "message": "Track goes outside the venue's track area"})
            break
    obs = venue.get("obstacles", [])
    if obs:
        mask, origin = bake.lane_mask(line, corners, pts)
        hit = mask & bake.obstacle_mask(obs, origin, mask.shape)
        if hit.any():
            r, c = np.argwhere(hit)[0]
            checks.append({"level": "error", "code": "obstacle", "x": bake.r3(origin[0] + (c + 0.5) * bake.FOOT_CELL),
                           "z": bake.r3(origin[1] + (r + 0.5) * bake.FOOT_CELL), "message": "Track overlaps a fixed obstacle"})
    loop = timing_loop(track, venue)
    if loop: checks.append(loop)
    return {"checks": checks, "rostrum": rostrum(venue)}

def adapt(track, venue, fit):
    t = copy.deepcopy(track)
    for p in t["design"]["points"]:
        x, z = transform_pt(p["x"], p["z"], fit["rotation"], fit["mirror"])
        p["x"], p["z"] = round(x + fit["shift"][0], 3), round(z + fit["shift"][1], 3)
    for m in t["design"].get("marshals") or []:   # 1.11: cones stand at free positions, so they move with the points
        x, z = transform_pt(m["x"], m["z"], fit["rotation"], fit["mirror"])
        m["x"], m["z"] = round(x + fit["shift"][0], 3), round(z + fit["shift"][1], 3)
    bake.upgrade(t)   # 1.7: nothing of the venue is copied in but the drawing area and the "drawn for" label
    t["area"] = dict(venue["area"])
    t["info"]["drawnFor"] = {"venueTemplate": venue["id"], "name": venue["info"]["name"]}
    t["info"]["venue"] = venue["info"].get("venue")
    if venue.get("surface"): t["info"]["surface"] = venue["surface"]   # 1.13: the venue's surface, when the template names one
    t["info"]["derivedFrom"] = {"id": track["id"], "revision": track["revision"], "orientation": fit["orientation"]}
    t["info"]["name"] = f'{track["info"]["name"]} @ {venue["info"]["name"]}'
    t["info"]["status"] = "draft"
    import uuid; t["id"] = str(uuid.uuid4()); t["revision"] = 1
    return bake.bake(t)

if __name__ == "__main__":
    track = json.load(open(sys.argv[1])); venue = json.load(open(sys.argv[2]))
    res = fits(track, venue)
    print(f'{track["info"]["name"]} in {venue["info"]["name"]} ({venue["area"]["length"]} x {venue["area"]["width"]} m):')
    for r in res: print(f'  fits {r["orientation"]:24s} spare {r["spare"][0]} x {r["spare"][1]} m')
    if not res: print("  does not fit")
    if res and len(sys.argv) > 3:
        out = adapt(track, venue, res[0]); json.dump(out, open(sys.argv[3], "w"), indent=1)
        print("  adapted copy written:", sys.argv[3], "- checks:", [c["code"] for c in out["built"]["checks"] + check(out, venue)["checks"]])
