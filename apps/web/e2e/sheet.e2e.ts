// The build sheet prints on one page (#51): the figure-of-eight crossover fixture, with its Crossovers table, on A3 and
// A4. The page's API calls are answered from the fixture, so only Vite is needed. Desktop project only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const FIXTURES = "../../../packages/engine/test/fixtures/extra/";
const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`${FIXTURES}${name}.rctrack.json`, import.meta.url)), "utf8"));

function response(doc: { id: string; info: { name: string } }) {
  const now = "2026-11-05T12:00:00Z";
  return {
    track: {
      id: doc.id, name: doc.info.name, status: "approved", author: { id: "u1", username: "alice", name: "Alice" },
      revision: 1, approvedRevision: 1, publicRevision: 1, newerRevision: null, errors: 0, derivedFrom: null,
      latestPreviewUrl: "", lapLength: 0, corners: 0, size: null, area: { length: 0, width: 0 }, footprint: { width: 0, height: 0 },
      venue: null, venueTemplateId: null, derivedFromId: null, createdAt: now, updatedAt: now, url: "", previewUrl: "",
    },
    doc,
    can: {},
  };
}

for (const name of ["crossover-figure8", "two-crossings"]) {
  for (const paper of ["a3", "a4"]) {
    test(`${name}: the build sheet prints on one ${paper.toUpperCase()} page`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop-mouse", "print layout doesn't depend on touch");
      const doc = fixture(name);
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return path === `/api/tracks/${doc.id}` ? route.fulfill({ json: response(doc) }) : route.fulfill({ status: 404, json: { error: "not found" } });
      });
      await page.goto(`/t/${doc.id}/build${paper === "a3" ? "" : `?paper=${paper}`}`);
      await expect(page.locator("caption", { hasText: "Crossovers" })).toBeVisible();
      await page.emulateMedia({ media: "print" });
      const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
      expect(pdf.match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(1);
    });
  }
}
