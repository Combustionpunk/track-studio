// Lap times on a layout (#76): the forum's stats per class (records, typical lap), class speeds for the estimate,
// and the library's "Typical lap for <class>" filter and sort.
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { ForumStats } from "../src/forum-stats.js";
import { estimateSeconds, sameClass, typicalLap } from "../src/lap-times.js";
import { ALICE, FORUM_URL, login, makeApp, ORGANISER } from "./helpers.js";

const CLUB_A = "7c002509-b640-5e9d-8e79-0ae336a2ae04";
const FREEFORM = "3b542396-6bd2-55e8-8665-852e74dc54a9";

const record = (ms: number, name: string, meetingId: number) => ({
  ms,
  driver: { name, username: name.toLowerCase() },
  car: "Losi 22 5.0",
  meeting: { id: meetingId, title: `Round ${meetingId}`, date: "2026-11-12", url: `${FORUM_URL}/t/round-${meetingId}/${100 + meetingId}` },
});

/** One class as the forum's GET /des/layouts/:id/stats.json sends it. */
const cls = (name: string, medianMs: number) => ({
  class: name,
  typical_lap: { median_ms: medianMs, trimmed_mean_ms: medianMs + 120, iqr_ms: 900, laps: 412, meetings: 3, updated_at: "2026-11-13T08:00:00Z" },
  record_lap: record(medianMs - 900, "Dave", 4),
  record_3: record(3 * medianMs - 2000, "Sam", 5),
});

