// The phone designer, ticket 5 (#124; mockup docs/design/phone/04-overflow-menu.html): the ⋯ menu, the header's Save
// button, the Save and Layout details sheets, the messages as one banner, and the phone layout as the default under
// 640 px. Static renders, with the plan and the bake mocked as in phone-layout.test.tsx.
import type { Check, RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../src/lib/hooks.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const saved = () => ref<RcTrack>("examples/club-a.rctrack.json");

vi.mock("../src/lib/hooks.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/hooks.js")>();
  return { ...real, useApi: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }) as Loadable<unknown> };
});
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useBlocker: () => ({ state: "unblocked" }) }));
let baked: RcTrack["built"] = undefined;
vi.mock("../src/designer/useBake.js", () => ({ useBake: () => ({ built: baked ?? null, pending: false, error: null, ms: 0 }) }));
vi.mock("../src/components/PlanView.js", async (orig) => ({
  ...(await orig<typeof import("../src/components/PlanView.js")>()),
  PlanView: (p: Record<string, unknown>) => <svg className={`plan-svg ${p.className ?? ""}`} aria-label={p.label as string} />,
}));

const { Designer, draftFromDoc, newDraft, PHONE_QUERY, TOUCH_QUERY, LANDSCAPE_PHONE_QUERY } = await import("../src/designer/Designer.js");
const { PhoneHeader, PhoneBanner } = await import("../src/designer/PhoneEditLayout.js");
const { PhoneMenu, PhoneSave, PhoneDetails, submitWhy } = await import("../src/designer/PhoneMenu.js");
const { MODE_KEY } = await import("../src/designer/mode.js");
const { SessionContext } = await import("../src/lib/session.js");
import type { DesignerBase } from "../src/designer/Designer.js";
import type { PhoneMenuProps } from "../src/designer/PhoneMenu.js";

const me = { id: 1, username: "yeti", name: null, avatarUrl: null, organiser: false, admin: false, moderator: false };
const session = { me, config: null, ready: true, refresh: async () => {}, logout: async () => {}, loginUrl: () => "/auth/login" };
const track = { status: "draft", approvedRevision: null } as unknown as DesignerBase["track"];
const edit = (search = "") => (
  (baked = saved().built),
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={[`/t/club-a/edit${search}`]}>
        <Designer mode="edit" initial={draftFromDoc(saved())} base={{ id: "club-a", revision: 1, doc: saved(), track, can: { submit: true } } as unknown as DesignerBase} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  ));
const laying = () =>
  renderToStaticMarkup(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={["/new/design"]}>
        <Designer mode="new" initial={newDraft({ area: { length: 22, width: 12 }, name: "Blank" })} storageKey="test" />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
const setup = (mode: "quick" | "advanced", queries: string[]) => {
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === MODE_KEY ? JSON.stringify({ mode }) : null), setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: queries.includes(q) }), location: { href: "http://localhost/t/club-a/edit", pathname: "/t/club-a/edit", search: "" } });
};
afterEach(() => (vi.unstubAllGlobals(), (baked = undefined)));
const r = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const noop = () => {};

describe("the phone layout is the default under 640 px (the switch is gone)", () => {
  it.each(["quick", "advanced"] as const)("%s: a phone opens the editing layout with no ?phone=edit", (mode) => {
    setup(mode, [PHONE_QUERY, TOUCH_QUERY]);
    const html = edit();
    expect(html).toMatch(new RegExp(`^<div class="designer designer-phone-edit designer-${mode}">`));
    expect(html).not.toContain("Design on a laptop or tablet");
    // ⋯ opens the menu now
    expect(html).toMatch(/<button[^>]*aria-label="More"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*>/);
    expect(html).not.toMatch(/<button[^>]*aria-label="More"[^>]*disabled/);
    // How to draw moved from the header into the menu
    expect(/<header class="phone-header">.*?<\/header>/.exec(html)?.[0]).not.toContain("How to draw");
  });

  it("a landscape phone gets the editing layout with the turn-upright message", () => {
    setup("quick", [LANDSCAPE_PHONE_QUERY, TOUCH_QUERY]);
    const html = edit();
    expect(html).toMatch(/^<div class="designer designer-phone-edit designer-quick">/);
    expect(html).toContain("Turn your phone upright to edit");
  });

  it("laying the lanes of a new track (stage 2) says so, with no 'Design on a laptop or tablet'", () => {
    setup("quick", [PHONE_QUERY, TOUCH_QUERY]);
    const html = laying();
    expect(html).not.toContain("Design on a laptop or tablet");
    expect(html).toContain("Lay the lanes on a laptop or tablet");
    expect(html).not.toContain("phone-toolbar");
  });

  it("laptops and tablets are as they were", () => {
    setup("quick", []);
    expect(edit()).toMatch(/^<div class="designer designer-quick ">/);
    setup("quick", [TOUCH_QUERY]);
    expect(edit()).toMatch(/^<div class="designer designer-quick designer-touch">/);
  });
});

