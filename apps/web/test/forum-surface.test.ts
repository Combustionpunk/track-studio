// #190: a template linked to a forum venue track shows the forum's surface (read-only); an unlinked one keeps its own.
import type { RcVenue } from "@track-studio/engine";
import { describe, expect, it } from "vitest";
import { venueDraft } from "../src/designer/start.js";
import { surfaceView, trackSurface, type ForumTrackFacts } from "../src/venues/forum.js";
import { blankVenue, surfaceFromForum, venueBody, type VenueDraft } from "../src/venues/model.js";

const link = { id: 12, name: "Niagara centre", trackId: 31, trackName: "Indoor (Winter)" };
const facts = (over: Partial<ForumTrackFacts> = {}): ForumTrackFacts => ({ known: true, surface: "carpet", environment: "indoor", stale: false, ...over });
const doc = (over: Partial<RcVenue> = {}): RcVenue =>
  ({ format: "rcvenue", version: 1, id: "venue-9", revision: 2, info: { name: "Niagara centre – Indoor (Winter)", venue: link }, area: { length: 22, width: 12 }, obstacles: [], ...over }) as RcVenue;

describe("surfaceView", () => {
  it("a linked template: the forum's surface and setting, from the forum", () => {
    expect(surfaceView(doc({ surface: "carpet" }), facts())).toEqual({ surface: "Carpet", environment: "Indoor", fromForum: true, note: null });
  });

  it("a forum surface the format has no word for: shown, with a note that layouts get none", () => {
    const v = surfaceView(doc(), facts({ surface: "grass", environment: "outdoor" }));
    expect(v).toMatchObject({ surface: "Grass", environment: "Outdoor", fromForum: true });
    expect(v.note).toMatch(/no grass surface/i);
  });

  it("the forum says nothing, or can't be asked: not given", () => {
    expect(surfaceView(doc(), facts({ surface: null, environment: null }))).toEqual({ surface: null, environment: null, fromForum: true, note: null });
    expect(surfaceView(doc(), facts({ known: false, surface: null, environment: null }))).toMatchObject({ surface: null, fromForum: true });
  });

  it("an unlinked template (or an old one without a track): its own surface, not from the forum", () => {
    expect(surfaceView(doc({ surface: "astro", info: { name: "Hut" } }), null)).toEqual({ surface: "Astro", environment: null, fromForum: false, note: null });
    expect(surfaceView(doc({ info: { name: "Hut" } }), undefined)).toEqual({ surface: null, environment: null, fromForum: false, note: null });
  });
});

describe("the editor", () => {
  it("the forum list's track, in the format's words", () => {
    expect(trackSurface({ id: 31, name: "Indoor", surface: "carpet", environment: "indoor", templateSurface: "carpet" })).toEqual(facts());
    expect(trackSurface(undefined)).toEqual({ known: false, surface: null, environment: null, stale: false });
  });

  it("a linked template saves no surface of its own; an unlinked one does", () => {
    const linked: VenueDraft = { ...blankVenue(), info: { name: "N", venue: link }, surface: "astro" };
    expect("surface" in venueBody(linked)).toBe(false);
    const own: VenueDraft = { ...linked, info: { name: "N", venue: null } };
    expect(venueBody(own).surface).toBe("astro");
    // an old template linked to a venue but no track still has the field
    expect(venueBody({ ...linked, info: { name: "N", venue: { id: 12, name: "Niagara centre" } } }).surface).toBe("astro");
    expect(surfaceFromForum(linked.info.venue)).toBe(true);
    expect(surfaceFromForum({ id: 12 })).toBe(false);
    expect(surfaceFromForum(null)).toBe(false);
  });

  it("a new layout started from a linked template takes the surface the server gives it (the forum's)", () => {
    expect(venueDraft(doc({ surface: "carpet" })).info.surface).toBe("carpet");
  });
});
