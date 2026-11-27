// A venue template linked to a forum venue track takes its surface from the forum (#190): the venue page and the
// editor show it read-only with a link to change it on the forum, and a layout made for the template takes it. An
// unlinked template keeps its own Surface select. Like private-drafts.e2e.ts this needs the real server (apps/server
// with Vite inside it, dev login, an empty temp DATA_DIR), and a stand-in forum answering GET /des/venues.
// SHOTS=<dir> saves screenshots for the PR.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";

const SERVER_DIR = fileURLToPath(new URL("../../server/", import.meta.url));
const example = JSON.parse(readFileSync(fileURLToPath(new URL("../../../reference/examples/freeform-example.rctrack.json", import.meta.url)), "utf8"));
const hallB = JSON.parse(readFileSync(fileURLToPath(new URL("../../../reference/venues/sports-hall-b.rcvenue.json", import.meta.url)), "utf8"));
const SHOTS = process.env.SHOTS;

/** the forum's venue list: Niagara centre's winter track is indoor carpet */
const FORUM_VENUES = [
  { id: 12, name: "Niagara centre", address: "Niagara Road, Sheffield, S6 1LU", tracks: [{ id: 31, name: "Indoor (Winter)", surface: "carpet", environment: "indoor", width_m: null, length_m: null }] },
];

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
let forum: Server;
let forumUrl: string;
let dataDir: string;
let base: string;
let log = "";

test.describe("a linked venue template's surface comes from the forum", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-mouse", "one browser is enough: the surface is the server's"));

  test.beforeAll(async ({}, info) => {
    if (info.project.name !== "desktop-mouse") return;
    test.setTimeout(120_000);
    const forumPort = await freePort();
    forumUrl = `http://127.0.0.1:${forumPort}`;
    forum = createHttpServer((req, res) => {
      const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (req.url === "/des/venues") return json(200, { venues: FORUM_VENUES });
      if (req.url === "/des/venues/12") return json(200, { venue: { id: 12, name: "Niagara centre", managing_organisation: null } });
      return json(404, { error: "not found" });
    });
    await new Promise<void>((resolve) => forum.listen(forumPort, "127.0.0.1", resolve));

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
        FORUM_URL: forumUrl,
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
    if (forum) await new Promise((resolve) => forum.close(resolve));
    if (!server) return;
    const gone = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function visitor(browser: Browser, user: string, organiser = false): Promise<Page> {
    const page = await (await browser.newContext({ baseURL: base, viewport: { width: 1200, height: 860 } })).newPage();
    await page.goto(`/auth/dev-login?user=${user}${organiser ? "&organiser=1" : ""}&return=/`);
    return page;
  }

  /** A template made through the API, as the editor sends it. */
  async function template(page: Page, info: object, surface?: string): Promise<string> {
    const venue = { info, area: hallB.area, rostrum: hallB.rostrum, obstacles: [], ...(surface ? { surface } : {}) };
    const res = await page.request.post("/api/venues", { data: { venue }, headers: { origin: base } });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).venue.id as string;
  }

  test("Niagara centre Indoor (Winter): Carpet from the forum, read-only; a copy made for it is carpet", async ({ browser }) => {
    test.setTimeout(120_000);
    const olive = await visitor(browser, "olive", true);
    const link = { id: 12, name: "Niagara centre", trackId: 31, trackName: "Indoor (Winter)" };
    // a surface sent with a linked template isn't kept: the forum's is shown
    const id = await template(olive, { name: "Niagara centre – Indoor (Winter)", venue: link }, "astro");

    await olive.goto(`/v/${id}`);
    const details = olive.locator("dl.details");
    await expect(details).toContainText("Carpet · Indoor");
    await expect(details).not.toContainText("Astro");
    await expect(details.getByRole("link", { name: /Set on the forum/ })).toHaveAttribute("href", `${forumUrl}/venues/12`);
    if (SHOTS) {
      await olive.screenshot({ path: `${SHOTS}/venue-page-1200.png` });
      await olive.setViewportSize({ width: 375, height: 812 });
      await olive.screenshot({ path: `${SHOTS}/venue-page-375.png`, fullPage: true });
      await olive.setViewportSize({ width: 1200, height: 860 });
    }
    await olive.goto("/v");
    await expect(olive.locator("article.card").filter({ hasText: "Niagara centre" })).toContainText("Carpet");

    // the editor: no Surface select, the forum's value and a link; unlinking gives the select back
    await olive.goto(`/v/${id}/edit`);
    const surface = olive.getByRole("group", { name: "Surface" });
    await expect(surface).toContainText("Carpet · Indoor");
    await expect(surface.getByRole("link", { name: /Set on the forum/ })).toHaveAttribute("href", `${forumUrl}/venues/12`);
    await expect(olive.getByRole("combobox", { name: "Surface" })).toHaveCount(0);
    if (SHOTS) await olive.screenshot({ path: `${SHOTS}/editor-linked-1200.png` });
    await olive.getByRole("button", { name: "Unlink" }).click();
    await expect(olive.getByRole("combobox", { name: "Surface" })).toBeVisible();

    // a layout made for the template takes the forum's surface (the example's own is taken out first)
    const alice = await visitor(browser, "alice");
    const { surface: _own, ...info } = example.info;
    const created = await alice.request.post("/api/tracks", { data: { track: { ...example, info, design: { ...example.design, marshals: undefined } } }, headers: { origin: base } });
    expect(created.status(), await created.text()).toBe(201);
    const trackId = (await created.json()).track.id as string;
    await alice.goto(`/t/${trackId}?fit=${id}`);
    await expect(alice.locator("#fit-panel")).toContainText("carpet)");
    await alice.getByRole("button", { name: /Make a copy for Niagara centre/ }).click();
    await alice.waitForURL((url) => url.pathname.startsWith("/t/") && !url.pathname.includes(trackId));
    const copyId = /^\/t\/([^/]+)/.exec(new URL(alice.url()).pathname)![1];
    const copy = await (await alice.request.get(`/api/tracks/${copyId}`)).json();
    expect(copy.doc, `${alice.url()} ${JSON.stringify(copy).slice(0, 300)}`).toBeDefined();
    expect(copy.doc.info.surface).toBe("carpet");
  });

  test("an unlinked template still sets its surface by hand", async ({ browser }) => {
    const olive = await visitor(browser, "olive", true);
    const id = await template(olive, { name: "Scout hut", venue: null }, "astro");
    await olive.goto(`/v/${id}`);
    await expect(olive.locator("dl.details")).toContainText("Astro");
    await expect(olive.locator("dl.details").getByRole("link", { name: /Set on the forum/ })).toHaveCount(0);
    await olive.goto(`/v/${id}/edit`);
    const select = olive.getByRole("combobox", { name: "Surface" });
    await expect(select).toHaveValue("astro");
    await select.selectOption("tarmac");
    await olive.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(async () => (await (await olive.request.get(`/api/venues/${id}`)).json()).doc.surface).toBe("tarmac");
    if (SHOTS) await olive.screenshot({ path: `${SHOTS}/editor-unlinked-1200.png` });
  });
});