/** A forum stub: stats per layout id (other paths answer an empty events list); counts stats calls. */
function forum(byLayout: Record<string, unknown[]>, opts: { down?: boolean } = {}) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL) => {
    const url = String(input);
    if (opts.down) throw new Error("connect ECONNREFUSED");
    const m = /\/des\/layouts\/([^/]+)\/stats\.json$/.exec(new URL(url).pathname);
    if (!m) return Response.json({ events: [] });
    calls.push(url);
    return Response.json({ classes: byLayout[decodeURIComponent(m[1])] ?? [] });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("ForumStats client", () => {
  it("asks the forum for the layout's stats and maps them", async () => {
    const f = forum({ abc: [cls("2WD Buggy", 14800)] });
    const stats = await new ForumStats({ forumUrl: FORUM_URL, fetch: f.fetch }).forLayout("abc");
    expect(f.calls).toEqual([`${FORUM_URL}/des/layouts/abc/stats.json`]);
    expect(stats).toEqual({
      classes: [
        {
          class: "2WD Buggy",
          typicalLap: { medianMs: 14800, trimmedMeanMs: 14920, iqrMs: 900, laps: 412, meetings: 3, updatedAt: "2026-11-13T08:00:00Z" },
          recordLap: {
            ms: 13900,
            driver: { name: "Dave", username: "dave" },
            car: "Losi 22 5.0",
            meeting: { id: 4, title: "Round 4", date: "2026-11-12", url: `${FORUM_URL}/t/round-4/104` },
          },
          record3: {
            ms: 42400,
            driver: { name: "Sam", username: "sam" },
            car: "Losi 22 5.0",
            meeting: { id: 5, title: "Round 5", date: "2026-11-12", url: `${FORUM_URL}/t/round-5/105` },
          },
        },
      ],
    });
  });

  it("keeps what it can: missing records or typical lap are null, odd links dropped, nameless classes skipped", async () => {
    const f = forum({
      abc: [
        { class: "4WD Buggy", typical_lap: null, record_lap: { ...record(13000, "Dave", 4), car: null, meeting: { ...record(1, "x", 4).meeting, url: "javascript:alert(1)" } } },
        { class: "Truck", typical_lap: { median_ms: "fast" }, record_lap: { ms: 12000, driver: { name: "Ex-member", username: null } } },
        { typical_lap: { median_ms: 1 } },
        null,
      ],
    });
    const stats = await new ForumStats({ forumUrl: FORUM_URL, fetch: f.fetch }).forLayout("abc");
    expect(stats?.classes).toEqual([
      {
        class: "4WD Buggy",
        typicalLap: null,
        recordLap: { ms: 13000, driver: { name: "Dave", username: "dave" }, car: null, meeting: { id: 4, title: "Round 4", date: "2026-11-12", url: null } },
        record3: null,
      },
      { class: "Truck", typicalLap: null, recordLap: { ms: 12000, driver: { name: "Ex-member", username: null }, car: null, meeting: null }, record3: null },
    ]);
  });

  it("caches for 10 minutes and keeps the last copy while the forum is down", async () => {
    let t = 0;
    let down = false;
    const ok = forum({ abc: [cls("2WD Buggy", 14800)] });
    const fetch = (async (u: string) => (down ? Promise.reject(new Error("down")) : ok.fetch(u))) as typeof globalThis.fetch;
    const client = new ForumStats({ forumUrl: FORUM_URL, fetch, now: () => t });
    await client.forLayout("abc");
    t = 9 * 60_000;
    await client.forLayout("abc");
    expect(ok.calls).toHaveLength(1);
    down = true;
    t = 11 * 60_000;
    expect((await client.forLayout("abc"))?.classes).toHaveLength(1);
    expect(await client.forLayout("never-seen")).toBeNull();
  });

  it("gives up after 5 s by default (the timeout is configurable)", async () => {
    const hang = (async (_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof globalThis.fetch;
    expect(await new ForumStats({ forumUrl: FORUM_URL, fetch: hang, timeoutMs: 20 }).forLayout("abc")).toBeNull();
  });
});

describe("lap time helpers", () => {
  it("estimate: lap length over the class speed", () => {
    expect(estimateSeconds(94.9, 6.5)).toBeCloseTo(14.6, 1);
  });

  it("class names match ignoring case and spacing", () => {
    expect(sameClass("2WD Buggy", " 2wd  buggy ")).toBe(true);
    expect(sameClass("2WD Buggy", "4WD Buggy")).toBe(false);
  });

  it("typical lap: the forum's median when there is one, else the estimate, else null", () => {
    const stats = { classes: [{ class: "2WD Buggy", typicalLap: { medianMs: 14800, trimmedMeanMs: 0, iqrMs: 0, laps: 1, meetings: 1, updatedAt: null }, recordLap: null, record3: null }] };
    expect(typicalLap(stats, "2wd buggy", 50, 6.5)).toEqual({ seconds: 14.8, est: false });
    expect(typicalLap(stats, "4WD Buggy", 65, 6.5)).toEqual({ seconds: 10, est: true });
    expect(typicalLap(null, "2WD Buggy", 65, 6.5)).toEqual({ seconds: 10, est: true });
    expect(typicalLap(null, "Rally", 65, null)).toBeNull();
  });
});

const req = (app: FastifyInstance, method: "GET" | "PUT", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe("class speeds (#76)", () => {
  it("are public to read, with defaults (2WD Buggy 6.5 m/s)", async () => {
    const { app } = await makeApp();
    const res = await req(app, "GET", "/api/class-speeds");
    expect(res.statusCode).toBe(200);
    const { classes } = res.json() as { classes: { class: string; speed: number }[] };
    expect(classes[0]).toEqual({ class: "2WD Buggy", speed: 6.5 });
    expect(classes.length).toBeGreaterThan(1);
  });

  it("track-admins replace the list; members can't; bad lists are refused", async () => {
    const { app } = await makeApp();
    const next = { classes: [{ class: "4WD Buggy", speed: 7.2 }, { class: "2WD Buggy", speed: 6 }] };
    expect((await req(app, "PUT", "/api/class-speeds", undefined, next)).statusCode).toBe(401);
    expect((await req(app, "PUT", "/api/class-speeds", await login(app, ALICE), next)).statusCode).toBe(403);
    const org = await login(app, ORGANISER);
    const res = await req(app, "PUT", "/api/class-speeds", org, next);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual(next);
    expect((await req(app, "GET", "/api/class-speeds")).json()).toEqual(next);
    for (const bad of [
      {},
      { classes: "x" },
      { classes: [{ class: "", speed: 5 }] },
      { classes: [{ class: "A", speed: 0 }] },
      { classes: [{ class: "A", speed: 40 }] },
      { classes: [{ class: "A", speed: "6" }] },
      { classes: [{ class: "A", speed: 5 }, { class: " a ", speed: 6 }] },
      { classes: [{ class: "x".repeat(41), speed: 5 }] },
    ]) {
      const r = await req(app, "PUT", "/api/class-speeds", org, bad);
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await req(app, "GET", "/api/class-speeds")).json()).toEqual(next);
  });
});

describe("Lap times on the track page (#76)", () => {
  it("GET /api/tracks/:id has lapStats from the forum", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({ [CLUB_A]: [cls("2WD Buggy", 14800)] }).fetch });
    const got = (await req(app, "GET", `/api/tracks/${CLUB_A}`)).json();
    expect(got.lapStats.classes).toHaveLength(1);
    expect(got.lapStats.classes[0]).toMatchObject({ class: "2WD Buggy", typicalLap: { medianMs: 14800 }, recordLap: { ms: 13900, driver: { name: "Dave" } } });
  });

  it("no races: no classes; forum down: lapStats null and the page still loads", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({}).fetch });
    expect((await req(app, "GET", `/api/tracks/${CLUB_A}`)).json().lapStats).toEqual({ classes: [] });
    const down = await makeApp({ seeded: true, forumFetch: forum({}, { down: true }).fetch });
    const res = await req(down.app, "GET", `/api/tracks/${CLUB_A}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().lapStats).toBeNull();
  });
});

interface Listed {
  id: string;
  lapLength: number;
  typicalLap?: { seconds: number; est: boolean } | null;
}

describe("Library: typical lap for <class> (#76)", () => {
  const list = async (app: FastifyInstance, q: string) => {
    const res = await req(app, "GET", `/api/tracks${q}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().tracks as Listed[];
  };

  it("lapClass adds each layout's typical lap: the forum's median, or the estimate from the lap length (est.)", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({ [CLUB_A]: [cls("2WD Buggy", 14800)] }).fetch });
    const tracks = await list(app, "?status=approved&lapClass=2WD%20Buggy");
    const a = tracks.find((t) => t.id === CLUB_A)!;
    expect(a.typicalLap).toEqual({ seconds: 14.8, est: false });
    const free = tracks.find((t) => t.id === FREEFORM)!;
    expect(free.typicalLap?.est).toBe(true);
    expect(free.typicalLap?.seconds).toBeCloseTo(free.lapLength / 6.5, 6);
    // without a class there's no typical lap
    expect((await list(app, "?status=approved")).every((t) => t.typicalLap === undefined)).toBe(true);
    // a class with no speed setting and no races: unknown
    expect((await list(app, "?status=approved&lapClass=Rally")).find((t) => t.id === FREEFORM)!.typicalLap).toBeNull();
  });

  it("filters between X and Y s and sorts by typical lap, fastest first, unknowns last", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({ [CLUB_A]: [cls("2WD Buggy", 1500)] }).fetch });
    const all = await list(app, "?lapClass=2WD%20Buggy&sort=typical");
    const secs = all.map((t) => t.typicalLap!.seconds);
    expect(secs).toEqual([...secs].sort((x, y) => x - y));
    expect(all[0].id).toBe(CLUB_A);
    const mid = secs[Math.floor(secs.length / 2)];
    const some = await list(app, `?lapClass=2WD%20Buggy&minTypical=${mid}&maxTypical=${mid + 0.001}`);
    expect(some.length).toBeGreaterThan(0);
    expect(some.every((t) => t.typicalLap!.seconds >= mid && t.typicalLap!.seconds <= mid + 0.001)).toBe(true);
    expect((await list(app, "?lapClass=2WD%20Buggy&maxTypical=2")).map((t) => t.id)).toEqual([CLUB_A]);
    // fits mode lists too
    const venues = (await req(app, "GET", "/api/venues")).json().venues as { id: string }[];
    const fitting = await list(app, `?fits=${venues[0].id}&lapClass=2WD%20Buggy&sort=typical`);
    expect(fitting.every((t) => t.typicalLap)).toBe(true);
  });

  it("refuses a range or the typical sort without a class, and bad numbers", async () => {
    const { app } = await makeApp({ seeded: true });
    for (const q of ["?sort=typical", "?minTypical=10", "?maxTypical=10", "?lapClass=2WD%20Buggy&minTypical=abc", "?sort=fastest"]) {
      expect((await req(app, "GET", `/api/tracks${q}`)).statusCode, q).toBe(400);
    }
  });

  it("forum down: the estimates still list, filter and sort", async () => {
    const { app } = await makeApp({ seeded: true, forumFetch: forum({}, { down: true }).fetch });
    const tracks = await list(app, "?lapClass=2WD%20Buggy&sort=typical");
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks.every((t) => t.typicalLap?.est)).toBe(true);
  });
});
