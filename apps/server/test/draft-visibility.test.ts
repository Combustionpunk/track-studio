// Draft layouts are their author's and the organisers' (#175): nobody else finds one in a list or opens it. Its page,
// API, downloads and pictures answer 404 (not 403), exactly as an id that doesn't exist does. Submitted and approved
// layouts, and a layout a meeting uses, stay public.
import type { RcTrack } from "@track-studio/engine";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { ADMIN, ALICE, BOB, FORUM_URL, forumUp, login, makeApp, ORGANISER, referenceJson, withoutCones } from "./helpers.js";

const CLUB_A = "7c002509-b640-5e9d-8e79-0ae336a2ae04";
const freeform = () => withoutCones(referenceJson<RcTrack>("examples/freeform-example.rctrack.json"));
const NAME = "Alice's secret hairpins";

const req = (app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

/** A forum stub: the events per layout id (the plugin's GET /des/layouts/:id/events); counts calls. */
function forum(byLayout: Record<string, unknown[]>, opts: { down?: boolean } = {}) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (opts.down) throw new Error("connect ECONNREFUSED");
    const m = /\/des\/layouts\/([^/]+)\/events$/.exec(new URL(url).pathname);
    return Response.json({ events: (m && byLayout[decodeURIComponent(m[1])]) ?? [] });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
const MEETING = { id: 1, title: "Round 1", start_date: "2026-12-06", url: `${FORUM_URL}/t/round-1/101`, venue: { id: 7, name: "Misfits Hall" }, venue_track: null };

async function setup(forumFetch: typeof fetch = forum({}).fetch) {
  const { app } = await makeApp({ seeded: true, forumFetch });
  const alice = await login(app, ALICE);
  const bob = await login(app, BOB);
  const org = await login(app, ORGANISER);
  const admin = await login(app, ADMIN);
  const doc = freeform();
  const res = await req(app, "POST", "/api/tracks", alice, { track: { ...doc, info: { ...doc.info, name: NAME } } });
  expect(res.statusCode, res.body).toBe(201);
  const created = res.json() as { track: { id: string; previewUrl: string }; doc: RcTrack };
  return { app, alice, bob, org, admin, id: created.track.id, created };
}

/** Everything that shows a layout to someone who only reads: the API, the downloads, the pages and the pictures. */
const reads = (id: string) => [
  `/api/tracks/${id}`,
  `/api/tracks/${id}/revisions`,
  `/api/tracks/${id}/r/1`,
  `/api/tracks/${id}/r/1.rctrack.json`,
  `/api/tracks/${id}/latest.rctrack.json`,
  `/api/tracks/${id}/fit/venue-1`,
  `/t/${id}`,
  `/t/${id}?r=1`,
  `/t/${id}/edit`,
  `/t/${id}/build`,
  `/embed/${id}`,
  `/p/${id}/1.png`,
  `/p/${id}/1/card.png`,
];

const listed = async (app: FastifyInstance, url: string, cookie?: string) => {
  const res = await req(app, "GET", url, cookie);
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return (res.json().tracks as { id: string }[]).map((t) => t.id);
};

describe("a draft is hidden from visitors and other members (#175)", () => {
  it("isn't in the library, the search, a status or venue filter, or Fits my venue", async () => {
    const { app, bob, id } = await setup();
    for (const who of [undefined, bob]) {
      for (const url of ["/api/tracks", "/api/tracks?status=draft", `/api/tracks?q=${encodeURIComponent("secret")}`, "/api/tracks?fits=venue-1", "/api/tracks?minLap=1", "/api/tracks?lapClass=GT12", "/api/tracks?racedAt=7", "/api/tracks?venue=venue-1"]) {
        const ids = await listed(app, url, who);
        expect(ids, `${who ? "bob" : "signed out"} ${url}`).not.toContain(id);
      }
      // the rest of the library is still there
      expect(await listed(app, "/api/tracks", who)).toContain(CLUB_A);
    }
  });

  it("its API, downloads, pages and pictures answer 404, just like an id that doesn't exist", async () => {
    const { app, bob, id } = await setup();
    for (const who of [undefined, bob]) {
      for (const url of reads(id)) {
        const res = await req(app, "GET", url, who);
        expect(res.statusCode, `${who ? "bob" : "signed out"} ${url}`).toBe(404);
        expect(res.body, url).not.toContain(NAME);
        // the same answer as for a layout that was never there
        const missing = await req(app, "GET", url.replace(id, "00000000-0000-4000-8000-000000000000"), who);
        expect(missing.statusCode, url).toBe(404);
        if (url.startsWith("/api/")) expect(res.json()).toEqual(missing.json());
      }
    }
  });

  it("another member can't copy, adapt, change, submit, approve or archive it: 404, not 403", async () => {
    const { app, bob, id, created } = await setup();
    for (const [method, url, body] of [
      ["POST", `/api/tracks/${id}/copy`, {}],
      ["POST", `/api/tracks/${id}/adapt/venue-1`, {}],
      ["PUT", `/api/tracks/${id}`, { track: created.doc }],
      ["POST", `/api/tracks/${id}/submit`, undefined],
      ["POST", `/api/tracks/${id}/approve`, undefined],
      ["POST", `/api/tracks/${id}/archive`, undefined],
    ] as const) {
      const res = await req(app, method, url, bob, body);
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(404);
      expect(res.json()).toEqual({ error: "not-found", message: "Track not found" });
    }
    // and nothing was made from it
    expect(await listed(app, "/api/tracks?author=me", bob)).toEqual([]);
  });

  it("signed-out writes still say 401 (for a draft and for a missing id alike)", async () => {
    const { app, id } = await setup();
    for (const target of [id, "no-such-track"]) {
      expect((await req(app, "POST", `/api/tracks/${target}/copy`, undefined, {})).statusCode).toBe(401);
      expect((await req(app, "PUT", `/api/tracks/${target}`, undefined, {})).statusCode).toBe(401);
    }
  });

  it("a hidden draft's answers are never cacheable by a shared cache", async () => {
    const { app, alice, id } = await setup();
    for (const url of [`/api/tracks/${id}/r/1.rctrack.json`, `/api/tracks/${id}/latest.rctrack.json`, `/p/${id}/1.png`, `/p/${id}/1/card.png`]) {
      const res = await req(app, "GET", url, alice);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("private, no-cache");
    }
    // a public layout's stay shared
    expect((await req(app, "GET", `/api/tracks/${CLUB_A}/latest.rctrack.json`)).headers["cache-control"]).toBe("public, max-age=60");
  });
});

describe("a hidden draft doesn't show through other things (#175)", () => {
  const venueTracks = async (app: FastifyInstance, cookie?: string) => {
    const list = (await req(app, "GET", "/api/venues", cookie)).json().venues as { id: string; tracks: number }[];
    return { list: list.find((v) => v.id === "venue-1")!.tracks, page: (await req(app, "GET", "/api/venues/venue-1", cookie)).json().venue.tracks as number };
  };

  it("a venue's track count leaves out drafts drawn for it, and counts them once submitted", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({}).fetch });
    const alice = await login(app, ALICE);
    const before = await venueTracks(app);
    const res = await req(app, "POST", "/api/tracks", alice, { track: freeform(), fromVenue: "venue-1" });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().track.id as string;
    expect(res.json().track.venueTemplateId).toBe("venue-1");
    expect(await venueTracks(app)).toEqual(before);
    expect(await venueTracks(app, alice)).toEqual(before); // one number for everyone: the public layouts
    expect((await req(app, "POST", `/api/tracks/${id}/submit`, alice)).statusCode).toBe(200);
    expect(await venueTracks(app)).toEqual({ list: before.list + 1, page: before.page + 1 });
  });

  it("a copy of a layout that has gone back to a draft no longer names it", async () => {
    const { app, alice, bob, id, created } = await setup();
    expect((await req(app, "POST", `/api/tracks/${id}/submit`, alice)).statusCode).toBe(200);
    const copy = (await req(app, "POST", `/api/tracks/${id}/copy`, bob, {})).json().track as { id: string; derivedFrom: unknown };
    expect(copy.derivedFrom).toEqual({ id, name: NAME, author: "alice" });
    expect((await req(app, "POST", `/api/tracks/${copy.id}/submit`, bob)).statusCode).toBe(200);
    // alice edits hers: a draft again, renamed
    const renamed = { ...created.doc, info: { ...created.doc.info, name: "Even more secret" } };
    expect((await req(app, "PUT", `/api/tracks/${id}`, alice, { track: renamed })).statusCode).toBe(200);
    for (const who of [undefined, bob]) {
      const got = await req(app, "GET", `/api/tracks/${copy.id}`, who);
      expect(got.json().track.derivedFrom).toEqual({ id, name: null, author: null });
      expect(got.body).not.toContain("Even more secret");
      expect((await req(app, "GET", "/api/tracks", who)).body).not.toContain("Even more secret");
    }
  });

  it("fit thumbnails of a draft are its author's too", async () => {
    const { app, alice, bob, id } = await setup();
    const fit = (await req(app, "GET", `/api/tracks/${id}/fit/venue-1`, alice)).json() as { results: { thumbUrl: string }[] };
    expect(fit.results.length).toBeGreaterThan(0);
    const url = fit.results[0].thumbUrl;
    const mine = await req(app, "GET", url, alice);
    expect(mine.statusCode).toBe(200);
    expect(mine.headers["cache-control"]).toBe("private, no-cache");
    for (const who of [undefined, bob]) expect((await req(app, "GET", url, who)).statusCode).toBe(404);
  });
});

