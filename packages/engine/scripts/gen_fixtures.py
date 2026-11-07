#!/usr/bin/env python3
"""Regenerate the engine's test fixtures from the Python reference (reference/bake.py, reference/fit.py):
  test/fixtures/extra/*.rctrack.json   extra designs that exercise code paths the reference examples don't
                                       (every check code, closed dividers, rotated obstacles, wrapping distances)
  test/fixtures/extra/*.rcvenue.json   extra venues: a rotated obstacle; the obstacles a fixture runs over
  test/fixtures/fit-expected.json      fit.fits() and fit.check() for every track x venue (reference + extra)
  reference/examples/*.rctrack.json    re-baked (1.7: upgraded from 1.6 first)
The v12/ to v17/ checks assert that older bakes re-bake the same, less what each later version changed on purpose.
usage (from the repo root): python3 packages/engine/scripts/gen_fixtures.py"""
import glob, json, math, os, re, sys
root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(root, "reference"))
import bake, fit  # noqa: E402

def as17(built):
    """A built section as 1.7 bakes it: no rostrum, no venue checks, no generator."""
    b = {k: v for k, v in built.items() if k not in ("rostrum", "generator")}
    b["checks"] = [c for c in built["checks"] if c["code"] not in bake.VENUE_CHECKS]
    return b

def as18(built):
    """as17, with a jump's feature-in-corner as 1.8 reports it (info, not a warning: a technical section) and the
    distances in messages from 0 up to the lap length (#91)."""
    b = as17(built)
    b["checks"] = [lap18(jump18(c), built["lapLength"]) for c in b["checks"]]
    return b

def lap18(c, total):
    """A check's "at d m" distances on the lap, 0 up to its length: "-1.5 m" was 1.5 m before the start."""
    lap = lambda m: f"at {float(m.group(1)) % total:.1f} m"
    return {**c, "message": re.sub(r"at (-?\d+\.\d) m", lap, c["message"])}

def jump18(c):
    if c["code"] != "feature-in-corner" or c["level"] != "warning" or c["message"].startswith("crossover "): return c
    typ, rest = c["message"].split(" ", 1)
    return {**c, "level": "info", "message": f"{bake.FEATURE_LABEL[typ]} {rest} (technical section)"}

fixtures = os.path.join(root, "packages/engine/test/fixtures")
extra = os.path.join(fixtures, "extra")
os.makedirs(extra, exist_ok=True)

def track(slug, name, area, design):
    return {"format": "rctrack", "version": 1, "id": f"00000000-0000-4000-8000-{slug:0>12}"[:36], "revision": 1,
            "info": {"name": name, "author": "fixtures", "status": "draft"}, "area": area, "design": design}

EXTRA_TRACKS = {
    # no merging at all -> two closed dividers; narrow lane, tight corner, jumps into corners, wrapped distances
    "narrow-oval": track("1", "Narrow oval", {"length": 20, "width": 10}, {
        "laneWidth": 1.2,
        "points": [{"x": -8, "z": -3.5, "radius": 0.4}, {"x": 8, "z": -3.5, "radius": 2.5}, {"x": 8, "z": 3.5, "radius": 1.5, "width": 1.6},
                   {"x": -8, "z": 3.5, "radius": 0.0}],
        "features": [{"type": "kicker", "distance": 15.0}, {"type": "whoops", "distance": 22.5}, {"type": "stepup", "distance": -6.0},
                     {"type": "stepdown", "distance": 60.0, "length": 2.0, "height": 0.1}, {"type": "bump", "distance": 100.0}],
        "start": {"distance": -3.0}}),
    # runs outside the area and over the obstacles of venue "obstacles-hall" (fit.check); varying widths, diagonals, a sweeper
    "outside-and-obstacles": track("2", "Outside and obstacles", {"length": 18, "width": 10}, {
        "laneWidth": 2.2,
        "points": [{"x": -9.5, "z": -4, "radius": 1.0}, {"x": 6, "z": -4.5, "radius": 3.0, "width": 1.9}, {"x": 8.2, "z": 2.7, "radius": 1.2},
                   {"x": 1.3, "z": 4.1, "radius": 0.8, "width": 2.4}, {"x": -2.7, "z": 0.3, "radius": 2.0}, {"x": -7.1, "z": 3.9, "radius": 0.9}],
        "features": [{"type": "tabletop", "distance": 7.3}, {"type": "double", "distance": 33.3, "length": 3.0, "height": 0.2}],
        "start": {"distance": 2.0}}),
    # tight switchbacks: lots of shared dividers, non-grid coordinates
    "switchbacks": track("3", "Switchbacks", {"length": 24, "width": 13}, {
        "laneWidth": 1.9,
        "points": [{"x": -10.7, "z": -5.3}, {"x": 10.4, "z": -5.3}, {"x": 10.4, "z": -3.37}, {"x": -8.6, "z": -3.37, "radius": 0.85},
                   {"x": -8.6, "z": -1.45, "radius": 0.85}, {"x": 9.9, "z": -1.45, "radius": 1.1}, {"x": 9.9, "z": 0.52, "radius": 0.95},
                   {"x": -8.6, "z": 0.52}, {"x": -8.6, "z": 2.45}, {"x": 3.3, "z": 2.45, "radius": 2.2}, {"x": 7.15, "z": 5.4, "radius": 1.3},
                   {"x": -10.7, "z": 5.4}],
        "features": [{"type": "tabletop", "distance": 30.0}, {"type": "double", "distance": 55.0}, {"type": "bump", "distance": 140.0}],
        "start": {"distance": 12.5}}),
}
# rctrack 1.3: square outer corners and shared-divider transitions
def serpentine(outer):
    """Main straight with a hairpin beside it that peels away (the switchback a club builds along a hall)."""
    pts = [(-9, -4.5), (9, -4.5), (9, -2.5), (-6, -2.5), (-6, -0.5), (9, -0.5), (9, 4.5), (-9, 4.5)]
    return [dict(x=x, z=z, radius=1.5 if outer == "round" and i in (3, 4) else 1.0, **({"outer": outer} if i in (3, 4) else {}))
            for i, (x, z) in enumerate(pts)]

