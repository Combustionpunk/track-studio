#!/usr/bin/env python3
"""
Reference 2D top-down preview, drawn ONLY from the "built" section (what the forum does).
usage: python3 preview_svg.py track.json out.svg
"""
import json, sys, math

def svg(doc, px_per_m=40):
    a = doc["area"]; b = doc["built"]
    L, W = a["length"], a["width"]
    m = 2.5                                   # margin (m) for the rostrum label
    vw, vh = (L + 2 * m) * px_per_m, (W + 2 * m) * px_per_m
    X = lambda x: (x + L / 2 + m) * px_per_m
    Z = lambda z: (W / 2 + m - z) * px_per_m    # +z (north) is up on the page
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{vw:.0f}" height="{vh:.0f}" viewBox="0 0 {vw:.0f} {vh:.0f}" font-family="sans-serif">',
         f'<rect width="100%" height="100%" fill="#1e2a22"/>',
         f'<rect x="{X(-L/2):.1f}" y="{Z(W/2):.1f}" width="{L*px_per_m:.1f}" height="{W*px_per_m:.1f}" fill="#3a3d42" stroke="#888" stroke-width="2"/>']
    # 1 m grid
    for x in range(-int(L // 2), int(L // 2) + 1):
        o.append(f'<line x1="{X(x):.1f}" y1="{Z(W/2):.1f}" x2="{X(x):.1f}" y2="{Z(-W/2):.1f}" stroke="#ffffff" stroke-opacity="0.05"/>')
    for z in range(-int(W // 2), int(W // 2) + 1):
        o.append(f'<line x1="{X(-L/2):.1f}" y1="{Z(z):.1f}" x2="{X(L/2):.1f}" y2="{Z(z):.1f}" stroke="#ffffff" stroke-opacity="0.05"/>')
    # fixed obstacles (pillars, exits)
    for ob in doc.get("obstacles", []):
        if ob["type"] == "circle":
            o.append(f'<circle cx="{X(ob["x"]):.1f}" cy="{Z(ob["z"]):.1f}" r="{ob["radius"]*px_per_m:.1f}" fill="#b03a3a"/>')
        else:
            o.append(f'<rect x="{X(ob["x"]-ob["length"]/2):.1f}" y="{Z(ob["z"]+ob["width"]/2):.1f}" width="{ob["length"]*px_per_m:.1f}" height="{ob["width"]*px_per_m:.1f}" fill="#b03a3a" fill-opacity="0.45" stroke="#ff6060" stroke-dasharray="6 4" transform="rotate({-ob.get("rotation",0)} {X(ob["x"]):.1f} {Z(ob["z"]):.1f})"/>')
        if ob.get("label"):
            o.append(f'<text x="{X(ob["x"]):.1f}" y="{Z(ob["z"])+4:.1f}" fill="#fff" font-size="12" text-anchor="middle">{ob["label"]}</text>')
    # racing line
    pts = " ".join(f"{X(p[0]):.1f},{Z(p[1]):.1f}" for p in b["racingLine"])
    o.append(f'<polygon points="{pts}" fill="none" stroke="#ff4fb0" stroke-width="2" stroke-dasharray="8 6" opacity="0.7"/>')
    # features
    for f in b["features"]:
        h = math.radians(f["heading"]); tx, tz = math.cos(h), math.sin(h); nx, nz = -tz, tx
        c = [(f["x"] + tx * sl * f["length"] / 2 + nx * sw * f["width"] / 2, f["z"] + tz * sl * f["length"] / 2 + nz * sw * f["width"] / 2)
             for sl, sw in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
        col = {"tabletop": "#ffb347", "double": "#5ec8ff", "kicker": "#ffe066"}.get(f["type"], "#c9a0ff")
        o.append(f'<polygon points="{" ".join(f"{X(x):.1f},{Z(z):.1f}" for x, z in c)}" fill="{col}" opacity="0.9"/>')
    # dividers
    for d in b["dividers"]:
        p = " ".join(f"{X(x):.1f},{Z(z):.1f}" for x, z in d["points"])
        tag = "polygon" if d["closed"] else "polyline"
        o.append(f'<{tag} points="{p}" fill="none" stroke="{"#ffffff" if d["shared"] else "#cfd2d6"}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>')
    # start line + direction
    s = b["startLine"]; h = math.radians(s["heading"]); nx, nz = -math.sin(h), math.cos(h)
    o.append(f'<line x1="{X(s["x"]+nx*s["width"]/2):.1f}" y1="{Z(s["z"]+nz*s["width"]/2):.1f}" x2="{X(s["x"]-nx*s["width"]/2):.1f}" y2="{Z(s["z"]-nz*s["width"]/2):.1f}" stroke="#ffffff" stroke-width="8"/>')
    ax, az = s["x"] + math.cos(h) * 2.5, s["z"] + math.sin(h) * 2.5
    o.append(f'<line x1="{X(s["x"]+math.cos(h)*0.6):.1f}" y1="{Z(s["z"]+math.sin(h)*0.6):.1f}" x2="{X(ax):.1f}" y2="{Z(az):.1f}" stroke="#ff4fb0" stroke-width="5" marker-end="url(#a)"/>')
    o.insert(1, '<defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#ff4fb0"/></marker></defs>')
    # checks
    for c in b["checks"]:
        if "x" in c:
            col = {"error": "#ff4040", "warning": "#ffb000"}.get(c["level"], "#7fb2ff")
            o.append(f'<circle cx="{X(c["x"]):.1f}" cy="{Z(c["z"]):.1f}" r="14" fill="none" stroke="{col}" stroke-width="4"/>')
    # rostrum
    r = b["rostrum"]
    o.append(f'<rect x="{X(r["x"])-80:.1f}" y="{Z(r["z"])-14:.1f}" width="160" height="28" rx="4" fill="#6a3da3"/>'
             f'<text x="{X(r["x"]):.1f}" y="{Z(r["z"])+6:.1f}" fill="#fff" font-size="16" text-anchor="middle">ROSTRUM</text>')
    i = doc["info"]
    o.append(f'<text x="12" y="26" fill="#fff" font-size="20">{i["name"]}  -  {b["lapLength"]:.0f} m lap, {len(b["features"])} features, area {L:g} x {W:g} m</text>')
    o.append("</svg>")
    return "\n".join(o)

if __name__ == "__main__":
    doc = json.load(open(sys.argv[1]))
    open(sys.argv[2], "w").write(svg(doc))
