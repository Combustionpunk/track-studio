// "Download for the sim" on the track page (#155): it downloads the revision on screen, the file name it shows is the
// name the file saves as (<slug>-r<n>.rctrack.json), and the hint says where it goes. Desktop and phone. The API is
// answered from a reference example, so only Vite is needed. Chromium fetches a download outside Playwright's routing,
// so the saved name here is the link's `download` name; the server's content-disposition gives the same name from the
// same engine function (apps/server/test/tracks.test.ts, "the latest link ...").
// SHOTS=<dir> saves screenshots for the PR.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { RcTrack } from "@track-studio/engine";

const SHOTS = process.env.SHOTS;
const EXAMPLE = fileURLToPath(new URL("../../../reference/examples/freeform-example.rctrack.json", import.meta.url));
const base = JSON.parse(readFileSync(EXAMPLE, "utf8")) as RcTrack;
/** revision 1 "Freeform example"; revision 2 renamed, approved and public */
const docs: Record<number, RcTrack> = {
  1: { ...base, revision: 1 },
  2: { ...base, revision: 2, info: { ...base.info, name: "Freeform — winter layout" } },
};
const files: Record<number, string> = { 1: "freeform-example-r1.rctrack.json", 2: "freeform-winter-layout-r2.rctrack.json" };

/** Answer the track page's API calls. */
async function serve(page: Page) {
  const id = base.id;
  const now = "2026-11-18T12:00:00Z";
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/tracks/${id}`) {
      const track = {
        id, name: docs[2].info.name, status: "approved", author: { id: 1, username: "alice" }, revision: 2, approvedRevision: 2, publicRevision: 2,
        newerRevision: null, locked: "library", errors: 0, lapLength: 0, corners: 0, size: null, area: { length: 0, width: 0 }, footprint: { width: 0, height: 0 },
        venue: null, venueTemplateId: null, derivedFromId: null, derivedFrom: null, createdAt: now, updatedAt: now, url: `/t/${id}`, previewUrl: "", latestPreviewUrl: "",
      };
      return route.fulfill({ json: { track, doc: docs[2], can: {}, usedAt: null, lapStats: null } });
    }
    if (path === `/api/tracks/${id}/revisions`) {
      const revisions = [2, 1].map((revision) => ({
        revision, createdAt: now, createdBy: { id: 1, username: "alice" }, note: null, status: revision === 2 ? "approved" : "draft", errors: 0,
        previewUrl: "", downloadUrl: `/api/tracks/${id}/r/${revision}.rctrack.json`,
      }));
      return route.fulfill({ json: { revisions } });
    }
    const m = new RegExp(`^/api/tracks/${id}/r/(\\d+)(\\.rctrack\\.json)?$`).exec(path);
    if (m && !m[2] && docs[Number(m[1])]) return route.fulfill({ json: docs[Number(m[1])] });
    return route.fulfill({ status: 404, json: { error: "not-found" } });
  });
}

const simButton = (page: Page) => page.getByRole("link", { name: "Download for the sim" });

test.describe("Download for the sim", () => {
  test.beforeEach(({}, info) => test.skip(!["desktop-mouse", "phone"].includes(info.project.name), "desktop and phone"));

  for (const [label, query, n] of [["the public revision", "", 2], ["an older revision on screen", "?r=1", 1]] as const) {
    test(`downloads ${label} under the name it shows`, async ({ page }, info) => {
      await serve(page);
      await page.goto(`/t/${base.id}${query}`);
      const section = page.getByRole("region", { name: "Share and download" });
      await expect(section.getByText(files[n], { exact: true })).toBeVisible();
      await expect(section.getByText("Put it in the sim's Tracks folder")).toBeVisible();
      await simButton(page).scrollIntoViewIfNeeded();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/sim-download-r${n}-${info.project.name}.png`, fullPage: true });
      const [download] = await Promise.all([page.waitForEvent("download"), simButton(page).click()]);
      expect(download.suggestedFilename()).toBe(files[n]);
      expect(new URL(download.url()).pathname).toBe(`/api/tracks/${base.id}/r/${n}.rctrack.json`);
    });
  }
});