EXTRA_TRACKS.update({
    # points width/2 from every edge: square corners reach the area's corners (size = the whole area)
    "square-fill": track("4", "Square fill", {"length": 22, "width": 12}, {
        "laneWidth": 2.0, "points": [{"x": -10, "z": -5}, {"x": 10, "z": -5}, {"x": 10, "z": 5}, {"x": -10, "z": 5}],
        "start": {"distance": 5.0}}),
    # a 164° corner, explicitly square: bevelled, no mitre spike
    "sharp-v": track("5", "Sharp V", {"length": 22, "width": 12}, {
        "laneWidth": 2.0, "points": [{"x": -8, "z": -4, "outer": "square"}, {"x": 8, "z": -4, "radius": 1.0, "outer": "square"},
                                     {"x": -6, "z": 0, "outer": "square"}, {"x": -8, "z": 3, "outer": "square"}],
        "start": {"distance": 3.0}}),
    "peel-square": track("6", "Hairpin peels away (square)", {"length": 22, "width": 12}, {
        "laneWidth": 2.0, "points": serpentine("square"), "start": {"distance": 3.0}}),
    "peel-round": track("7", "Hairpin peels away (round)", {"length": 22, "width": 12}, {
        "laneWidth": 2.0, "points": serpentine("round"), "start": {"distance": 3.0}}),
})

# rctrack 1.6: tracks that cross themselves, on a bridge
def figure8(slug, name, features=()):
    """Figure of eight: two diagonals crossing square at the origin, a lobe either side."""
    pts = [(-6, -6), (6, 6), (10, 6), (10, -6), (6, -6), (-6, 6), (-10, 6), (-10, -6)]
    return track(slug, name, {"length": 24, "width": 16}, {
        "laneWidth": 2.0, "points": [{"x": x, "z": z, "radius": 1.5} for x, z in pts], "features": list(features),
        "start": {"distance": 2.0}})

def at_crossings(doc, make):
    """Features placed on the doc's crossings (as baked without them): make(k, [first, second]) per crossing."""
    cr = bake.bake(json.loads(json.dumps(doc)))["built"]["crossings"]
    doc["design"]["features"] = [make(k, c["distances"]) for k, c in enumerate(cr)]
    return doc