describe("the header's save state", () => {
  const backTo = { to: "/t/x", label: "Back to track" };
  const header = (p: Partial<React.ComponentProps<typeof PhoneHeader>>) =>
    r(<PhoneHeader backTo={backTo} name="Club A" dirty={false} revision={3} loggedIn loginUrl="/auth/login" saving={false} saveOpen={false} onSave={noop} menuOpen={false} onMenu={noop} {...p} />);
  const saveOf = (html: string) => /<span class="phone-save"[^>]*>(.*?)<\/span>(?=<button[^>]*aria-label="More")/.exec(html)?.[1] ?? "";

  it("unsaved changes: a 44 px Save button that opens the Save sheet", () => {
    const s = saveOf(header({ dirty: true }));
    expect(s).toMatch(/^<button type="button" class="phone-save-btn"[^>]*aria-haspopup="dialog" aria-expanded="false"[^>]*>/);
    expect(s).toMatch(/<svg[^>]*class="lucide lucide-save[^"]*"/);
    expect(s).toContain(">Save</button>");
  });
  it("a track never saved: the Save button too", () => {
    expect(saveOf(header({ revision: undefined }))).toContain('class="phone-save-btn"');
  });
  it("saved: the plain word", () => {
    expect(saveOf(header({}))).toBe("Saved");
  });
  it("saving: the button waits", () => {
    expect(saveOf(header({ dirty: true, saving: true }))).toMatch(/<button[^>]*disabled[^>]*>.*Saving…<\/button>/);
  });
  it("not logged in: a link to log in", () => {
    expect(saveOf(header({ dirty: true, loggedIn: false }))).toMatch(/^<a class="phone-save-btn" href="\/auth\/login">.*Log in<\/a>$/);
  });
  it("⋯ opens the menu", () => {
    expect(header({ menuOpen: true })).toMatch(/<button[^>]*aria-label="More" aria-haspopup="menu" aria-expanded="true"/);
  });
});

const menu = (p: Partial<PhoneMenuProps> = {}) =>
  r(
    <PhoneMenu
      view="quick"
      onView={noop}
      save={{ label: "Save revision", state: "Unsaved changes · kept on this device", disabled: false, loginUrl: null, onSave: noop }}
      submit={{ why: "Waiting on 1 error · see Checks", onSubmit: noop, onSeeChecks: noop }}
      reverse={{ onReverse: noop, canReverse: true }}
      onFit={noop}
      onDetails={noop}
      onHowTo={noop}
      backTo={{ to: "/t/x", label: "Back to track" }}
      {...p}
    />,
  );
const row = (html: string, label: string) => new RegExp(`<(?:button|a)[^>]*role="menuitem"[^>]*>(?:(?!</(?:button|a)>).)*${label}(?:(?!</(?:button|a)>).)*</(?:button|a)>`).exec(html)?.[0] ?? "";

