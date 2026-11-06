// Picking the forum venue and track a template links to (#65): the draft it makes, the default name, the area
// auto-fill and the "differs from the forum" note. Pure, so no browser needed.
import { validateVenue } from "@track-studio/engine";
import { describe, expect, it } from "vitest";
import { areaDiffers, filterForumVenues, onlyTrack, pickForumTrack, pickForumVenue, type ForumVenue } from "../src/venues/forum.js";
import { blankVenue, venueBody, type VenueDraft } from "../src/venues/model.js";

const main: ForumVenue = {
  id: 12,
  name: "Misfits Main Hall",
  town: "Leeds",
  tracks: [
    { id: 31, name: "Indoor carpet", surface: "carpet", environment: "indoor", width_m: 12.5, length_m: 24 },
    { id: 32, name: "Outdoor tarmac", surface: "tarmac", environment: "outdoor", width_m: null, length_m: null },
  ],
};
const village: ForumVenue = { id: 14, name: "Village Hall", town: "Otley", tracks: [{ id: 40, name: "Main floor", width_m: 10, length_m: 18 }] };

const drawn = (): VenueDraft => ({ ...blankVenue(), info: { name: "Our hall", venue: null }, area: { length: 20, width: 10 } });

describe("picking a forum venue and track", () => {
  it("saves info.venue with both ids and names", () => {
    const d = pickForumTrack(drawn(), main, main.tracks[0], { isNew: false });
    expect(d.info.venue).toEqual({ id: 12, name: "Misfits Main Hall", trackId: 31, trackName: "Indoor carpet" });
    const body = venueBody(d);
    expect(body.info.venue).toEqual({ id: 12, name: "Misfits Main Hall", trackId: 31, trackName: "Indoor carpet" });
    expect(validateVenue({ format: "rcvenue", version: 1, id: "x", revision: 1, ...body }).valid).toBe(true);
  });

  it("picking the venue alone keeps the track open, unless the venue has only one", () => {
    expect(onlyTrack(main)).toBeNull();
    expect(onlyTrack(village)).toBe(village.tracks[0]);
    expect(pickForumVenue(drawn(), main, { isNew: false }).info.venue).toEqual({ id: 12, name: "Misfits Main Hall" });
    expect(pickForumVenue(drawn(), village, { isNew: false }).info.venue).toEqual({ id: 14, name: "Village Hall", trackId: 40, trackName: "Main floor" });
  });

  it("the template name defaults to '<venue> – <track>', and follows a new pick until it's typed over", () => {
    const blank = blankVenue();
    const a = pickForumTrack(blank, main, main.tracks[0], { isNew: true });
    expect(a.info.name).toBe("Misfits Main Hall – Indoor carpet");
    const b = pickForumTrack(a, main, main.tracks[1], { isNew: true });
    expect(b.info.name).toBe("Misfits Main Hall – Outdoor tarmac");
    const typed = { ...b, info: { ...b.info, name: "Summer track" } };
    expect(pickForumTrack(typed, village, village.tracks[0], { isNew: true }).info.name).toBe("Summer track");
  });

  it("fills an empty area from the forum track's width and length (length east–west)", () => {
    // a new template still on the blank area counts as empty
    expect(pickForumTrack(blankVenue(), main, main.tracks[0], { isNew: true }).area).toEqual({ length: 24, width: 12.5 });
    // a drawn area stays as it is: it can be smaller than the hall on purpose
    expect(pickForumTrack(drawn(), main, main.tracks[0], { isNew: false }).area).toEqual({ length: 20, width: 10 });
    expect(pickForumTrack(blankVenue(), main, main.tracks[0], { isNew: false }).area).toEqual(blankVenue().area);
    // no numbers on the forum: nothing to fill
    expect(pickForumTrack(blankVenue(), main, main.tracks[1], { isNew: true }).area).toEqual(blankVenue().area);
    // an area that isn't a size yet is empty too
    expect(pickForumTrack({ ...drawn(), area: { length: 0, width: Number.NaN } }, main, main.tracks[0], { isNew: false }).area).toEqual({ length: 24, width: 12.5 });
  });

  it("says when the area differs from the forum's numbers (W × L), and not otherwise", () => {
    expect(areaDiffers({ length: 20, width: 10 }, main.tracks[0])).toBe("Differs from the forum (12.5 × 24 m).");
    expect(areaDiffers({ length: 24, width: 12.5 }, main.tracks[0])).toBeNull();
    expect(areaDiffers({ length: 20, width: 10 }, main.tracks[1])).toBeNull();
    expect(areaDiffers({ length: 20, width: 10 }, null)).toBeNull();
  });
});

describe("searching forum venues", () => {
  it("matches name, town or track name, ignoring case and accents", () => {
    const all = [main, village];
    expect(filterForumVenues(all, "")).toEqual(all);
    expect(filterForumVenues(all, "village").map((v) => v.id)).toEqual([14]);
    expect(filterForumVenues(all, "OTLEY").map((v) => v.id)).toEqual([14]);
    expect(filterForumVenues(all, "tarmac").map((v) => v.id)).toEqual([12]);
    expect(filterForumVenues([{ ...village, name: "Salle Pétanque" }], "petanque")).toHaveLength(1);
  });
});
