// The forum reachability probe that guards silent sign-in and sign-out (#132): short, cached either way, never throws.
import { describe, expect, it, vi } from "vitest";
import { ForumReachable } from "../src/forum-reachable.js";

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
});