s20 = round(8 * math.tan(math.radians(20)), 3)
EXTRA_TRACKS.update({
    "crossover-figure8": at_crossings(figure8("8", "Figure of eight on a crossover"),
                                      lambda k, d: {"type": "crossover", "distance": d[0]}),
    # a tabletop long enough that its flat top (0.364 of its length) spans the 2 m lane + 1 m each side
    "tabletop-figure8": at_crossings(figure8("9", "Figure of eight on a long tabletop"),
                                     lambda k, d: {"type": "tabletop", "distance": d[1], "length": 12.0, "height": 0.4}),
    # a bridge needs 0.40 m clearance: a default-height tabletop or a 0.30 m crossover in place is crossing-too-low
    "tabletop-low-figure8": at_crossings(figure8("13", "Figure of eight on a low tabletop"),
                                         lambda k, d: {"type": "tabletop", "distance": d[1], "length": 12.0}),
    "crossover-low-figure8": at_crossings(figure8("14", "Figure of eight on a low crossover"),
                                          lambda k, d: {"type": "crossover", "distance": d[0], "height": 0.3}),
    # a second crossover on the bridged crossing bridges nothing: crossover-unused
    "crossover-unused-figure8": at_crossings(figure8("15", "Figure of eight with a spare crossover"),
                                             lambda k, d: {"type": "crossover", "distance": d[0]}),
    "unbridged-figure8": figure8("10", "Figure of eight, no bridge"),
    # two diagonals 40° apart: bridged, but more than 30° off square
    "shallow-crossing": at_crossings(track("11", "Shallow crossing", {"length": 24, "width": 10}, {
        "laneWidth": 2.0, "points": [{"x": x, "z": z, "radius": 1.5} for x, z in
                                     [(-8, -s20), (8, s20), (11, s20), (11, -s20), (8, -s20), (-8, s20), (-11, s20), (-11, -s20)]],
        "start": {"distance": 1.0}}),
        lambda k, d: {"type": "crossover", "distance": d[0], "rampLength": 1.5}),
    # the back straight dips under the main straight twice, 6 m apart: both bridges on the main straight overlap
    "two-crossings": at_crossings(track("12", "Two crossings", {"length": 22, "width": 14}, {
        "laneWidth": 2.0, "points": [{"x": x, "z": z} for x, z in [(-10, -2), (10, -2), (10, 5), (3, 5), (3, -6), (-3, -6), (-3, 5), (-10, 5)]],
        "start": {"distance": 0.0}}),   # 1.8: at point 0's corner join (the start heading's regression case, #69)
        lambda k, d: {"type": "crossover", "distance": d[0]}),
})

# rctrack 1.8: a tabletop across lap distance 0 lands into point 0's corner (info, #62); a kicker on a straight is fine;
# the start line sits where point 0's corner arc meets the straight before it (#69)
EXTRA_TRACKS["jump-across-start"] = track("16", "Jump across the start", {"length": 22, "width": 12}, {
    "laneWidth": 2.0, "points": [{"x": x, "z": z, "radius": 2.0} for x, z in [(-9, -4), (9, -4), (9, 4), (-9, 4)]],
    "features": [{"type": "tabletop", "distance": -1.5}, {"type": "kicker", "distance": 9.0}],
    "start": {"distance": 0.0}})

# 1.8 (#91): the start line 1.5 m before the crossing, on the crossover's up ramp: start-on-feature
EXTRA_TRACKS["start-on-ramp"] = at_crossings(figure8("17", "Start on the crossover's ramp"), lambda k, d: {"type": "crossover", "distance": d[0]})
EXTRA_TRACKS["start-on-ramp"]["design"]["start"]["distance"] = round(EXTRA_TRACKS["start-on-ramp"]["design"]["features"][0]["distance"] - 1.5, 3)

EXTRA_TRACKS["crossover-unused-figure8"]["design"]["features"].append({"type": "crossover", "distance": EXTRA_TRACKS["crossover-unused-figure8"]["design"]["features"][0]["distance"] + 1.0})

EXTRA_VENUES = {
    # the hall "outside-and-obstacles" was drawn for: 1.7 layouts carry no obstacles, fit.check finds the hits
    "obstacles-hall": {"format": "rcvenue", "version": 1, "id": "venue-x2", "revision": 1,
                       "info": {"name": "Hall with a pillar and a desk", "venue": None, "notes": "fixture"},
                       "area": {"length": 18, "width": 10}, "rostrum": {"side": "west", "offset": 1.5},
                       "obstacles": [{"type": "circle", "x": 0.0, "z": -4.0, "radius": 0.3, "label": "Pillar"},
                                     {"type": "rect", "x": 5.0, "z": 3.0, "length": 1.5, "width": 0.8, "rotation": 30, "label": "Desk"}]},
    "rotated-desk": {"format": "rcvenue", "version": 1, "id": "venue-x1", "revision": 2,
                     "info": {"name": "Hall with desk", "venue": {"id": 99, "name": "Hall with desk"}, "notes": "fixture"},
                     "area": {"length": 24, "width": 14}, "rostrum": {"side": "east", "offset": -1.0},
                     "obstacles": [{"type": "rect", "x": -3.0, "z": 0.5, "length": 1.2, "width": 0.6, "rotation": 45, "label": "Desk"},
                                   {"type": "circle", "x": 9.0, "z": -5.5, "radius": 0.5}]},
}

for slug, doc in EXTRA_TRACKS.items():
    json.dump(bake.bake(doc), open(os.path.join(extra, f"{slug}.rctrack.json"), "w"), indent=1)
    print(slug, [c["code"] for c in doc["built"]["checks"]], [(d["closed"], d["shared"]) for d in doc["built"]["dividers"]])
for slug, doc in EXTRA_VENUES.items():
    json.dump(doc, open(os.path.join(extra, f"{slug}.rcvenue.json"), "w"), indent=1)

