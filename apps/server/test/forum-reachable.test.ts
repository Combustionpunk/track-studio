// The forum reachability probe that guards silent sign-in and sign-out (#132): short, cached either way, never throws.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { ForumReachable, FORUM_STATUS_PATH, PROBE_TIMEOUT_MS, PROBE_TTL_MS } from "../src/forum-reachable.js";

const FORUM = "http://forum.test";

describe("ForumReachable", () => {
  it("asks the forum's status page once and believes the answer for the TTL", async () => {
    let now = 1_000_000;
    const fetchFn = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
    const probe = new ForumReachable({ forumUrl: FORUM, fetch: fetchFn as unknown as typeof fetch, ttlMs: 60_000, now: () => now });
    expect(await probe.check()).toBe(true);
    expect(await probe.check()).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toBe(`${FORUM}/srv/status`);
    now += 59_000;
    expect(await probe.check()).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 2_000;
    expect(await probe.check()).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a failed fetch, an error status or a timeout means unreachable, cached too", async () => {
    let now = 0;
    const answers: (() => Promise<Response>)[] = [
      async () => Promise.reject(new Error("ECONNREFUSED")),
      async () => new Response("down", { status: 502 }),
      () => new Promise<Response>(() => {}), // never answers
      async () => new Response("ok", { status: 200 }),
    ];
    const fetchFn = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      const answer = answers.shift()!();
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        answer.then(resolve, reject);
      });
    });
    const probe = new ForumReachable({ forumUrl: FORUM, fetch: fetchFn as unknown as typeof fetch, timeoutMs: 20, ttlMs: 1_000, now: () => now });
    expect(await probe.check()).toBe(false);
    expect(await probe.check()).toBe(false); // cached: the failure isn't retried on every page
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 1_000;
    expect(await probe.check()).toBe(false); // 502
    now += 1_000;
    const started = Date.now();
    expect(await probe.check()).toBe(false); // timed out
    expect(Date.now() - started).toBeLessThan(500);
    now += 1_000;
    expect(await probe.check()).toBe(true); // back
  });

  it("concurrent callers share one probe", async () => {
    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
    const probe = new ForumReachable({ forumUrl: FORUM, fetch: fetchFn as unknown as typeof fetch });
    const results = await Promise.all([probe.check(), probe.check(), probe.check()]);
    expect(results).toEqual([true, true, true]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("logs when the forum goes away and when it comes back, not on every probe", async () => {
    let now = 0;
    let up = true;
    const fetchFn = vi.fn(async () => (up ? new Response("ok") : Promise.reject(new Error("down"))));
    const log = { info: vi.fn(), warn: vi.fn() };
    const probe = new ForumReachable({ forumUrl: FORUM, fetch: fetchFn as unknown as typeof fetch, ttlMs: 10, now: () => now, log });
    await probe.check();
    now += 10;
    await probe.check();
    expect(log.info).toHaveBeenCalledTimes(1);
    up = false;
    now += 10;
    await probe.check();
    now += 10;
    await probe.check();
    expect(log.warn).toHaveBeenCalledTimes(1);
    up = true;
    now += 10;
    await probe.check();
    expect(log.info).toHaveBeenCalledTimes(2);
  });

  // The Board asked for the same probe as the timing site (club-timing #111): these pin the three things that must match.
  it("uses club-timing's probe: /srv/status, 1.5 s timeout, 60 s cache", () => {
    expect(FORUM_STATUS_PATH).toBe("/srv/status");
    expect(PROBE_TIMEOUT_MS).toBe(1_500);
    expect(PROBE_TTL_MS).toBe(60_000);
  });

  it("only a 2xx from the status page counts as up: a redirect isn't followed", async () => {
    // a real forum over HTTP, so this is fetch's own redirect handling and not a stub's
    let statusAnswer: "redirect" | "ok" | "no-content" = "redirect";
    const hits: string[] = [];
    const forum = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/srv/status" && statusAnswer === "redirect") res.writeHead(302, { location: "/login" }).end();
      else if (req.url === "/srv/status" && statusAnswer === "no-content") res.writeHead(204).end();
      else res.writeHead(200, { "content-type": "text/plain" }).end("ok"); // /login answers 200: following would say "up"
    });
    await new Promise<void>((resolve) => forum.listen(0, "127.0.0.1", resolve));
    try {
      let now = 0;
      const probe = new ForumReachable({ forumUrl: `http://127.0.0.1:${(forum.address() as AddressInfo).port}`, ttlMs: 10, now: () => now });
      expect(await probe.check()).toBe(false);
      expect(hits).toEqual(["/srv/status"]); // the redirect's target was never asked
      statusAnswer = "ok";
      now += 10;
      expect(await probe.check()).toBe(true);
      statusAnswer = "no-content";
      now += 10;
      expect(await probe.check()).toBe(true);
    } finally {
      await new Promise((resolve) => forum.close(resolve));
    }
  });

  it("a logger that throws doesn't break the probe: no rejection, and the next check still works", async () => {
    let now = 0;
    let up = true;
    const fetchFn = vi.fn(async () => (up ? new Response("ok") : Promise.reject(new Error("down"))));
    const log = {
      info: vi.fn(() => {
        throw new Error("logger broke");
      }),
      warn: vi.fn(() => {
        throw new Error("logger broke");
      }),
    };
    const probe = new ForumReachable({ forumUrl: FORUM, fetch: fetchFn as unknown as typeof fetch, ttlMs: 10, now: () => now, log });
    expect(await probe.check()).toBe(true);
    expect(await probe.check()).toBe(true); // cached, not stuck on a rejected promise
    expect(fetchFn).toHaveBeenCalledTimes(1);
    up = false;
    now += 10;
    expect(await probe.check()).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    up = true;
    now += 10;
    expect(await probe.check()).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
