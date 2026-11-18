// The phone designer, ticket 5 (#124): at 375 × 812 with touch, the header's Save button appears after an edit and
// saves with a note; the ⋯ menu (a modal sheet over a scrim, eight rows that fit) saves too, says why Submit waits and
// submits once it can, switches Quick / Advanced keeping the draft, reverses the direction, zooms to fit, opens Layout
// details and How to draw, and goes back to the track; Back with unsaved changes asks first; the restore banner brings
// back unsaved work. SHOTS=<dir> saves screenshots for the PR. The API is answered from the reference files (with a
// save and a submit), so only Vite is needed.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { corners, doc, ID, middleCorner, open, pinchIn, REF, serve, shot, toolBtn, toolbar, viewBox, type Calls } from "./phone-helper.js";
import { Touch } from "./touch-helper.js";

/** a track with one error (two straights overlap) */
const overlap = JSON.parse(readFileSync(`${REF}../packages/engine/test/fixtures/extra/overlap-straights.rctrack.json`, "utf8"));

const more = (page: Page) => page.getByRole("button", { name: "More" });
const menu = (page: Page) => page.getByRole("dialog", { name: "More" });
const item = (page: Page, name: string | RegExp) => page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name });
const headerSave = (page: Page) => page.locator(".phone-header").getByRole("button", { name: "Save", exact: true });
const state = (page: Page) => page.locator(".phone-save");
const banner = (page: Page) => page.locator(".phone-banner");

/** move the corner nearest the middle of the plan a little: an unsaved change */
async function edit(page: Page, t: Touch) {
  await pinchIn(page, t);
  const { i, at } = await middleCorner(page);
  const before = await corners(page);
  await t.drag([at, [at[0] + 10, at[1] + 30], [at[0] + 20, at[1] + 60]], 6);
  await expect.poll(async () => (await corners(page))[i]).not.toEqual(before[i]);
  // the selection sheet opened by the tap: put it away
  const sel = page.locator("section.bottom-sheet");
  if (await sel.count()) await sel.getByRole("button", { name: "Close" }).tap();
}

async function openMenu(page: Page) {
  await more(page).tap();
  await expect(menu(page)).toBeVisible();
  // it has slid in
  await expect.poll(async () => Math.round((await menu(page).boundingBox())!.y + (await menu(page).boundingBox())!.height)).toBe(page.viewportSize()!.height);
}

/** the Save sheet: a note, then Save as revision N */
async function saveWithNote(page: Page, note: string, rev: number) {
  const s = page.getByRole("dialog", { name: "Save" });
  await expect(s).toBeVisible();
  await s.getByLabel("What changed? (optional)").fill(note);
  await s.getByRole("button", { name: `Save as revision ${rev}` }).tap();
  await expect(s).toHaveCount(0);
  await expect(state(page)).toHaveText("Saved");
  await expect(banner(page)).toContainText(`Saved as revision ${rev}.`);
}