# reference examples: upgraded to 1.7 (the adapted one is labelled with its venue template's name) and re-baked
venue_names = {v["id"]: v["info"]["name"] for v in (json.load(open(f)) for f in glob.glob(os.path.join(root, "reference/venues/*.rcvenue.json")))}
for f in sorted(glob.glob(os.path.join(root, "reference/examples/*.rctrack.json"))):
    doc = json.load(open(f))
    bake.upgrade(doc, venue_names.get((doc.get("basedOn") or {}).get("venueTemplate")))
    json.dump(bake.bake(doc), open(f, "w"), indent=1)

tracks = sorted(glob.glob(os.path.join(root, "reference/examples/*.rctrack.json"))) + sorted(glob.glob(os.path.join(extra, "*.rctrack.json")))
venues = sorted(glob.glob(os.path.join(root, "reference/venues/*.rcvenue.json"))) + sorted(glob.glob(os.path.join(extra, "*.rcvenue.json")))
out = {}
for t in tracks:
    for v in venues:
        tv = json.load(open(t)), json.load(open(v))
        out[f"{os.path.basename(t)} | {os.path.basename(v)}"] = {"fits": fit.fits(*tv), "check": fit.check(*tv)}
json.dump(out, open(os.path.join(fixtures, "fit-expected.json"), "w"), indent=1)

# round outer corners must reproduce rctrack 1.2 exactly (v12/: baked by bake.py 1.2)
for f in sorted(glob.glob(os.path.join(fixtures, "v12", "*.rctrack.json"))):
    doc = json.load(open(f)); old = doc["built"]; new = bake.bake(json.loads(json.dumps(doc)))["built"]
    old, new = as18(old), as18(new)
    same = all(old[k] == new[k] for k in old)   # (1.4 adds built.lanes)
    print(f"{os.path.basename(f)}: {'same as 1.2' if same else 'DIFFERENT from 1.2'}")
    assert same
# designs with no squeezed corners must bake exactly as in rctrack 1.4 (v14/: baked by bake.py 1.4)
for f in sorted(glob.glob(os.path.join(fixtures, "v14", "*.rctrack.json"))):
    doc = json.load(open(f)); old = doc["built"]; new = bake.bake(json.loads(json.dumps(doc)))["built"]
    same = json.dumps(as18(old)) == json.dumps(as18(new))
    print(f"{os.path.basename(f)}: {'same as 1.4' if same else 'DIFFERENT from 1.4'}")
    assert same
# tracks that don't cross themselves must bake exactly as in rctrack 1.5 (v15/: baked by bake.py 1.5)
for f in sorted(glob.glob(os.path.join(fixtures, "v15", "*.rctrack.json"))):
    doc = json.load(open(f)); old = doc["built"]; new = bake.bake(json.loads(json.dumps(doc)))["built"]
    same = json.dumps(as18(old)) == json.dumps(as18(new))
    print(f"{os.path.basename(f)}: {'same as 1.5' if same else 'DIFFERENT from 1.5'}")
    assert same
# 1.6 files load (upgrade drops obstacles, design/built rostrum and basedOn) and bake the same, less the venue's parts
for f in sorted(glob.glob(os.path.join(fixtures, "v16", "*.rctrack.json"))):
    doc = json.load(open(f)); old = doc["built"]; new = bake.bake(json.loads(json.dumps(doc)))
    assert not {"obstacles", "basedOn"} & new.keys() and "rostrum" not in new["design"] and "rostrum" not in new["built"]
    assert bool(doc.get("basedOn")) == ("drawnFor" in new["info"])
    same = json.dumps(as18(old)) == json.dumps(as18(new["built"]))
    print(f"{os.path.basename(f)}: {'same as 1.6' if same else 'DIFFERENT from 1.6'}")
    assert same
# 1.7 bakes (v17/: the reference examples and extras as bake.py 1.7 baked them) bake the same in 1.8, less a jump's
# feature-in-corner level, except where 1.8 changed them on purpose: a jump across lap distance 0 next to a corner (#62),
# a start line on a racing-line sample, such as a corner join (#69)
CHANGED_18 = {}
for f in sorted(glob.glob(os.path.join(fixtures, "v17", "*.rctrack.json"))):
    doc = json.load(open(f)); old = doc["built"]; new = bake.bake(json.loads(json.dumps(doc)))["built"]
    a, b = as18(old), as18(new)
    diff = sorted(k for k in a.keys() | b.keys() if json.dumps(a.get(k)) != json.dumps(b.get(k)))
    print(f"{os.path.basename(f)}: {'same as 1.7' if not diff else 'DIFFERENT from 1.7: ' + ', '.join(diff)}")
    assert diff == CHANGED_18.get(os.path.basename(f), [])
print(f"{len(out)} fit results; fitting:", sum(1 for r in out.values() if r["fits"]))
