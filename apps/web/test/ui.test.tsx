// Library, track page and header (#10): layout, states and actions, rendered to HTML on the server side.
import type { Check, RcTrack, RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permissions, Revision, TrackResponse, TrackSummary, VenueRevision, VenueSummary } from "../src/lib/api.js";
import type { Loadable } from "../src/lib/hooks.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB = join(ROOT, "apps/web");

// useApi is replaced by canned answers per path; everything else in hooks is real
const answers = new Map<string, Partial<Loadable<unknown>>>();
const requested: (string | null)[] = [];
vi.mock("../src/lib/hooks.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/hooks.js")>();
  return {
    ...real,
    useApi: (path: string | null) => (requested.push(path), { data: undefined, error: undefined, loading: path !== null, reload: () => {}, ...(path ? answers.get(path.split("?")[0]) : {}) }),
  };
});

// TrackPage reads :id from the route
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useParams: () => ({ id: "winter-3" }) }));

const { Header } = await import("../src/components/Header.js");
const { TrackCard } = await import("../src/components/TrackCard.js");
const { StatusBadge } = await import("../src/components/bits.js");
const { EmptyState, ErrorAlert, CardGridSkeleton } = await import("../src/components/states.js");
const { LibraryResults } = await import("../src/components/LibraryResults.js");
const { checksSummary } = await import("../src/components/ChecksList.js");
const { Library } = await import("../src/pages/Library.js");
const { TrackPage } = await import("../src/pages/TrackPage.js");
const { EditTrackPage } = await import("../src/designer/pages.js");
const { VenuePage, Venues } = await import("../src/pages/Venues.js");
const { LapSpeeds } = await import("../src/pages/LapSpeeds.js");
const { ForumVenuePicker } = await import("../src/venues/ForumVenuePicker.js");
const fmt = await import("../src/lib/format.js");
const { SessionContext } = await import("../src/lib/session.js");

vi.stubGlobal("window", { location: { origin: "https://tracks.example", pathname: "/", search: "" } });

const session = (organiser = false) => ({
  me: { id: 1, username: "yeti", name: null, avatarUrl: null, organiser, admin: false, moderator: false },
  config: null,
  ready: true,
  refresh: async () => {},
  logout: async () => {},
  loginUrl: () => "/auth/login",
});

const FORUM = { devLogin: false, forumUrl: "https://forum.example", baseUrl: "https://tracks.example", organiserGroup: "track-admins" };

function html(node: ReactNode, path = "/", signedIn = true): string {
  return renderToStaticMarkup(
    <SessionContext.Provider value={signedIn ? { ...session(), config: FORUM } : { ...session(), me: null }}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </SessionContext.Provider>,
  );
}

const summary = (over: Partial<TrackSummary> = {}): TrackSummary => ({
  id: "winter-3",
  name: "Winter Carpet Layout 3",
  status: "approved",
  author: { id: 1, username: "yeti" },
  revision: 4,
  approvedRevision: 4,
  publicRevision: 4,
  newerRevision: null,
  errors: 0,
  derivedFrom: null,
  locked: "library",
  latestPreviewUrl: "/p/winter-3/4.png",
  lapLength: 38.43,
  corners: 12,
  size: { length: 21.6, width: 11.8 },
  area: { length: 22, width: 12 },
  footprint: { width: 22, height: 12 },
  venue: { id: "main-hall", name: "Misfits Main Hall" },
  venueTemplateId: null,
  derivedFromId: null,
  createdAt: "2026-10-14T10:00:00Z",
  updatedAt: "2026-11-02T10:00:00Z",
  url: "/t/winter-3",
  previewUrl: "/p/winter-3/4.png",
  ...over,
});

const SPEEDS = [
  { class: "2WD Buggy", speed: 6.5 },
  { class: "4WD Buggy", speed: 7 },
];

const loadable = <T,>(over: Partial<Loadable<T>>): Loadable<T> => ({ data: undefined, error: undefined, loading: false, reload: () => {}, ...over });

/** text content, tags stripped, whitespace collapsed */
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

beforeEach(() => {
  answers.clear();
  requested.length = 0;
});

describe("status badge", () => {
  it("is a pill with the word, one modifier per state", () => {
    expect(html(<StatusBadge status="draft" />)).toBe('<span class="ts-badge">Draft</span>');
    for (const s of ["submitted", "approved", "archived"] as const) expect(html(<StatusBadge status={s} />)).toContain(`class="ts-badge ts-badge--${s}"`);
  });
});

