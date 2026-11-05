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
const { VenuePage } = await import("../src/pages/Venues.js");
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

function html(node: ReactNode, path = "/", signedIn = true): string {
  return renderToStaticMarkup(
    <SessionContext.Provider value={signedIn ? session() : { ...session(), me: null }}>
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
  const venue: VenueSummary = { id: "winter-3", name: "Club Hall", forumVenueId: null, ownerId: 1, revision: 3, tracks: 0, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z" };
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

describe("track page", () => {
  const doc = JSON.parse(readFileSync(join(ROOT, "reference/examples/club-a.rctrack.json"), "utf8")) as RcTrack;
  const can = (over: Partial<Permissions> = {}): Permissions => ({ edit: false, submit: false, approve: false, archive: false, adapt: false, copy: false, ...over });
  const revisions: Revision[] = [
    { revision: 4, createdAt: "2026-11-02T10:00:00Z", createdBy: { id: 1, username: "yeti" }, note: null, status: "submitted", previewUrl: "", downloadUrl: "/d/4" },
    { revision: 3, createdAt: "2026-10-19T10:00:00Z", createdBy: { id: 1, username: "yeti" }, note: "wider", status: "approved", previewUrl: "", downloadUrl: "/d/3" },
    { revision: 2, createdAt: "2026-10-01T10:00:00Z", createdBy: { id: 999, username: null }, note: "imported", status: "draft", previewUrl: "", downloadUrl: "/d/2" },
  ];
  const page = (c: Permissions, over: Partial<TrackSummary> = {}, d: RcTrack = doc) => {
    const res: TrackResponse = { track: summary({ status: "submitted", approvedRevision: null, ...over }), doc: d, can: c };
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

describe("styles", () => {
  const css = readFileSync(join(WEB, "src/styles.css"), "utf8");
  const tsx = ["src/components/Header.tsx", "src/components/TrackCard.tsx", "src/components/bits.tsx", "src/components/states.tsx", "src/components/LibraryResults.tsx", "src/components/ChecksList.tsx", "src/components/FitPanel.tsx", "src/pages/Library.tsx", "src/pages/TrackPage.tsx", "src/pages/NotFound.tsx"];

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