describe("the author and organisers still see a draft (#175)", () => {
  it("the author, an organiser and a site admin find it in the lists and open everything", async () => {
    const { app, alice, org, admin, id } = await setup();
    for (const [name, who] of [["author", alice], ["organiser", org], ["admin", admin]] as const) {
      expect(await listed(app, "/api/tracks", who), name).toContain(id);
      expect(await listed(app, "/api/tracks?status=draft", who), name).toContain(id);
      expect(await listed(app, "/api/tracks?q=secret", who), name).toContain(id);
      for (const url of reads(id)) expect((await req(app, "GET", url, who)).statusCode, `${name} ${url}`).toBe(200);
    }
    expect(await listed(app, "/api/tracks?author=me", alice)).toEqual([id]);
    const got = (await req(app, "GET", `/api/tracks/${id}`, alice)).json();
    expect(got.track).toMatchObject({ id, name: NAME, status: "draft" });
    expect(got.can).toMatchObject({ edit: true, submit: true });
  });

  it("the author saves and submits it; an organiser may edit and copy it", async () => {
    const { app, alice, org, id, created } = await setup();
    expect((await req(app, "PUT", `/api/tracks/${id}`, alice, { track: created.doc })).statusCode).toBe(200);
    expect((await req(app, "PUT", `/api/tracks/${id}`, org, { track: created.doc })).statusCode).toBe(200);
    expect((await req(app, "POST", `/api/tracks/${id}/copy`, org, {})).statusCode).toBe(201);
    // an organiser can see it, so "only the author submits" still says so
    expect((await req(app, "POST", `/api/tracks/${id}/submit`, org)).statusCode).toBe(403);
    expect((await req(app, "POST", `/api/tracks/${id}/submit`, alice)).statusCode).toBe(200);
  });
});