describe("states", () => {
  it("empty: title, text and one action", () => {
    const h = html(<EmptyState title="No tracks yet" action={<a href="/new">Draw a track</a>}>Be the first.</EmptyState>);
    expect(h).toContain('class="ts-empty"');
    expect(text(h)).toBe("No tracks yet Be the first. Draw a track");
  });

  it("error: an alert saying what went wrong, with a retry", () => {
    const h = html(<ErrorAlert title="Couldn't load tracks." onRetry={() => {}}>The server didn't answer.</ErrorAlert>);
    expect(h).toContain('role="alert"');
    expect(h).toContain('class="ts-alert"');
    expect(text(h)).toContain("Couldn't load tracks. The server didn't answer. Try again");
  });

  it("loading: card-shaped skeletons, busy for assistive tech", () => {
    const h = html(<CardGridSkeleton count={3} />);
    expect(h).toContain('aria-busy="true"');
    expect(h.match(/class="ts-card ts-card--skeleton"/g)).toHaveLength(3);
  });
});

describe("track card", () => {
  it("plan, name, badge, meta and three figures; the whole card links to the track", () => {
    const h = html(<TrackCard track={summary()} />);
    expect(h).toContain('class="ts-card');
    expect(h).toContain('<a class="ts-card__link" href="/t/winter-3"');
    expect(h).toContain('class="ts-card__plan"');
    expect(h).toContain("ts-badge--approved");
    const t = text(h);
    expect(t).toContain("Winter Carpet Layout 3");
    expect(t).toContain("by yeti · Misfits Main Hall · revision 4");
    expect(t).toContain("Lap 38.4 m");
    expect(t).toContain("Corners 12");
    expect(t).toContain("Size 22 × 12 m");
  });

  it("shows a newer revision in progress, and venue-less tracks", () => {
    const t = text(html(<TrackCard track={summary({ venue: null, newerRevision: { revision: 5, status: "submitted" } })} />));
    expect(t).toContain("by yeti · No venue · revision 4");
    expect(t).toContain("Revision 5 submitted for approval");
  });

  it("a track whose author has no user row shows as Unknown (#46)", () => {
    const t = text(html(<TrackCard track={summary({ author: { id: 999, username: null } })} />));
    expect(t).toContain("by Unknown · Misfits Main Hall · revision 4");
  });

  it("in fits mode, lists each orientation with the space left, linking to the fit preview", () => {
    const fit = { revision: 4, results: [{ orientation: "as designed", spare: [2, 1], thumbUrl: "/f/1.png" }, { orientation: "mirrored", spare: [2, 1], thumbUrl: "/f/2.png" }] };
    const h = html(<TrackCard track={summary({ fit } as unknown as Partial<TrackSummary>)} fitVenueId="hall" />);
    expect(h).toContain('href="/t/winter-3?fit=hall&amp;o=mirrored"');
    expect(text(h)).toContain("as designed 2 × 1 m spare");
    expect(h).toContain('src="/f/1.png"');
  });
});

describe("library results", () => {
  const props = { anyFilter: false, onClear: () => {} };

  it("loading → card skeletons", () => {
    expect(html(<LibraryResults {...props} list={loadable({ loading: true })} />)).toContain("ts-card--skeleton");
  });

  it("error → alert with retry", () => {
    const h = html(<LibraryResults {...props} list={loadable({ error: new Error("boom") })} />);
    expect(h).toContain('role="alert"');
    expect(text(h)).toMatch(/Couldn't load the tracks\..*Try again/);
  });

  it("no tracks at all → invite to draw one", () => {
    const h = html(<LibraryResults {...props} list={loadable({ data: { tracks: [] } })} />);
    expect(h).toContain("ts-empty");
    expect(text(h)).toContain("No tracks yet");
    expect(h).toContain('href="/new"');
  });

  it("no results for a filter → offer to clear the filters", () => {
    const h = html(<LibraryResults {...props} anyFilter list={loadable({ data: { tracks: [] } })} />);
    expect(text(h)).toContain("No tracks match these filters");
    expect(text(h)).toContain("Clear filters");
  });

  it("no fits → names the venue, invites a new track", () => {
    const h = html(<LibraryResults {...props} anyFilter fits="hall" fitVenueName="Village Hall" list={loadable({ data: { tracks: [] } })} />);
    expect(text(h)).toContain("No tracks fit Village Hall yet");
    expect(h).toContain('href="/new"');
  });

  it("Mine with no tracks → invite to start a design", () => {
    const h = html(<LibraryResults {...props} mine list={loadable({ data: { tracks: [] } })} />);
    expect(h).toContain("ts-empty");
    expect(text(h)).toContain("Nothing of yours here yet");
    expect(h).toMatch(/<a [^>]*href="\/new"[^>]*>.*Start a design<\/a>/);
  });

  it("Mine plus other filters with no tracks → offer to clear the filters", () => {
    const h = html(<LibraryResults {...props} mine anyFilter list={loadable({ data: { tracks: [] } })} />);
    expect(text(h)).toContain("No tracks match these filters");
  });

  it("tracks → a grid of cards", () => {
    const h = html(<LibraryResults {...props} list={loadable({ data: { tracks: [summary(), summary({ id: "b", name: "Club Night" })] } })} />);
    expect(h.match(/class="ts-card"/g)).toHaveLength(2);
  });
});

describe("library page", () => {
  it("title, counts, New track, and the filters", () => {
    answers.set("/api/tracks", { data: { tracks: [summary()] }, loading: false });
    answers.set("/api/venues", { data: { venues: [{ id: "main-hall", name: "Misfits Main Hall" }] }, loading: false });
    const h = html(<Library />);
    const t = text(h);
    expect(h).toMatch(/<h1[^>]*>Track library<\/h1>/);
    expect(t).toContain("1 track · 1 venue");
    expect(h).toMatch(/<a [^>]*class="ts-btn ts-btn--primary"[^>]*href="\/new"|href="\/new"[^>]*class="ts-btn ts-btn--primary"/);
    for (const label of ["Search", "Venue", "Fits my venue", "Status", "Lap", "Corners"]) expect(t).toContain(label);
    expect(h).toContain('aria-pressed="false"');
    expect(h).toContain("Misfits Main Hall");
  });

  it("signed in: a Mine toggle beside the status filters, off by default", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    const h = html(<Library />);
    expect(h).toMatch(/<button [^>]*aria-pressed="false"[^>]*>Mine<\/button>/);
    expect(h.indexOf(">Mine<")).toBeGreaterThan(h.indexOf(">Archived<"));
    expect(h.indexOf(">Mine<")).toBeLessThan(h.indexOf("Lap (m)"));
    expect(requested).toContain("/api/tracks");
  });

  it("signed out: no Mine toggle, and ?mine=1 is ignored", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    const h = html(<Library />, "/?mine=1", false);
    expect(text(h)).not.toContain("Mine");
    expect(requested.filter((p) => p?.startsWith("/api/tracks"))).toEqual(["/api/tracks"]);
  });

  it("?mine=1 asks for author=me, presses Mine and counts it behind Filters", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    const h = html(<Library />, "/?mine=1&status=draft");
    expect(h).toMatch(/<button [^>]*aria-pressed="true"[^>]*>Mine<\/button>/);
    expect(requested).toContain("/api/tracks?status=draft&author=me");
    expect(text(h)).toContain("Filters · 2");
  });

  it("Mine stays usable with Fits my venue and combines with it", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    const h = html(<Library />, "/?mine=1&fits=hall");
    expect(h).toMatch(/<button [^>]*aria-pressed="true"[^>]*>Mine<\/button>/);
    expect(h).not.toMatch(/<button [^>]*disabled=""[^>]*>Mine<\/button>/);
    expect(requested).toContain("/api/tracks?fits=hall&author=me");
  });

  it("?mine=1 waits for the session before asking", () => {
    const h = renderToStaticMarkup(
      <SessionContext.Provider value={{ ...session(), me: null, ready: false }}>
        <MemoryRouter initialEntries={["/?mine=1"]}>
          <Library />
        </MemoryRouter>
      </SessionContext.Provider>,
    );
    expect(h).toContain("ts-card--skeleton");
    expect(requested.filter((p) => p?.startsWith("/api/tracks"))).toEqual([]);
  });

  it("Raced at <venue>: a filter when the forum reports raced venues; it asks for racedAt and counts behind Filters (#66)", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    answers.set("/api/raced-venues", { data: { venues: [{ id: 7, name: "Misfits Hall", layouts: 2 }, { id: 9, name: "The Barn", layouts: 1 }] }, loading: false });
    const h = html(<Library />, "/?racedAt=9");
    expect(h).toMatch(/<label class="ts-label" for="f-raced">Raced at<\/label>/);
    expect(h).toMatch(/<option value="9" selected="">The Barn<\/option>/);
    expect(h).toContain(">Anywhere</option>");
    expect(requested).toContain("/api/tracks?racedAt=9");
    expect(text(h)).toContain("Filters · 1");
  });

  it("no raced venues (or the forum down): no Raced at filter", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    answers.set("/api/raced-venues", { data: { venues: [], unavailable: true }, loading: false });
    expect(text(html(<Library />))).not.toContain("Raced at");
    answers.set("/api/raced-venues", { error: new Error("down"), loading: false });
    expect(text(html(<Library />))).not.toContain("Raced at");
  });

  it("Typical lap for <class> between X and Y s, sorted by typical lap: asks the server and counts behind Filters (#76)", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    answers.set("/api/class-speeds", { data: { classes: SPEEDS }, loading: false });
    const h = html(<Library />, "/?lapClass=2WD+Buggy&minTypical=12&maxTypical=16&sort=typical");
    expect(h).toMatch(/<label class="ts-label" for="f-class">Typical lap for<\/label>/);
    expect(h).toMatch(/<option value="2WD Buggy" selected="">2WD Buggy<\/option>/);
    expect(h).toContain(">4WD Buggy</option>");
    expect(h).toMatch(/<option value="typical" selected="">Fastest typical lap<\/option>/);
    expect(h).toMatch(/aria-label="Shortest typical lap in seconds"[^>]*value="12"/);
    expect(requested).toContain("/api/tracks?lapClass=2WD+Buggy&minTypical=12&maxTypical=16&sort=typical");
    expect(text(h)).toContain("Filters · 4");
  });

  it("no class picked: the typical lap range and sort are off and not sent (#76)", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    answers.set("/api/class-speeds", { data: { classes: SPEEDS }, loading: false });
    const h = html(<Library />, "/?minTypical=12&sort=typical");
    expect(h).toMatch(/<input [^>]*disabled=""[^>]*aria-label="Shortest typical lap in seconds"|<input [^>]*aria-label="Shortest typical lap in seconds"[^>]*disabled=""/);
    expect(h).toMatch(/<select id="f-sort"[^>]*disabled=""/);
    expect(requested).toContain("/api/tracks");
  });

  it("a class in the URL matches ignoring case; a bad sort or range in the URL isn't sent (#76)", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    answers.set("/api/class-speeds", { data: { classes: SPEEDS }, loading: false });
    const h = html(<Library />, "/?lapClass=2wd+buggy&sort=fastest&minTypical=abc&maxTypical=16");
    expect(h).toMatch(/<option value="2WD Buggy" selected="">2WD Buggy<\/option>/);
    expect(h.match(/>2WD Buggy<\/option>/g)).toHaveLength(1);
    expect(requested).toContain("/api/tracks?lapClass=2WD+Buggy&maxTypical=16");
  });

  it("cards show the typical lap for the picked class: the forum's, or the estimate marked est. (#76)", () => {
    const list = loadable({ data: { tracks: [summary({ id: "a", typicalLap: { seconds: 14.83, est: false } }), summary({ id: "b", typicalLap: { seconds: 14.6, est: true } }), summary({ id: "c", typicalLap: null })] } });
    const t = text(html(<LibraryResults list={list} anyFilter onClear={() => {}} lapClass="2WD Buggy" />));
    expect(t).toContain("2WD Buggy 14.8 s");
    expect(t).toContain("2WD Buggy ≈ 14.6 s est.");
    expect(t).toContain("2WD Buggy —");
    // no class picked: no lap time figure
    expect(text(html(<TrackCard track={summary()} />))).not.toContain(" s ");
  });

  it("the venue list failing still leaves the library usable, and says so", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    answers.set("/api/venues", { error: new Error("down"), loading: false });
    expect(text(html(<Library />))).toContain("Couldn't load the venues");
  });
});

