// One corner numbering everywhere (#176): the designer and the build sheet name the same corner points the same way,
// and count the same corners, for a layout with hairpins (club-a: 5a/5b, 6a/6b, … — 18 points, 12 corners). The API is
// answered from the fixture (phone-helper's serve), so only Vite is needed. Desktop project only: the numbering
// doesn't depend on touch.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { open, REF, serve, ID } from "./phone-helper.js";

const clubA = JSON.parse(readFileSync(`${REF}examples/club-a.rctrack.json`, "utf8"));

test("club-a: the designer's corner dots and the build sheet's corner points carry the same labels at the same places", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-mouse", "the numbering doesn't depend on touch");
  const errors = await serve(page, clubA);
  await open(page);

  // the designer: each dot's label at its plan position (x east, z north)
  const dots = await page.locator("g.ed-corner").evaluateAll((gs) =>
    gs.map((g) => {
      const c = g.querySelector(".ed-corner-dot")!;
      return { label: g.querySelector(".ed-corner-n")!.textContent!, x: +c.getAttribute("cx")!, z: -c.getAttribute("cy")! };
    }),
  );
  expect(dots.map((d) => d.label)).toEqual(["1", "2", "3", "4", "5a", "5b", "6a", "6b", "7", "8", "9a", "9b", "10a", "10b", "10c", "11", "12a", "12b"]);
  await expect(page.locator(".designer-stats .figures")).toContainText("12Corners");

  // a hairpin's point: its title and its panel say 5a, as the sheet does
  const five = page.locator("g.ed-corner").nth(dots.findIndex((d) => d.label === "5a"));
  await expect(five.locator("title")).toHaveText(/^Corner 5a: /);
  await five.locator(".ed-corner-dot").click();
  await expect(page.locator("section.sel-panel h2")).toHaveText("Corner 5a");

  // the build sheet: the same labels, each measured from the south-west corner of the same spot
  await page.goto(`/t/${ID}/build`);
  await expect(page.locator("caption", { hasText: "Corner points" })).toBeVisible();
  const rows = await page.locator(".sheet-table tbody tr").evaluateAll((trs) =>
    trs.filter((tr) => tr.closest("table")!.querySelector("caption")!.textContent !== "Jumps").map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent!)),
  );
  const sheet = rows.filter((r) => /^\d+[a-z]?$/.test(r[0]) && r.length === 4).map(([label, w, s]) => ({ label, fromWest: parseFloat(w), fromSouth: parseFloat(s) }));
  expect(sheet.map((r) => r.label).sort()).toEqual(dots.map((d) => d.label).sort());
  const offsets = sheet.map((r) => {
    const d = dots.find((d) => d.label === r.label)!;
    return [r.fromWest - d.x, r.fromSouth - d.z];
  });
  for (const [ow, os] of offsets) {
    expect(Math.abs(ow - offsets[0][0])).toBeLessThan(0.06); // the sheet rounds to 0.05 m or so
    expect(Math.abs(os - offsets[0][1])).toBeLessThan(0.06);
  }
  await expect(page.locator(".sheet-figures")).toContainText("12Corners");
  expect(errors).toEqual([]);
});