describe("submitted, approved and meeting-used layouts stay public (#175)", () => {
  it("submitting a draft makes it public; editing it again makes it a draft, and private, again", async () => {
    const { app, alice, bob, id, created } = await setup();
    expect((await req(app, "POST", `/api/tracks/${id}/submit`, alice)).statusCode).toBe(200);
    for (const who of [undefined, bob]) {
      expect(await listed(app, "/api/tracks", who)).toContain(id);
      expect(await listed(app, "/api/tracks?status=submitted", who)).toContain(id);
      for (const url of reads(id)) expect((await req(app, "GET", url, who)).statusCode, url).toBe(200);
    }
    expect((await req(app, "POST", `/api/tracks/${id}/copy`, bob, {})).statusCode).toBe(201);
    // someone else's public layout: still 403 for a change
    expect((await req(app, "PUT", `/api/tracks/${id}`, bob, { track: created.doc })).statusCode).toBe(403);
    expect((await req(app, "PUT", `/api/tracks/${id}`, alice, { track: created.doc })).statusCode).toBe(200);
    expect(await listed(app, "/api/tracks")).not.toContain(id);
    expect((await req(app, "GET", `/api/tracks/${id}`)).statusCode).toBe(404);
  });

  it("an approved layout is public, and so is everything the seed approved", async () => {
    const { app, alice, org, bob, id } = await setup();
    expect((await req(app, "POST", `/api/tracks/${id}/submit`, alice)).statusCode).toBe(200);
    expect((await req(app, "POST", `/api/tracks/${id}/approve`, org)).statusCode).toBe(200);
    for (const who of [undefined, bob]) {
      expect(await listed(app, "/api/tracks?status=approved", who)).toContain(id);
      expect(await listed(app, "/api/tracks?fits=venue-1", who)).toContain(id);
      for (const url of [...reads(id), ...reads(CLUB_A)]) expect((await req(app, "GET", url, who)).statusCode, url).toBe(200);
    }
  });

  it("an approved layout with a newer draft revision (pinned before #64) stays public", async () => {
    const { app, bob } = await setup();
    app.db.prepare("UPDATE tracks SET status = 'draft' WHERE id = ?").run(CLUB_A);
    for (const who of [undefined, bob]) {
      expect(await listed(app, "/api/tracks", who)).toContain(CLUB_A);
      for (const url of reads(CLUB_A)) expect((await req(app, "GET", url, who)).statusCode, url).toBe(200);
    }
  });

  it("an archived layout that was approved is as it was: off the lists, open by its link", async () => {
    const { app, alice, org, id } = await setup();
    expect((await req(app, "POST", `/api/tracks/${id}/submit`, alice)).statusCode).toBe(200);
    expect((await req(app, "POST", `/api/tracks/${id}/approve`, org)).statusCode).toBe(200);
    expect((await req(app, "POST", `/api/tracks/${id}/archive`, org)).statusCode).toBe(200);
    expect(await listed(app, "/api/tracks")).not.toContain(id);
    expect(await listed(app, "/api/tracks?status=archived")).toContain(id);
    expect((await req(app, "GET", `/api/tracks/${id}`)).statusCode).toBe(200);
  });

  it("archiving a draft doesn't publish it: it stays its author's and the organisers'", async () => {
    const { app, alice, bob, org, id } = await setup();
    expect((await req(app, "POST", `/api/tracks/${id}/archive`, org)).statusCode).toBe(200);
    for (const who of [undefined, bob]) {
      expect(await listed(app, "/api/tracks?status=archived", who)).not.toContain(id);
      for (const url of reads(id)) expect((await req(app, "GET", url, who)).statusCode, url).toBe(404);
    }
    for (const who of [alice, org]) {
      expect(await listed(app, "/api/tracks?status=archived", who)).toContain(id);
      expect((await req(app, "GET", `/api/tracks/${id}`, who)).statusCode).toBe(200);
    }
  });

  it("a draft a meeting uses is public whatever its state: listed and open to everyone", async () => {
    const byLayout: Record<string, unknown[]> = {};
    const { app, bob, id } = await setup(forum(byLayout).fetch);
    byLayout[id] = [MEETING];
    for (const who of [undefined, bob]) {
      expect(await listed(app, "/api/tracks", who)).toContain(id);
      expect(await listed(app, "/api/tracks?status=draft", who)).toContain(id);
      for (const url of reads(id)) expect((await req(app, "GET", url, who)).statusCode, `${who ? "bob" : "signed out"} ${url}`).toBe(200);
    }
    expect((await req(app, "GET", `/api/tracks/${id}`)).json().usedAt.events).toHaveLength(1);
    expect((await req(app, "POST", `/api/tracks/${id}/copy`, bob, {})).statusCode).toBe(201);
  });

  it("forum down, so nobody can say whether a meeting uses it: a draft stays hidden; public layouts are unaffected", async () => {
    const { app, alice, bob, id } = await setup(forum({}, { down: true }).fetch);
    for (const who of [undefined, bob]) {
      expect(await listed(app, "/api/tracks", who)).not.toContain(id);
      expect((await req(app, "GET", `/api/tracks/${id}`, who)).statusCode).toBe(404);
      expect((await req(app, "GET", `/api/tracks/${CLUB_A}`, who)).statusCode).toBe(200);
    }
    expect((await req(app, "GET", `/api/tracks/${id}`, alice)).statusCode).toBe(200);
  });

  it("the forum is only asked about drafts the reader couldn't otherwise see", async () => {
    const f = forum({});
    const { app, alice, org, bob, id } = await setup(f.fetch);
    const about = () => f.calls.filter((u) => u.includes(`/des/layouts/${id}/events`)).length;
    const before = f.calls.length;
    await listed(app, "/api/tracks", alice);
    await listed(app, "/api/tracks", org);
    expect(f.calls).toHaveLength(before); // nothing asked for a list: approved layouts and the reader's own drafts
    await listed(app, "/api/tracks");
    await listed(app, "/api/tracks", bob);
    await req(app, "GET", `/t/${id}`);
    expect(about()).toBe(1); // asked once, then cached
    // a change by someone who could never make it doesn't ask at all
    const calls = f.calls.length;
    expect((await req(app, "PUT", `/api/tracks/${id}`, bob, { track: freeform() })).statusCode).toBe(404);
    expect(f.calls).toHaveLength(calls);
  });
});

describe("opening a draft's link signed out (#175, #132)", () => {
  const browser = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", accept: "text/html", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0" };

  it("a visitor who may be signed into the forum is checked there first, for a draft and a missing id alike", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forumUp });
    const alice = await login(app, ALICE);
    const id = (await req(app, "POST", "/api/tracks", alice, { track: freeform() })).json().track.id as string;
    for (const path of [`/t/${id}`, "/t/no-such-track", `/t/${id}/edit`]) {
      const res = await app.inject({ method: "GET", url: path, headers: browser });
      expect(res.statusCode, path).toBe(302);
      expect(String(res.headers.location), path).toContain(`${FORUM_URL}/session/sso_provider`);
    }
    // once checked (the cookie says so), it's the plain 404 page
    const first = await app.inject({ method: "GET", url: `/t/${id}`, headers: browser });
    const cookie = first.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const again = await app.inject({ method: "GET", url: `/t/${id}`, headers: { ...browser, cookie } });
    expect(again.statusCode).toBe(404);
    expect(again.body).toContain("Not found");
    expect(again.body).not.toContain("og:title");
  });
});