describe("checks summary", () => {
  const c = (level: Check["level"], message: string): Check => ({ level, code: "x", message }) as unknown as Check;
  it("plain words for each case", () => {
    expect(checksSummary([])).toBe("No problems.");
    expect(checksSummary([c("warning", "Corner 3 is tight")])).toBe("No errors. 1 warning: Corner 3 is tight.");
    expect(checksSummary([c("warning", "a"), c("warning", "b"), c("info", "c")])).toBe("No errors. 2 warnings.");
    expect(checksSummary([c("error", "a"), c("warning", "b")])).toBe("1 error, 1 warning.");
    expect(checksSummary([c("error", "a"), c("error", "b")])).toBe("2 errors.");
  });
});

describe("revision authors (#30)", () => {
  it("a missing username reads Unknown", () => {
    expect(fmt.author({ id: 1, username: "yeti" })).toBe("yeti");
    expect(fmt.author({ id: 999, username: null })).toBe("Unknown");
  });
});

describe("venue page", () => {
  const doc = JSON.parse(readFileSync(join(ROOT, "reference/venues/club-hall.rcvenue.json"), "utf8")) as RcVenue;
  const venue: VenueSummary = { id: "winter-3", name: "Club Hall", forumVenueId: null, forumTrackId: null, ownerId: 1, revision: 3, tracks: 0, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z" };
  const rev = (revision: number, createdBy: VenueRevision["createdBy"]): VenueRevision => ({ revision, createdAt: "2026-11-02T10:00:00Z", createdBy, name: "Club Hall", area: { length: 22, width: 12 }, obstacles: 1, downloadUrl: `/d/${revision}` });

  it("a revision whose author has no user row shows as Unknown (#30)", () => {
    answers.set("/api/venues/winter-3", { data: { venue, doc, can: { edit: false } }, loading: false });
    answers.set("/api/venues/winter-3/revisions", { data: { revisions: [rev(3, { id: 1, username: "yeti" }), rev(2, { id: 999, username: null }), rev(1, { id: 1, username: "yeti" })] }, loading: false });
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    const h = html(<VenuePage />, "/v/winter-3");
    expect(text(h)).toMatch(/r2 .*· Unknown · 22 × 12/);
    for (const n of [3, 2, 1]) expect(h).toContain(`aria-label="Download revision ${n}"`);
  });
});

describe("forum venue and track (#65)", async () => {
  const { ApiError } = await import("../src/lib/api.js");
  const doc = JSON.parse(readFileSync(join(ROOT, "reference/venues/club-hall.rcvenue.json"), "utf8")) as RcVenue;
  const linkedDoc: RcVenue = { ...doc, info: { ...doc.info, venue: { id: 12, name: "Misfits Main Hall", trackId: 31, trackName: "Indoor carpet" } } };
  const venue: VenueSummary = { id: "winter-3", name: "Club Hall", forumVenueId: 12, forumTrackId: 31, ownerId: 1, revision: 3, tracks: 0, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z" };
  const list = {
    venues: [
      { id: 1, name: "Club hall", town: "Leeds", tracks: [{ id: 5, name: "Carpet", width_m: 12, length_m: 22 }, { id: 6, name: "Astro", width_m: null, length_m: null }] },
      { id: 12, name: "Misfits Main Hall", town: "Otley", tracks: [{ id: 31, name: "Indoor carpet", width_m: 12, length_m: 22 }] },
    ],
    fetchedAt: "2026-11-06T09:00:00Z",
    stale: false,
  };
  const picker = (value: RcVenue["info"]["venue"], area = { length: 22, width: 12 }) =>
    html(<ForumVenuePicker value={value ?? null} area={area} isNew={false} onPick={() => {}} onClear={() => {}} />, "/v/winter-3/edit");

  it("no link yet: a searchable list of the forum's venues; the typed ID box is gone", () => {
    answers.set("/api/forum-venues", { data: list, loading: false });
    const h = picker(null);
    expect(h).toContain('role="combobox"');
    expect(text(h)).toContain("Club hall");
    expect(text(h)).toContain("Misfits Main Hall");
    expect(text(h)).not.toContain("Forum venue ID");
  });

  it("a linked template shows the forum venue and track", () => {
    answers.set("/api/forum-venues", { data: list, loading: false });
    const t = text(picker(linkedDoc.info.venue));
    expect(t).toContain("Misfits Main Hall");
    expect(t).toContain("Indoor carpet");
    expect(t).toContain("Change");
  });

  it("a template with only info.venue.id shows 'Pick the track' with that venue's tracks", () => {
    answers.set("/api/forum-venues", { data: list, loading: false });
    const t = text(picker({ id: 1, name: "Club hall" }));
    expect(t).toContain("Pick the track");
    expect(t).toContain("Carpet");
    expect(t).toContain("Astro");
  });

  it("the area differs from the forum track: a note, nothing changed", () => {
    answers.set("/api/forum-venues", { data: list, loading: false });
    expect(text(picker(linkedDoc.info.venue, { length: 20, width: 10 }))).toContain("Differs from the forum (12 × 22 m).");
    expect(text(picker(linkedDoc.info.venue))).not.toContain("Differs");
  });

  it("forum unreachable: 'Forum unavailable', and the saved link still shows", () => {
    answers.set("/api/forum-venues", { error: new ApiError(503, "forum-unavailable", "Forum unavailable: it didn't answer."), loading: false });
    const t = text(picker(linkedDoc.info.venue));
    expect(t).toContain("Forum unavailable");
    expect(t).toContain("Misfits Main Hall");
    expect(text(picker({ id: 1, name: "Club hall" }))).toContain("Pick the track");
    expect(text(picker(null))).toContain("Forum unavailable");
  });

  it("forum down with a cached list: the list, saying how old it is", () => {
    answers.set("/api/forum-venues", { data: { ...list, stale: true }, loading: false });
    const t = text(picker(null));
    expect(t).toContain("Club hall");
    expect(t).toMatch(/forum isn't answering.*6 Nov/);
  });

  it("venues page and venue page show the forum venue and track, linked to the forum", () => {
    answers.set("/api/venues", { data: { venues: [venue] }, loading: false });
    answers.set("/api/venues/winter-3", { data: { venue, doc: linkedDoc, can: { edit: false } }, loading: false });
    answers.set("/api/venues/winter-3/revisions", { data: { revisions: [] }, loading: false });
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    for (const h of [html(<Venues />, "/v"), html(<VenuePage />, "/v/winter-3")]) {
      expect(text(h)).toContain("Misfits Main Hall · Indoor carpet");
      expect(h).toContain('href="https://forum.example/venues/12"');
      expect(text(h)).not.toContain("Pick the track");
    }
  });

  it("templates saved before the track link (rcvenue 1.0) say 'Pick the track' on the venues and venue pages", () => {
    const oldDoc: RcVenue = { ...doc, info: { ...doc.info, venue: { id: 12, name: "Misfits Main Hall" } } };
    answers.set("/api/venues", { data: { venues: [venue] }, loading: false });
    answers.set("/api/venues/winter-3", { data: { venue, doc: oldDoc, can: { edit: false } }, loading: false });
    answers.set("/api/venues/winter-3/revisions", { data: { revisions: [] }, loading: false });
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    for (const h of [html(<Venues />, "/v"), html(<VenuePage />, "/v/winter-3")]) {
      expect(text(h)).toContain("Misfits Main Hall · Pick the track");
      expect(text(h)).not.toContain("no track picked");
    }
  });
});

describe("track page", () => {
  const doc = JSON.parse(readFileSync(join(ROOT, "reference/examples/club-a.rctrack.json"), "utf8")) as RcTrack;
  const can = (over: Partial<Permissions> = {}): Permissions => ({ edit: false, submit: false, approve: false, archive: false, adapt: false, copy: false, ...over });
  const revisions: Revision[] = [
    { revision: 4, createdAt: "2026-11-02T10:00:00Z", createdBy: { id: 1, username: "yeti" }, note: null, status: "submitted", previewUrl: "", downloadUrl: "/d/4" },
    { revision: 3, createdAt: "2026-10-19T10:00:00Z", createdBy: { id: 1, username: "yeti" }, note: "wider", status: "approved", previewUrl: "", downloadUrl: "/d/3" },
    { revision: 2, createdAt: "2026-10-01T10:00:00Z", createdBy: { id: 999, username: null }, note: "imported", status: "draft", previewUrl: "", downloadUrl: "/d/2" },
  ];
  const page = (c: Permissions, over: Partial<TrackSummary> = {}, d: RcTrack = doc, used: TrackResponse["usedAt"] = { events: [], venues: [] }, lapStats: TrackResponse["lapStats"] = { classes: [] }) => {
    const res: TrackResponse = { track: summary({ status: "submitted", approvedRevision: null, locked: null, ...over }), doc: d, can: c, usedAt: used, lapStats };
    answers.set("/api/tracks/winter-3", { data: res, loading: false });
    answers.set("/api/tracks/winter-3/revisions", { data: { revisions }, loading: false });
    return html(<TrackPage />, "/t/winter-3");
  };

  it("loading → a skeleton in the page's shape", () => {
    const h = html(<TrackPage />, "/t/winter-3");
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain("ts-skeleton");
  });

  it("error → alert with retry; 404 → not found", async () => {
    answers.set("/api/tracks/winter-3", { error: new Error("Request failed (500)"), loading: false });
    const h = html(<TrackPage />, "/t/winter-3");
    expect(h).toContain('role="alert"');
    expect(text(h)).toMatch(/Couldn't load this track\..*Try again/);
    const { ApiError } = await import("../src/lib/api.js");
    answers.set("/api/tracks/winter-3", { error: new ApiError(404, "not-found", "Track not found"), loading: false });
    expect(text(html(<TrackPage />, "/t/winter-3"))).toContain("Not found");
  });

  it("head: back link, name, badge, byline", () => {
    const h = page(can());
    const t = text(h);
    expect(h).toMatch(/href="\/"[^>]*>.*Library/);
    expect(h).toMatch(/<h1[^>]*>Winter Carpet Layout 3<\/h1>/);
    expect(h).toContain("ts-badge--submitted");
    expect(t).toContain("by yeti · Misfits Main Hall · revision 4");
  });

  it("a track whose author has no user row shows as Unknown (#46)", () => {
    expect(text(page(can(), { author: { id: 999, username: null } }))).toContain("by Unknown · Misfits Main Hall · revision 4");
  });

  it("key figures in Oswald: lap to one decimal, corners, track area, jumps", () => {
    const h = page(can());
    const b = doc.built!;
    const t = text(h);
    expect(h).toContain('class="ts-figures ts-figures--key"');
    expect(t).toContain(`Lap length ${b.lapLength.toFixed(1)} m`);
    expect(t).toContain(`Corners ${b.stats.corners}`);
    expect(t).toContain(`Track area ${doc.area!.length} × ${doc.area!.width} m`);
    expect(t).toContain(`Jumps ${b.features.length}`);
  });

  it("checks: summary line and one row per problem", () => {
    // club-a has no problems since rctrack 1.5, so give it some
    const checks: Check[] = [
      { level: "warning", code: "tight-corner", x: 1, z: 2, message: "Corner radius 0.55 m is tighter than a buggy can turn (0.6 m)" },
      { level: "info", code: "radius-reduced", x: 1, z: 2, message: "Corner radius reduced to 0.55 m to fit the straights either side" },
    ];
    const h = page(can(), {}, { ...doc, built: { ...doc.built!, checks } });
    expect(h).toContain('class="ts-checks"');
    expect(text(h)).toContain(checksSummary(checks));
  });

  it("share and download: forum link, embed, .rctrack.json", () => {
    const t = text(page(can()));
    expect(t).toContain("Copy forum link");
    expect(t).toContain("Copy embed");
    expect(t).toContain("Download .rctrack.json");
    expect(page(can())).toContain('href="/api/tracks/winter-3/r/4.rctrack.json"');
  });

  it("revisions: newest first, status words, each one viewable and downloadable", () => {
    const h = page(can());
    const t = text(h);
    expect(t).toContain("Revision 4 · submitted");
    expect(t).toContain("Revision 3 · approved");
    expect(h).toContain('aria-label="Download revision 3"');
  });

  it("a revision whose author has no user row shows as Unknown (#30)", () => {
    const t = text(page(can()));
    expect(t).toContain("by Unknown · imported");
    expect(page(can())).toContain('aria-label="Download revision 2"');
  });

  it("a reader can copy and fit, but not edit, submit, approve or archive", () => {
    const t = text(page(can({ copy: true })));
    expect(t).toContain("Make my own copy");
    expect(t).toContain("Fit to a venue");
    for (const no of ["Edit", "Submit revision", "Approve revision", "Archive"]) expect(t).not.toContain(no);
  });

  it("the author edits and submits; Submit is the one primary action", () => {
    const h = page(can({ edit: true, submit: true, archive: true }), { status: "draft" });
    expect(h).toMatch(/href="\/t\/winter-3\/edit"[^>]*>Edit</);
    expect(h).toMatch(/class="ts-btn ts-btn--primary"[^>]*>Submit revision 4</);
    expect(h).toMatch(/class="ts-btn ts-btn--danger"[^>]*>Archive</);
    expect(h.match(/ts-btn--primary/g)).toHaveLength(1);
  });

  it("a locked layout: Copy and edit is the primary action where Edit was, and the lock is explained (#64)", () => {
    const h = page(can({ copy: true, archive: true }), { status: "approved", approvedRevision: 4, locked: "library" });
    const t = text(h);
    expect(h).toMatch(/<div class="ts-actions"[^>]*><button type="button" class="ts-btn ts-btn--primary"[^>]*>Copy and edit</);
    expect(h.match(/ts-btn--primary/g)).toHaveLength(1);
    expect(t).toContain("Locked: in the library");
    for (const no of ["Make my own copy", "Submit revision", "Approve revision"]) expect(t).not.toContain(no);
    expect(h).not.toContain('href="/t/winter-3/edit"');
    expect(t).toContain("Archive");
    expect(text(page(can({ copy: true }), { status: "approved", locked: "event" }))).toContain("Locked: used by an event");
  });

  it("opening the designer on a locked layout offers Copy and edit instead (#64)", () => {
    page(can({ copy: true }), { status: "approved", approvedRevision: 4, locked: "library" });
    const h = html(<EditTrackPage />, "/t/winter-3/edit");
    expect(text(h)).toContain("This layout is in the library, so it can't be changed. Copy it and edit the copy");
    expect(h).toMatch(/<button type="button" class="btn btn-primary"[^>]*>Copy and edit</);
    page(can({ copy: true }), { status: "draft", locked: null });
    expect(text(html(<EditTrackPage />, "/t/winter-3/edit"))).toContain("Make my own copy");
  });

  it("Used at: the forum's events newest first, linked, with the venue; then Raced at: the venues (#66)", () => {
    const venue = (id: number, name: string) => ({ id, name });
    const used: TrackResponse["usedAt"] = {
      events: [
        { id: 12, title: "Winter Series R3", startDate: "2026-12-06T09:00:00Z", url: "https://forum.test/t/winter-r3/120", venue: venue(9, "The Barn"), venueTrack: venue(3, "Carpet") },
        { id: 11, title: "Club night", startDate: "2026-10-04", url: null, venue: venue(7, "Misfits Hall"), venueTrack: null },
        { id: 10, title: "Practice", startDate: "2026-09-01", url: "https://forum.test/t/practice/100", venue: null, venueTrack: null },
      ],
      venues: [venue(9, "The Barn"), venue(7, "Misfits Hall")],
    };
    const h = page(can(), { status: "approved", locked: "event" }, doc, used);
    const t = text(h);
    expect(h).toMatch(/<h2 id="used-h" class="ts-heading">Used at<\/h2>/);
    expect(h).toMatch(/<a [^>]*href="https:\/\/forum.test\/t\/winter-r3\/120"[^>]*>Winter Series R3<\/a>/);
    expect(t).toContain("Winter Series R3 6 Dec 2026 · The Barn, Carpet");
    expect(t).toContain("Club night 4 Oct 2026 · Misfits Hall");
    expect(h).not.toMatch(/<a [^>]*>Club night/);
    expect(t.indexOf("Winter Series R3")).toBeLessThan(t.indexOf("Club night"));
    expect(t).toContain("Raced at: The Barn, Misfits Hall");
    expect(t).toContain("3 events");
  });

  it("not raced yet: the empty state; forum down: no Used at section at all (#66)", () => {
    const empty = text(page(can()));
    expect(empty).toContain("Used at");
    expect(empty).toContain("Not raced yet");
    const down = page(can(), {}, doc, null);
    expect(text(down)).not.toContain("Used at");
    expect(text(down)).not.toContain("Not raced yet");
    expect(down).not.toContain('role="alert"');
  });

  it("Lap times: a row per class with the typical lap, trimmed mean, laps, meetings and both records linked to the meeting (#76)", () => {
    const rec = (ms: number, name: string, id: number, url: string | null = `https://forum.test/t/round-${id}/${100 + id}`) => ({
      ms,
      driver: { name, username: name.toLowerCase() },
      car: "Losi 22 5.0",
      meeting: { id, title: `Round ${id}`, date: "2026-11-12", url },
    });
    const stats: TrackResponse["lapStats"] = {
      classes: [
        { class: "2WD Buggy", typicalLap: { medianMs: 14812, trimmedMeanMs: 14930, iqrMs: 900, laps: 1412, meetings: 3, updatedAt: "2026-11-13T08:00:00Z" }, recordLap: rec(13921, "Dave", 4), record3: rec(42405, "Sam", 5, null) },
        { class: "4WD Buggy", typicalLap: null, recordLap: { ...rec(12500, "Ex", 6), car: null }, record3: null },
      ],
    };
    answers.set("/api/class-speeds", { data: { classes: SPEEDS }, loading: false });
    const h = page(can(), { status: "approved" }, doc, undefined, stats);
    const t = text(h);
    expect(h).toMatch(/<h2 id="laps-h" class="ts-heading">Lap times<\/h2>/);
    expect(t).toContain("2WD Buggy Typical lap 14.8 s Trimmed mean 14.9 s · 1,412 laps · 3 meetings");
    expect(t).toContain("Lap record 13.92 s Dave · Losi 22 5.0 · 12 Nov 2026");
    expect(h).toMatch(/<a [^>]*href="https:\/\/forum.test\/t\/round-4\/104"[^>]*>12 Nov 2026<\/a>/);
    expect(h).toMatch(/<a [^>]*aria-label="Round 4, 12 Nov 2026"/);
    expect(t).toContain("Best 3 laps 42.41 s Sam · Losi 22 5.0 · 12 Nov 2026");
    // a class with records but no typical lap yet: the estimate, marked est.
    expect(t).toMatch(/4WD Buggy Typical lap ≈ \d+\.\d s est\./);
    expect(t).toContain("Lap record 12.50 s Ex · 12 Nov 2026");
    expect(t).not.toContain("No races on this layout yet");
  });

  it("no races: says so, with the estimate per class from the lap length, marked est.; forum down: no section (#76)", () => {
    answers.set("/api/class-speeds", { data: { classes: SPEEDS }, loading: false });
    const t = text(page(can(), { lapLength: 94.9 }));
    expect(t).toContain("Lap times");
    expect(t).toContain("No races on this layout yet");
    expect(t).toContain("2WD Buggy ≈ 14.6 s est.");
    expect(t).toContain("4WD Buggy ≈ 13.6 s est.");
    const down = text(page(can(), {}, doc, undefined, null));
    expect(down).not.toContain("Lap times");
    expect(down).not.toContain("No races on this layout yet");
  });

  it("an unlocked layout shows no lock note", () => {
    expect(text(page(can({ edit: true }), { status: "draft" }))).not.toContain("Locked");
  });

  it("a copy says Based on <original>, linked (#64)", () => {
    const d = { ...doc, info: { ...doc.info, derivedFrom: { id: "club-a", revision: 2, author: "yeti" } } };
    const h = page(can({ edit: true }), { status: "draft", derivedFrom: { id: "club-a", name: "Club A", author: "yeti" } }, d);
    expect(h).toMatch(/Based on <a href="\/t\/club-a"[^>]*>Club A<\/a>/);
    expect(text(h)).toContain("Based on Club A by yeti (revision 2)");
  });

  it("an organiser approves; with errors, Submit and Approve are disabled and the reason is shown beside them", () => {
    const h = page(can({ approve: true, submit: true }), { errors: 2 });
    expect(h).toMatch(/class="ts-btn ts-btn--primary"[^>]*disabled=""[^>]*>Approve revision 4</);
    expect(text(h)).toContain("Revision 4 has 2 errors — fix them in the designer first.");
  });
});

describe("header", () => {
  it("brand, navigation with the current page marked, the user", () => {
    const h = html(<Header />, "/");
    expect(h).toContain('class="ts-header"');
    expect(h).toContain("brand-logo");
    expect(text(h)).toContain("Track Studio");
    expect(h).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/"[^>]*>Library<\/a>|<a [^>]*href="\/"[^>]*aria-current="page"[^>]*>Library<\/a>/);
    expect(text(h)).toContain("Signed in as yeti");
  });

  it("phones: a 44px menu button controls the navigation", () => {
    const h = html(<Header />, "/");
    expect(h).toMatch(/<button[^>]*aria-label="Menu"[^>]*>/);
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('aria-controls="main-nav"');
    expect(h).toContain('id="main-nav"');
  });

  it("signed out: log in with the forum", () => {
    expect(text(html(<Header />, "/", false))).toContain("Log in with the forum");
  });
});

describe("class speeds (#76)", () => {
  const as = (organiser: boolean, node: ReactNode) =>
    renderToStaticMarkup(
      <SessionContext.Provider value={{ ...session(organiser), config: FORUM }}>
        <MemoryRouter initialEntries={["/lap-speeds"]}>{node}</MemoryRouter>
      </SessionContext.Provider>,
    );

  it("organisers get a Lap speeds link in the header; members don't", () => {
    expect(as(true, <Header />)).toMatch(/<a [^>]*href="\/lap-speeds"[^>]*>Lap speeds<\/a>/);
    expect(as(false, <Header />)).not.toContain("Lap speeds");
  });

  it("organisers edit the speeds; members read them", () => {
    answers.set("/api/class-speeds", { data: { classes: SPEEDS }, loading: false });
    const org = as(true, <LapSpeeds />);
    expect(org).toMatch(/<input [^>]*aria-label="Class 1 name"[^>]*value="2WD Buggy"/);
    expect(org).toMatch(/<input [^>]*aria-label="2WD Buggy speed in metres per second"[^>]*value="6.5"/);
    expect(text(org)).toContain("Save speeds");
    expect(text(org)).toContain("Add a class");
    answers.set("/api/class-speeds", { data: { classes: [] }, loading: false });
    expect(text(as(false, <LapSpeeds />))).toContain("No classes yet");
    answers.set("/api/class-speeds", { data: { classes: SPEEDS }, loading: false });
    const member = as(false, <LapSpeeds />);
    expect(member).not.toContain("<input");
    expect(text(member)).toContain("2WD Buggy 6.5 m/s");
    expect(text(member)).toContain("track-admins");
  });
});

describe("styles", () => {
  const css = readFileSync(join(WEB, "src/styles.css"), "utf8");
  const tsx = ["src/components/Header.tsx", "src/components/TrackCard.tsx", "src/components/bits.tsx", "src/components/states.tsx", "src/components/LibraryResults.tsx", "src/components/ChecksList.tsx", "src/components/FitPanel.tsx", "src/pages/Library.tsx", "src/pages/TrackPage.tsx", "src/pages/NotFound.tsx", "src/pages/LapSpeeds.tsx"];

  it("every ts- class the library and track page use is styled", () => {
    const used = new Set(tsx.flatMap((f) => [...readFileSync(join(WEB, f), "utf8").matchAll(/\bts-[a-z0-9-]+(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?/g)].map((m) => m[0].replace(/-+$/, "")))); // ts-badge--${status} → ts-badge
    const missing = [...used].filter((c) => !new RegExp(`\\.${c.replace(/-/g, "\\-")}(?![\\w-])`).test(css));
    expect(missing).toEqual([]);
  });

  it("skeletons stop pulsing under reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.ts-skeleton[^}]*animation: none/);
  });

  it("the design system's tokens are defined", () => {
    const tokens = readFileSync(join(WEB, "src/theme/tokens.css"), "utf8");
    for (const t of ["bg-raised", "bg-sunken", "bg-hover", "line", "line-strong", "text-muted", "on-accent", "danger-soft", "positive", "positive-soft", "header", "space-4", "radius-md", "control-height", "touch-target", "focus-ring", "font-display", "font-sans"])
      expect(tokens, t).toMatch(new RegExp(`--${t}:`));
  });
});

describe("header on a track page", () => {
  it("marks Library as the current place", () => {
    const h = html(<Header />, "/t/winter-3");
    expect(h).toMatch(/<a [^>]*aria-current="page"[^>]*>Library<\/a>/);
  });
});

describe("review fixes", () => {
  it("one primary action: empty states and log in are secondary", () => {
    answers.set("/api/tracks", { data: { tracks: [] }, loading: false });
    answers.set("/api/venues", { data: { venues: [] }, loading: false });
    expect(html(<Library />).match(/ts-btn--primary/g)).toHaveLength(1);
    expect(html(<Header />, "/", false)).not.toContain("ts-btn--primary");
  });

  it("the card's venue still links to the venue, above the card link", () => {
    expect(html(<TrackCard track={summary()} />)).toContain('<a class="ts-card__venue" href="/v/main-hall"');
  });

  it("loading states are announced", () => {
    const h = html(<CardGridSkeleton count={1} label="Loading tracks" />);
    expect(h).toContain('role="status"');
    expect(text(h)).toContain("Loading tracks…");
  });
});

describe("fit results", async () => {
  const { FitPanel } = await import("../src/components/FitPanel.js");
  const doc = JSON.parse(readFileSync(join(ROOT, "reference/examples/club-a.rctrack.json"), "utf8")) as RcTrack;
  const venue = JSON.parse(readFileSync(join(ROOT, "reference/venues", (await import("node:fs")).readdirSync(join(ROOT, "reference/venues")).find((f) => f.endsWith(".rcvenue.json"))!), "utf8"));
  const panel = () => html(<FitPanel trackId="winter-3" built={doc.built!} initialVenue="hall" />);
  const setup = (fit: Partial<Loadable<unknown>>) => {
    answers.set("/api/venues", { data: { venues: [{ id: "hall", name: "Village Hall" }] }, loading: false });
    answers.set("/api/venues/hall", { data: { doc: venue }, loading: false });
    answers.set("/api/tracks/winter-3/fit/hall", fit);
  };

  it("loading → announced skeleton", () => {
    setup({ loading: true });
    const h = panel();
    expect(h).toContain("ts-skeleton");
    expect(text(h)).toContain("Checking how it fits Village Hall…");
  });

  it("error → alert with retry", () => {
    setup({ error: new Error("Request failed (500)"), loading: false });
    expect(text(panel())).toMatch(/Couldn't check how it fits Village Hall\..*Try again/);
  });

  it("no fit → empty state with one action", () => {
    setup({ data: { results: [] }, loading: false });
    const h = panel();
    expect(h).toContain('<h3 class="ts-empty__title">Doesn&#x27;t fit Village Hall</h3>');
    expect(text(h)).toContain("Choose another venue");
  });

  it("fits → one choice per orientation and the copy button", () => {
    setup({ data: { results: [{ orientation: "as designed", rotation: 0, mirror: false, shift: [0, 0], spare: [1, 2], thumbUrl: "" }] }, loading: false });
    const t = text(panel());
    expect(t).toContain("as designed 1 × 2 m spare");
    expect(t).toMatch(/Make a copy for|Log in to make a copy/);
  });
});