test.describe("phone: save, submit and the ⋯ menu", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "a phone, 375 × 812"));

  test("the header's Save button appears after an edit, opens the Save sheet and saves with the note", async ({ page }) => {
    const calls: Calls = { saves: [], submits: 0 };
    const errors = await serve(page, doc, calls);
    await open(page);
    await expect(state(page)).toHaveText("Saved");
    await expect(headerSave(page)).toHaveCount(0);
    const t = await Touch.on(page);
    await edit(page, t);
    await expect(headerSave(page)).toBeVisible();
    const b = (await headerSave(page).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
    await shot(page, "375-header-save");
    // one tap: the Save sheet, above the toolbar
    await headerSave(page).tap();
    const s = page.getByRole("dialog", { name: "Save" });
    await expect(s).toBeVisible();
    await expect(s.getByLabel("What changed? (optional)")).toBeInViewport({ ratio: 1 });
    await shot(page, "375-save-sheet");
    await saveWithNote(page, "moved a corner", 2);
    expect(calls.saves).toEqual([{ note: "moved a corner", baseRevision: 1, name: doc.info.name }]);
    await expect(headerSave(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the menu: a modal sheet over the plan and the toolbar, eight 52 px rows that fit, arrow keys, the scrim dismisses", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await openMenu(page);
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    const rows = ["Save revision", "Submit track", "Reverse direction", "Zoom to fit", "Layout details", "How to draw", "Back to track"];
    for (const name of rows) {
      const r = item(page, new RegExp(`^${name}`));
      await expect(r, name).toBeInViewport({ ratio: 1 });
      expect((await r.boundingBox())!.height, name).toBeGreaterThanOrEqual(52);
    }
    await expect(page.getByRole("menuitemradio", { name: "Quick" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("menuitemradio", { name: "Advanced" })).toBeInViewport({ ratio: 1 });
    await expect(menu(page).getByText("3D")).toHaveCount(0);
    // nothing scrolls inside it
    expect(await menu(page).locator(".bottom-sheet-body").evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
    // modal: the menu covers the toolbar, and the scrim the plan; a finger on either lands on neither
    const vp = page.viewportSize()!;
    for (const name of ["Undo", "Delete", "Select"]) {
      const u = (await toolBtn(page, name).boundingBox())!;
      expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".phone-toolbar"), [u.x + u.width / 2, u.y + u.height / 2]), name).toBe(false);
    }
    for (const y of [80, 150]) expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [vp.width / 2, y])).toContain("bottom-sheet-scrim");
    await shot(page, "375-menu");
    // arrow keys move between the rows; the first one that can be used has the focus (nothing to save yet, so Submit)
    await expect(item(page, /^Save revision/)).toBeDisabled();
    await expect(item(page, /^Submit track/)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: "Quick" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(item(page, /^Back to track/)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item(page, /^Submit track/)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(item(page, /^Back to track/)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(item(page, /^Submit track/)).toBeFocused();
    // from the keyboard: Enter on ⋯ opens it on its first row, Escape closes it and the focus goes back to ⋯
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await more(page).focus();
    await page.keyboard.press("Enter");
    await expect(item(page, /^Submit track/)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(more(page)).toBeFocused();
    await openMenu(page);
    // a tap on the grab bar doesn't drop it to peek: every row stays on screen
    await menu(page).locator(".bottom-sheet-handle").tap();
    await page.waitForTimeout(300);
    await expect(item(page, /^Back to track/)).toBeInViewport({ ratio: 1 });
    await expect(item(page, /^Save revision/)).toBeInViewport({ ratio: 1 });
    // a tap on the scrim, above the menu: it goes, and nothing on the plan changed
    const before = await corners(page);
    const t = await Touch.on(page);
    await t.tap([page.viewportSize()!.width / 2, 120]);
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator(".bottom-sheet-scrim")).toHaveCount(0);
    expect(await corners(page)).toEqual(before);
    await expect(page.locator("g.ed-corner.on")).toHaveCount(0);
    // Close too
    await openMenu(page);
    await menu(page).getByRole("button", { name: "Close" }).tap();
    await expect(menu(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the menu's Save revision saves too", async ({ page }) => {
    const calls: Calls = { saves: [], submits: 0 };
    const errors = await serve(page, doc, calls);
    await open(page);
    await openMenu(page);
    // nothing to save yet
    await expect(item(page, /^Save revision/)).toBeDisabled();
    await menu(page).getByRole("button", { name: "Close" }).tap();
    const t = await Touch.on(page);
    await edit(page, t);
    await openMenu(page);
    await expect(item(page, /^Save revision/)).toContainText("Unsaved changes");
    await item(page, /^Save revision/).tap();
    await expect(menu(page)).toHaveCount(0);
    await saveWithNote(page, "", 2);
    expect(calls.saves).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("Submit waits with its reason in the row, then submits once it can", async ({ page }) => {
    const calls: Calls = { saves: [], submits: 0 };
    const errors = await serve(page, doc, calls);
    await open(page);
    const submit = item(page, /^Submit track/);
    // a corner dragged: Submit waits (on the change, or on an error the move made)
    const t = await Touch.on(page);
    await edit(page, t);
    await openMenu(page);
    await expect(submit).toBeDisabled();
    await expect(submit).toContainText(/Waiting on \d+ errors? · see Checks|Save your changes first/);
    await menu(page).getByRole("button", { name: "Close" }).tap();
    // undone: the checks pass and nothing is unsaved, so it can go
    await toolBtn(page, "Undo").tap();
    await expect(state(page)).toHaveText("Saved");
    await openMenu(page);
    await expect(submit).toBeEnabled();
    await expect(submit).toContainText("Send it to the organisers for approval");
    // renamed: it waits for the save
    await item(page, /^Layout details/).tap();
    const details = page.getByRole("dialog", { name: "Layout details" });
    await details.getByLabel("Name").fill("Club night special");
    // put the sheet away first: once it has slid in, its Close button covers ⋯ (a tap on ⋯ only landed mid-slide)
    await details.getByRole("button", { name: "Close" }).tap();
    await expect(details).toHaveCount(0);
    await openMenu(page);
    await expect(submit).toBeDisabled();
    await expect(submit).toContainText("Save your changes first");
    await shot(page, "375-submit-blocked");
    // a tap on it does nothing
    await submit.tap({ force: true });
    await expect(menu(page)).toBeVisible();
    expect(calls.submits).toBe(0);
    await item(page, /^Save revision/).tap();
    await saveWithNote(page, "renamed", 2);
    expect(calls.saves).toEqual([{ note: "renamed", baseRevision: 1, name: "Club night special" }]);
    await openMenu(page);
    await expect(submit).toBeEnabled();
    await submit.tap();
    await expect(menu(page)).toHaveCount(0);
    await expect(banner(page)).toContainText("Submitted for approval.");
    expect(calls.submits).toBe(1);
    // submitted: the row says so, and waits
    await openMenu(page);
    await expect(submit).toBeDisabled();
    await expect(submit).toContainText("Submitted · waiting for approval");
    expect(errors).toEqual([]);
  });

  test("a track with an error: Submit says it's waiting on the error, and a tap on it opens Checks", async ({ page }) => {
    const errors = await serve(page, overlap);
    await open(page);
    await expect(page.locator(".checks-pill")).toContainText("1 error");
    await openMenu(page);
    const submit = item(page, /^Submit track/);
    await expect(submit).toBeDisabled();
    await expect(submit).toContainText("Waiting on 1 error · see Checks");
    await shot(page, "375-submit-error");
    await submit.tap({ force: true });
    await expect(page.getByRole("dialog", { name: "Checks" })).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Quick / Advanced from the menu keeps the draft, and the sheets work in both", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await edit(page, t);
    const drawn = await corners(page);
    await openMenu(page);
    await page.getByRole("menuitemradio", { name: "Advanced" }).tap();
    // the menu stays, with Advanced picked
    await expect(page.getByRole("menuitemradio", { name: "Advanced" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".designer-phone-edit")).toHaveClass(/designer-advanced/);
    await menu(page).getByRole("button", { name: "Close" }).tap();
    // the same draft, still unsaved
    await expect(headerSave(page)).toBeVisible();
    const pts = await page.locator("circle.ed-point").evaluateAll((els) => els.map((e) => [+e.getAttribute("cx")!, -e.getAttribute("cy")!]));
    expect(pts.length).toBe(drawn.length);
    for (let k = 0; k < pts.length; k++) {
      expect(pts[k][0]).toBeCloseTo(drawn[k][0], 3);
      expect(pts[k][1]).toBeCloseTo(drawn[k][1], 3);
    }
    // Advanced's sheets: Checks, Jump, Save
    await page.locator(".checks-pill").tap();
    await expect(page.getByRole("dialog", { name: "Checks" })).toBeVisible();
    await toolBtn(page, "Jump").tap();
    await expect(page.getByRole("dialog", { name: "Jumps" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Snap" })).toBeVisible();
    await headerSave(page).tap();
    await expect(page.getByRole("dialog", { name: "Save" })).toBeVisible();
    // and back to Quick
    await openMenu(page);
    await page.getByRole("menuitemradio", { name: "Quick" }).tap();
    await menu(page).getByRole("button", { name: "Close" }).tap();
    await expect(page.locator(".designer-phone-edit")).toHaveClass(/designer-quick/);
    expect(await corners(page)).toEqual(drawn);
    await toolBtn(page, "Jump").tap();
    await expect(page.getByRole("switch", { name: "Snap to lanes" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Reverse direction and Zoom to fit", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const vb0 = await viewBox(page);
    const before = await corners(page);
    await openMenu(page);
    await item(page, "Reverse direction").tap();
    await expect(menu(page)).toHaveCount(0);
    // the same corners, driven the other way: the order changes, and there's something to save
    await expect.poll(async () => JSON.stringify(await corners(page))).not.toBe(JSON.stringify(before));
    expect([...(await corners(page))].sort()).toEqual([...before].sort());
    await expect(headerSave(page)).toBeVisible();
    // zoomed in, then fitted again
    const t = await Touch.on(page);
    await pinchIn(page, t);
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(vb0[2] * 0.8);
    await openMenu(page);
    await item(page, "Zoom to fit").tap();
    await expect(menu(page)).toHaveCount(0);
    await expect.poll(async () => (await viewBox(page)).map((v) => v.toFixed(3))).toEqual(vb0.map((v) => v.toFixed(3)));
    expect(errors).toEqual([]);
  });

  test("Layout details: the name, editable, with the venue and size, status and description", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    await openMenu(page);
    await item(page, /^Layout details/).tap();
    const s = page.getByRole("dialog", { name: "Layout details" });
    await expect(s).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await expect(s).toContainText("Sports hall B");
    await expect(s).toContainText("Draft");
    await expect(s.getByLabel("Description")).toBeVisible();
    await shot(page, "375-details");
    await s.getByLabel("Name").fill("Club night special");
    await expect(page.locator(".phone-name")).toHaveText("Club night special");
    await expect(headerSave(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Back with unsaved changes asks first; the menu's Back to track too", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await edit(page, t);
    const asked: string[] = [];
    // first: stay
    page.once("dialog", (d) => (asked.push(d.message()), d.dismiss()));
    await page.locator(".phone-header").getByRole("link", { name: "Back to track" }).tap();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain("unsaved changes");
    await expect(page).toHaveURL(new RegExp(`/t/${ID}/edit`));
    await expect(headerSave(page)).toBeVisible();
    // then from the menu: leave
    page.once("dialog", (d) => (asked.push(d.message()), d.accept()));
    await openMenu(page);
    await item(page, "Back to track").tap();
    await expect.poll(() => asked.length).toBe(2);
    await expect(page).toHaveURL(new RegExp(`/t/${ID}$`));
    expect(errors).toEqual([]);
  });

  test("the restore banner: unsaved work from an earlier visit comes back", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await edit(page, t);
    const drawn = await corners(page);
    // the autosave is written 600 ms after the change; then the page goes and comes back
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `designer:${ID}`)).not.toBeNull();
    page.on("dialog", (d) => d.accept());
    await page.reload();
    await expect(page.locator("svg.plan-svg")).toBeVisible();
    await expect(state(page)).toHaveText("Saved");
    const b = banner(page);
    await expect(b).toContainText("You have unsaved changes from");
    // under the header, the whole width, all of it on screen; no Dismiss (it's the only way back to the work)
    const hb = (await page.locator(".phone-header").boundingBox())!;
    const bb = (await b.boundingBox())!;
    expect(bb.y).toBeGreaterThanOrEqual(hb.y + hb.height - 1);
    await expect(b.getByRole("button", { name: "Restore them" })).toBeInViewport({ ratio: 1 });
    await expect(b.getByRole("button", { name: "Discard" })).toBeInViewport({ ratio: 1 });
    await expect(b.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
    // the toolbar is still at the bottom
    expect((await toolbar(page).boundingBox())!.y + 64).toBe(page.viewportSize()!.height);
    await shot(page, "375-banner");
    await b.getByRole("button", { name: "Restore them" }).tap();
    await expect(b).toHaveCount(0);
    await expect(headerSave(page)).toBeVisible();
    expect(await corners(page)).toEqual(drawn);
    expect(errors).toEqual([]);
  });

  test("a message can be dismissed", async ({ page }) => {
    const errors = await serve(page);
    await open(page);
    const t = await Touch.on(page);
    await edit(page, t);
    await headerSave(page).tap();
    await saveWithNote(page, "", 2);
    await banner(page).getByRole("button", { name: "Dismiss" }).tap();
    await expect(banner(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
