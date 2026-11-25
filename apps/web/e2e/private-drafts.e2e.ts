// A draft is its author's and the organisers' (#175): a signed-out visitor, or another member, who opens its URL gets
// the Not found page, and its API and downloads answer 404. Unlike the other specs this one needs the real server (the
// rule lives there), so it starts one: apps/server with Vite inside it, dev login, an empty temp DATA_DIR and no forum.
// SHOTS=<dir> saves screenshots for the PR.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";

const SERVER_DIR = fileURLToPath(new URL("../../server/", import.meta.url));
const example = JSON.parse(readFileSync(fileURLToPath(new URL("../../../reference/examples/freeform-example.rctrack.json", import.meta.url)), "utf8"));
const SHOTS = process.env.SHOTS;
const NAME = "Alice's secret hairpins";
/** without the marshal points: one is on a pipe, an error that would hold Submit back (#151) */
const draft = { ...example, info: { ...example.info, name: NAME }, design: { ...example.design, marshals: undefined } };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

let server: ChildProcess;
let dataDir: string;
let base: string;
let log = "";

test.describe("a draft layout is private", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "one browser is enough: the rule is the server's"));

  test.beforeAll(async ({}, info) => {
    if (info.project.name !== "desktop-mouse") return;
    test.setTimeout(120_000);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    dataDir = mkdtempSync(join(tmpdir(), "track-studio-e2e-"));
    server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        NODE_ENV: "development",
        WEB_DEV: "1",
        DEV_LOGIN: "1",
        SILENT_SIGNIN: "off",
        HOST: "127.0.0.1",
        PORT: String(port),
        BASE_URL: base,
        FORUM_URL: "http://127.0.0.1:9", // nothing listens: no forum, so no meeting uses the draft
        SESSION_SECRET: "e2e-".repeat(10),
        DATA_DIR: dataDir,
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout!.on("data", (d) => (log += d));
    server.stderr!.on("data", (d) => (log += d));
    await expect
      .poll(async () => (server.exitCode !== null ? `exited ${server.exitCode}: ${log}` : await fetch(`${base}/healthz`).then((r) => r.status, () => 0)), { timeout: 90_000 })
      .toBe(200);
  });

  test.afterAll(async () => {
    if (!server) return;
    const gone = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** A browser of its own, signed in through the dev login, or signed out. */
  async function visitor(browser: Browser, user?: string, organiser = false): Promise<Page> {
    const page = await (await browser.newContext({ baseURL: base })).newPage();
    if (user) await page.goto(`/auth/dev-login?user=${user}${organiser ? "&organiser=1" : ""}&return=/`);
    return page;
  }

  const expectNotFound = async (page: Page, id: string) => {
    for (const path of [`/t/${id}`, `/t/${id}/edit`, `/t/${id}/build`]) {
      const res = await page.goto(path);
      expect(res!.status(), path).toBe(404);
      await expect(page.getByRole("heading", { name: "Not found" }), path).toBeVisible();
      await expect(page.getByText(NAME), path).toHaveCount(0);
    }
    expect((await page.goto(`/embed/${id}`))!.status()).toBe(404);
    for (const path of [`/api/tracks/${id}`, `/api/tracks/${id}/r/1.rctrack.json`, `/api/tracks/${id}/latest.rctrack.json`, `/p/${id}/1.png`]) {
      expect((await page.request.get(path)).status(), path).toBe(404);
    }
    const list = await (await page.request.get("/api/tracks")).json();
    expect(list.tracks.map((t: { id: string }) => t.id)).not.toContain(id);
  };

  test("only its author and an organiser reach it by its URL; submitting makes it public", async ({ browser }) => {
    test.setTimeout(120_000);
    // the author saves a draft and sees it
    const alice = await visitor(browser, "alice");
    const created = await alice.request.post("/api/tracks", { data: { track: draft }, headers: { origin: base } });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json()).track.id as string;
    expect((await alice.goto(`/t/${id}`))!.status()).toBe(200);
    await expect(alice.getByRole("heading", { name: NAME })).toBeVisible();

    // a signed-out visitor with the link: not found, for the page, the API and the downloads
    const stranger = await visitor(browser);
    await expectNotFound(stranger, id);
    if (SHOTS) {
      for (const [name, width, height] of [["not-found-1200", 1200, 860], ["not-found-375", 375, 812]] as const) {
        await stranger.setViewportSize({ width, height });
        await stranger.goto(`/t/${id}`);
        await expect(stranger.getByRole("heading", { name: "Not found" })).toBeVisible();
        await stranger.screenshot({ path: `${SHOTS}/${name}.png` });
      }
    }
    // exactly as for a track that never existed
    const missing = await stranger.goto("/t/00000000-0000-4000-8000-000000000000");
    expect(missing!.status()).toBe(404);
    await expect(stranger.getByRole("heading", { name: "Not found" })).toBeVisible();

    // another member: the same
    await expectNotFound(await visitor(browser, "bob"), id);

    // an organiser opens it
    const olive = await visitor(browser, "olive", true);
    expect((await olive.goto(`/t/${id}`))!.status()).toBe(200);
    await expect(olive.getByRole("heading", { name: NAME })).toBeVisible();

    // submitted: now anyone can
    expect((await alice.request.post(`/api/tracks/${id}/submit`, { headers: { origin: base } })).status()).toBe(200);
    expect((await stranger.goto(`/t/${id}`))!.status()).toBe(200);
    await expect(stranger.getByRole("heading", { name: NAME })).toBeVisible();
    expect((await stranger.request.get(`/api/tracks/${id}/latest.rctrack.json`)).status()).toBe(200);
  });
});