describe("the overflow menu", () => {
  it("eight rows in order, in a role=menu list; no 3D row", () => {
    const html = menu();
    expect(html).toMatch(/<ul class="phone-menu" role="menu" aria-label="More"[^>]*>/);
    const labels = [...html.matchAll(/<li role="none"[^>]*>.*?<\/li>/g)].map((m) => /Save revision|Submit track|Mode|Reverse direction|Zoom to fit|Layout details|How to draw|Back to track/.exec(m[0])?.[0]);
    expect(labels).toEqual(["Save revision", "Submit track", "Mode", "Reverse direction", "Zoom to fit", "Layout details", "How to draw", "Back to track"]);
    expect(html).not.toMatch(/3D/);
  });

  it("Save revision is the primary row, with the save state as its second line", () => {
    const s = row(menu(), "Save revision");
    expect(s).toContain("phone-menu-primary");
    expect(s).toContain("<small>Unsaved changes · kept on this device</small>");
    expect(s).not.toContain("disabled");
    expect(row(menu({ save: { label: "Save revision", state: "Saved · revision 3", disabled: true, loginUrl: null, onSave: noop } }), "Save revision")).toContain("disabled");
  });

  it("not logged in: the Save row logs in", () => {
    const s = row(menu({ save: { label: "Save revision", state: "Unsaved changes", disabled: false, loginUrl: "/auth/login", onSave: noop } }), "Log in to save");
    expect(s).toMatch(/^<a[^>]*href="\/auth\/login"/);
  });

  it("a blocked Submit is disabled and says why in its row", () => {
    const s = row(menu(), "Submit track");
    expect(s).toContain('aria-disabled="true"');
    expect(s).toContain("<small>Waiting on 1 error · see Checks</small>");
  });

  it("an unblocked Submit is enabled", () => {
    const s = row(menu({ submit: { why: null, onSubmit: noop, onSeeChecks: null } }), "Submit track");
    expect(s).not.toContain("aria-disabled");
    expect(s).toContain("<small>Send it to the organisers for approval</small>");
  });

  it("Mode is a Quick | Advanced segmented control of menu radios", () => {
    const html = menu({ view: "advanced" });
    expect(html).toMatch(/<button type="button" role="menuitemradio" aria-checked="false"[^>]*>Quick<\/button>/);
    expect(html).toMatch(/<button type="button" role="menuitemradio" aria-checked="true"[^>]*>Advanced<\/button>/);
  });

  it("Reverse direction is disabled when the track can't be reversed", () => {
    expect(row(menu({ reverse: { onReverse: noop, canReverse: false } }), "Reverse direction")).toContain("disabled");
  });

  it("Back to track is a link; every row has a Lucide icon and is at least 52 px (by class)", () => {
    const html = menu();
    expect(row(html, "Back to track")).toMatch(/^<a[^>]*href="\/t\/x"/);
    const rows = [...html.matchAll(/<li role="none"[^>]*>(.*?)<\/li>/g)].map((m) => m[1]);
    for (const x of rows) expect(x).toMatch(/<svg[^>]*class="lucide[^"]*"[^>]*aria-hidden="true"/);
    expect(html.match(/class="phone-menu-item[^"]*"/g)?.length).toBe(7);
    expect(html.match(/class="phone-menu-row"/g)?.length).toBe(1);
  });
});

describe("why Submit waits, short enough for a row", () => {
  const err = { code: "x", level: "error", message: "m" } as unknown as Check;
  const warn = { code: "y", level: "warning", message: "m" } as unknown as Check;
  it.each([
    [{ dirty: false, pending: false, checks: [err] }, "Waiting on 1 error · see Checks"],
    [{ dirty: true, pending: false, checks: [err, err] }, "Waiting on 2 errors · see Checks"],
    [{ dirty: true, pending: false, checks: [warn] }, "Save your changes first"],
    [{ dirty: false, pending: true, checks: [] }, "Checking the track…"],
    [{ dirty: false, pending: false, checks: [warn] }, null],
  ])("%o: %s", (s, why) => expect(submitWhy(s)).toBe(why));
});

describe("the Save sheet", () => {
  it("What changed? and the Save button, as the desktop's note pop-over", () => {
    const html = r(<PhoneSave mode="edit" note="" setNote={noop} onSave={noop} saving={false} revision={3} approvedRevision={null} />);
    expect(html).toMatch(/<form class="phone-save-form"/);
    expect(html).toMatch(/<label[^>]*><span>What changed\? \(optional\)<\/span><input[^>]*maxLength="500"/);
    expect(html).toMatch(/<button type="submit" class="btn btn-primary"[^>]*>Save as revision 4<\/button>/);
    expect(html).not.toContain("stays approved");
  });
  it("a new track saves as a track; an approved revision says it stays approved", () => {
    expect(r(<PhoneSave mode="new" note="" setNote={noop} onSave={noop} saving={false} revision={undefined} approvedRevision={null} />)).toContain(">Save track</button>");
    expect(r(<PhoneSave mode="edit" note="" setNote={noop} onSave={noop} saving={false} revision={3} approvedRevision={2} />)).toContain("Revision 2 stays approved");
  });
  it("saving: the button waits", () => {
    expect(r(<PhoneSave mode="edit" note="" setNote={noop} onSave={noop} saving revision={3} approvedRevision={null} />)).toMatch(/<button type="submit"[^>]*disabled[^>]*>Saving…<\/button>/);
  });
});

describe("the Layout details sheet", () => {
  const details = (p: Partial<React.ComponentProps<typeof PhoneDetails>> = {}) =>
    r(<PhoneDetails name="Club A" onName={noop} description="Tight and twisty" onDescription={noop} venueName="Sports hall B" area={{ length: 22, width: 12 }} status={{ status: "draft" } as never} {...p} />);
  it("the name (editable), venue and size, status, description", () => {
    const html = details();
    expect(html).toMatch(/<input[^>]*aria-label="Track name"|<span>Name<\/span><input[^>]*value="Club A"/);
    expect(html).toContain('value="Club A"');
    expect(html).toContain("Sports hall B · 22 × 12 m");
    expect(html).toContain("Draft");
    expect(html).toMatch(/<textarea[^>]*>Tight and twisty<\/textarea>/);
  });
  it("a track with no venue, never saved", () => {
    const html = details({ venueName: undefined, status: undefined, description: undefined });
    expect(html).toContain("22 × 12 m");
    expect(html).toContain("Not saved yet");
  });
});

describe("the messages: one banner under the header", () => {
  const base = { restore: null, revision: 3, onRestore: noop, onDiscard: noop, loggedIn: true, message: null, approvedRevision: null, loginUrl: "/auth/login", dismissed: [] as string[], onDismiss: noop };
  const restore = { draft: {} as never, baseRevision: 3, savedAt: "2026-11-16T10:00:00Z" };
  const count = (html: string) => (html.match(/class="msg /g) ?? []).length;

  it("nothing to say: nothing", () => expect(r(<PhoneBanner {...base} />)).toBe(""));

  it("the restore prompt first, with Restore and Discard and no Dismiss: it's the only way back to the work", () => {
    const html = r(<PhoneBanner {...base} restore={restore} loggedIn={false} approvedRevision={2} message={{ kind: "info", text: "Hi" }} />);
    expect(count(html)).toBe(1);
    expect(html).toContain("You have unsaved changes from");
    expect(html).toMatch(/<button[^>]*>Restore them<\/button>/);
    expect(html).toMatch(/<button[^>]*>Discard<\/button>/);
    expect(html).not.toContain('aria-label="Dismiss"');
  });

  it("then what just happened, not logged in, the approved revision; each can be dismissed", () => {
    expect(r(<PhoneBanner {...base} loggedIn={false} approvedRevision={2} message={{ kind: "error", text: "Oops" }} />)).toMatch(/class="msg msg-error".*Oops.*aria-label="Dismiss"/);
    const login = r(<PhoneBanner {...base} loggedIn={false} approvedRevision={2} />);
    expect(count(login)).toBe(1);
    expect(login).toMatch(/not logged in.*href="\/auth\/login".*aria-label="Dismiss"/);
    const approved = r(<PhoneBanner {...base} approvedRevision={2} dismissed={["login"]} loggedIn={false} />);
    expect(approved).toMatch(/Revision 2 is approved.*aria-label="Dismiss"/);
    expect(r(<PhoneBanner {...base} approvedRevision={2} dismissed={["approved"]} />)).toBe("");
  });
});
