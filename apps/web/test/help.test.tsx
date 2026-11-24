// The user guide (#171): docs/guide/README.md is the source, /help shows it, and the app's Help and "?" links open its
// sections. These tests keep the three in step: the eight sections, every anchor a link uses, every screenshot.
import { GENERATOR } from "@track-studio/engine";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HelpLink } from "../src/help/HelpLink.js";
import { guideImages, guideSource, headings, imageNames, renderGuide, slug } from "../src/help/guide.js";
import { HELP_TOPICS, helpHref, type HelpTopic } from "../src/help/topics.js";
import { Help } from "../src/pages/Help.js";

const GUIDE_DIR = join(__dirname, "../../../docs/guide");
const md = readFileSync(join(GUIDE_DIR, "README.md"), "utf8");
const heads = headings(md);
const ids = heads.map((h) => h.id);

/** the issue's eight sections, in order */
const SECTIONS = ["getting-started", "start-a-layout", "draw-the-track", "edit", "check-and-finish", "share", "on-a-tablet-or-phone", "faq"];

/** the text of one section: from its `## ` heading to the next */
function section(id: string): string {
  const parts = md.split(/^## /m).slice(1);
  const part = parts.find((p) => slug(p.split("\n")[0]) === id);
  if (!part) throw new Error(`no section ${id}`);
  return part;
}

describe("the user guide's source (docs/guide/README.md)", () => {
  it("is the file the app shows", () => {
    expect(guideSource).toBe(md);
  });

  it("has the eight sections, in order", () => {
    expect(heads.filter((h) => h.level === 2).map((h) => h.id)).toEqual(SECTIONS);
  });

  it("says at the top which rctrack version it was written against, and that is the engine's", () => {
    const version = GENERATOR.split(" ").pop();
    const top = md.split(/^## /m)[0];
    expect(top).toContain(`rctrack ${version}`);
  });

  it("gives every heading its own anchor", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it("anchors are made as GitHub makes them, so links work in both places", () => {
    expect(slug("Check and finish")).toBe("check-and-finish");
    expect(slug("The build sheet (what to print)")).toBe("the-build-sheet-what-to-print");
    expect(slug("How do I… undo?")).toBe("how-do-i-undo");
    expect(slug("Pinch, pan and **armed** tools")).toBe("pinch-pan-and-armed-tools");
    expect(slug("2D & 3D")).toBe("2d--3d");
  });

  it("every link inside the guide goes to a heading that exists", () => {
    const links = [...md.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(8); // the table of contents at least
    for (const l of links) expect(ids, `#${l}`).toContain(l);
  });

  it("has a table of contents that lists every section", () => {
    const top = md.split(/^## /m)[0];
    for (const id of SECTIONS) expect(top, id).toContain(`](#${id})`);
  });

  it("every screenshot it shows is in docs/guide/img, described, and none is left over", () => {
    const used = imageNames(md);
    const files = readdirSync(join(GUIDE_DIR, "img")).filter((f) => f.endsWith(".png"));
    expect(used.length).toBeGreaterThan(20);
    for (const name of used) expect(existsSync(join(GUIDE_DIR, "img", name)), name).toBe(true);
    expect(files.filter((f) => !used.includes(f)), "screenshots nothing shows").toEqual([]);
    // alt text on every one
    for (const m of md.matchAll(/!\[([^\]]*)\]\(img\/[^)]+\)/g)) expect(m[1].trim().length, m[0]).toBeGreaterThan(8);
    // and nothing but local screenshots
    expect([...md.matchAll(/!\[[^\]]*\]\((?!img\/)[^)]*\)/g)].map((m) => m[0])).toEqual([]);
  });

  it("every section has screenshots; tablet and phone ones where the section is about them", () => {
    for (const id of SECTIONS.filter((s) => s !== "faq")) expect(imageNames(section(id)).length, id).toBeGreaterThan(0);
    const touch = imageNames(section("on-a-tablet-or-phone"));
    expect(touch.some((n) => n.startsWith("tablet-"))).toBe(true);
    expect(touch.some((n) => n.startsWith("phone-"))).toBe(true);
    // the build knows every screenshot's size, so the page doesn't jump as they load
    for (const name of imageNames(md)) {
      const img = guideImages[name];
      expect(img, name).toBeTruthy();
      expect(img.width, name).toBeGreaterThan(100);
      expect(img.height, name).toBeGreaterThan(100);
      expect(img.src, name).toBeTruthy();
    }
    // phone screenshots are 375 px wide
    for (const name of imageNames(md).filter((n) => n.startsWith("phone-"))) expect(guideImages[name].width, name).toBe(375);
  });

  it("uses no real members' names: only the example people and venues", () => {
    expect(md).not.toMatch(/combustionpunk|yeti/i);
  });
});

describe("the help links (Help in the menu, ? on the palette, the fit check and the build sheet)", () => {
  it("every topic's anchor is a heading in the guide", () => {
    const topics = Object.keys(HELP_TOPICS) as HelpTopic[];
    expect(topics).toEqual(expect.arrayContaining(["guide", "palette", "fit", "build", "touch"]));
    for (const t of topics) {
      const anchor = HELP_TOPICS[t].anchor;
      if (anchor) expect(ids, `${t} → #${anchor}`).toContain(anchor);
      expect(helpHref(t)).toBe(anchor ? `/help#${anchor}` : "/help");
    }
  });

  it("the palette, fit check and build sheet topics each open their own section", () => {
    expect(HELP_TOPICS.palette.anchor).toBe("draw-the-track");
    expect(section("check-and-finish")).toContain(`### ${heads.find((h) => h.id === HELP_TOPICS.fit.anchor)!.text}`);
    expect(section("check-and-finish")).toContain(`### ${heads.find((h) => h.id === HELP_TOPICS.build.anchor)!.text}`);
    expect(HELP_TOPICS.touch.anchor).toBe("on-a-tablet-or-phone");
  });

  it("a ? link opens the section in a new tab, so work in the designer stays where it is, and says what it is", () => {
    const html = renderToStaticMarkup(<HelpLink topic="fit" />);
    expect(html).toContain(`href="/help#${HELP_TOPICS.fit.anchor}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain(`aria-label="${HELP_TOPICS.fit.label} (opens in a new tab)"`);
  });
});

describe("the guide as /help shows it", () => {
  const html = renderGuide(md, guideImages);

  it("gives every heading its anchor", () => {
    for (const h of heads.filter((x) => x.level > 1)) expect(html, h.id).toContain(`<h${h.level} id="${h.id}"`);
  });

  it("shows each screenshot from the build, with its size and alt text, loaded as it's reached", () => {
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBe([...md.matchAll(/!\[/g)].length);
    for (const tag of imgs) {
      expect(tag).toMatch(/ src="[^"]+"/);
      expect(tag).not.toMatch(/ src="img\//);
      expect(tag).toMatch(/ width="\d+" height="\d+"/);
      expect(tag).toMatch(/ alt="[^"]{8,}"/);
      expect(tag).toContain('loading="lazy"');
    }
    expect(html).toMatch(/<img [^>]*class="guide-shot guide-shot--phone"/);
  });

  it("links out of the guide open safely; links inside it stay on the page", () => {
    const html = renderGuide("# T\n\n[forum](https://forum.rcmisfits.org/) [here](#faq) [new](/new)\n\n## FAQ\n", {});
    expect(html).toContain('<a href="https://forum.rcmisfits.org/" target="_blank" rel="noopener noreferrer">forum</a>');
    expect(html).toContain('<a href="#faq">here</a>');
    expect(html).toContain('<a href="/new">new</a>');
  });

  it("raw HTML in the source is shown as text, never run", () => {
    const html = renderGuide("# T\n\n<script>alert(1)</script>\n\nA <b onclick=\"x()\">b</b>\n", {});
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b onclick");
  });

  it("the page: a title, a table of contents for the eight sections, and the guide", () => {
    const page = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/help"]}>
        <Help />
      </MemoryRouter>,
    );
    expect(page).toMatch(/<h1[^>]*>[^<]*Track Studio[^<]*<\/h1>/);
    const nav = /<nav[^>]*aria-label="Contents"[^>]*>(.*?)<\/nav>/s.exec(page)?.[1] ?? "";
    for (const id of SECTIONS) expect(nav, id).toContain(`href="#${id}"`);
    for (const id of SECTIONS) expect(page, id).toContain(`<h2 id="${id}"`);
  });
});
