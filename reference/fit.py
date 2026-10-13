#!/usr/bin/env python3
"""
Reference "will it fit my venue?" search (rctrack v1.1).
For a track and a venue template, tries 8 orientations (as designed, mirrored, rotated 90/180/270, and
mirrored + rotated), slides the track's footprint around the venue's area on a 0.1 m grid, and keeps
positions where it stays inside the area and clear of every obstacle. Can write the adapted track.

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
        line, _ = bake.racing_line(pts, track["design"].get("laneWidth", 2.0))
        m_obs, origin = bake.lane_mask(line)                                                     # lanes + pipe thickness: obstacle test
        m_lane, _ = bake.lane_mask(line, origin=origin, shape=m_obs.shape, extra=-0.6 * cell)    # lanes only: must sit inside the area
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

def adapt(track, venue, fit):
    t = copy.deepcopy(track)
    for p in t["design"]["points"]:
        x, z = transform_pt(p["x"], p["z"], fit["rotation"], fit["mirror"])
        p["x"], p["z"] = round(x + fit["shift"][0], 3), round(z + fit["shift"][1], 3)
    t["area"] = dict(venue["area"]); t["obstacles"] = venue.get("obstacles", [])
    t["design"]["rostrum"] = dict(venue.get("rostrum", {"side": "south"}))
    t["basedOn"] = {"venueTemplate": venue["id"], "revision": venue["revision"]}
    t["info"]["venue"] = venue["info"].get("venue")
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
        print("  adapted copy written:", sys.argv[3], "- checks:", [c["code"] for c in out["built"]["checks"]])
