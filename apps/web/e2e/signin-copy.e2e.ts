// A signed-out visitor on a layout's page is told that signing in lets them copy it (#180), and the Sign in link
// comes back to the layout, now with Copy and edit. This needs the real server and a real forum sign-in, so it starts
// apps/server (Vite inside it) with a DiscourseConnect secret and a stand-in forum that signs everyone in as "bob".
// SHOTS=<dir> saves screenshots for the PR.
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";

const SERVER_DIR = fileURLToPath(new URL("../../server/", import.meta.url));
const example = JSON.parse(readFileSync(fileURLToPath(new URL("../../../reference/examples/freeform-example.rctrack.json", import.meta.url)), "utf8"));
const SHOTS = process.env.SHOTS;
const NAME = "Alice's library hairpins";
const SECRET = "e2e-sso-".repeat(5);
const HINT = "Sign in with your forum account to make your own copy.";
/** without the marshal points: one is on a pipe, an error that would hold Submit back (#151) */
const layout = { ...example, info: { ...example.info, name: NAME }, design: { ...example.design, marshals: undefined } };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

/** The forum's DiscourseConnect provider, as far as a sign-in needs: whoever asks is signed in as bob. */
function standInForum(): Server {
  return createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://forum");
    if (url.pathname !== "/session/sso_provider") {
      res.writeHead(404).end();
      return;
    }
    const asked = new URLSearchParams(Buffer.from(url.searchParams.get("sso") ?? "", "base64").toString("utf8"));
    const sso = Buffer.from(new URLSearchParams({ nonce: asked.get("nonce") ?? "", external_id: "4242", username: "bob", name: "Bob" }).toString(), "utf8").toString("base64");
    const sig = createHmac("sha256", SECRET).update(sso).digest("hex");
    res.writeHead(302, { location: `${asked.get("return_sso_url")}?sso=${encodeURIComponent(sso)}&sig=${sig}` }).end();
  });
}

let server: ChildProcess;
let forum: Server;
let dataDir: string;
let base: string;
let id: string;
let log = "";

test.describe("signed out on a layout's page", () => {
  test.describe.configure({ mode: "serial" });
  const runs = (name: string) => name === "desktop-mouse" || name === "phone";
  test.beforeEach(({}, info) => test.skip(!runs(info.project.name), "a laptop and a phone are enough"));

  test.beforeAll(async ({ browser }, info) => {
    if (!runs(info.project.name)) return;
    test.setTimeout(120_000);
    const [port, forumPort] = [await freePort(), await freePort()];
    forum = standInForum();
    await new Promise<void>((resolve) => forum.listen(forumPort, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${port}`;
    dataDir = mkdtempSync(join(tmpdir(), "track-studio-e2e-"));
    server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        NODE_ENV: "development",
        WEB_DEV: "1",
        DEV_LOGIN: "1", // only to set the layout up: alice saves and submits it, an organiser approves it
        DISCOURSE_CONNECT_SECRET: SECRET,
        SILENT_SIGNIN: "off",
        HOST: "127.0.0.1",
        PORT: String(port),
        BASE_URL: base,
        FORUM_URL: `http://127.0.0.1:${forumPort}`,
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

    // an approved layout, in the library: locked, so a member changes it on a copy
    const alice = await visitor(browser, "alice");
    const created = await alice.request.post("/api/tracks", { data: { track: layout }, headers: { origin: base } });
    expect(created.status(), await created.text()).toBe(201);
    id = (await created.json()).track.id as string;
    const submitted = await alice.request.post(`/api/tracks/${id}/submit`, { headers: { origin: base } });
    expect(submitted.status(), await submitted.text()).toBe(200);
    const org = await visitor(browser, "org", true);
    const approved = await org.request.post(`/api/tracks/${id}/approve`, { headers: { origin: base } });
    expect(approved.status(), await approved.text()).toBe(200);
    await alice.context().close();
    await org.context().close();
  });

  test.afterAll(async () => {
    forum?.close();
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

  test("the hint's Sign in goes through the forum and back to the layout, now with Copy and edit", async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.goto(`${base}/t/${id}`);
    await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
    const hint = page.locator(".ts-signin-hint");
    await expect(hint).toHaveText(HINT);
    await expect(page.getByRole("button", { name: "Copy and edit" })).toHaveCount(0);
    // the hint sits in the actions block, in view, and on a phone its link is a full touch target
    const link = hint.getByRole("link", { name: "Sign in" });
    await expect(link).toBeInViewport();
    // and its tap area stays clear of the buttons above, so a tap on a button's edge isn't a sign-in
    const box = (await link.boundingBox())!;
    const buttons = (await page.getByRole("group", { name: "Track actions" }).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(buttons.y + buttons.height);
    if (info.project.name === "phone") expect(box.height).toBeGreaterThanOrEqual(44);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/signed-out-${info.project.name}.png` });

    await link.click();
    await page.waitForURL(`${base}/t/${id}`);
    await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy and edit" })).toBeVisible();
    await expect(page.locator(".ts-signin-hint")).toHaveCount(0);
    await expect(page.getByText(HINT)).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/signed-in-${info.project.name}.png` });
  });
});
