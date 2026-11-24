// The user guide (#171). Its source is docs/guide/README.md, with screenshots in docs/guide/img: written for club
// members, reviewed in PRs, readable on GitHub as it is. The build takes both in, and /help (pages/Help.tsx) shows them.
// Anchors are made the way GitHub makes them, so a link to a section works in both places.
import { Marked, type Tokens } from "marked";
import sizes from "virtual:guide-image-sizes";
import source from "../../../../docs/guide/README.md?raw";

export const guideSource: string = source;

export interface GuideImage {
  src: string;
  width: number;
  height: number;
}

const urls = import.meta.glob<string>("../../../../docs/guide/img/*.webp", { eager: true, query: "?url", import: "default" });

/** every screenshot the build has, by file name */
export const guideImages: Record<string, GuideImage> = Object.fromEntries(
  Object.entries(urls).flatMap(([path, src]) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return sizes[name] ? [[name, { src, ...sizes[name] }]] : [];
  }),
);

/** a heading's text without its Markdown marks */
const plain = (text: string) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();

/** A heading's anchor, as GitHub makes it: lower case, punctuation dropped, each space a hyphen. */
export function slug(heading: string): string {
  return plain(heading).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

export interface GuideHeading {
  level: number;
  text: string;
  id: string;
}

export function headings(md: string): GuideHeading[] {
  return new Marked().lexer(md).flatMap((t) => (t.type === "heading" ? [{ level: (t as Tokens.Heading).depth, text: plain((t as Tokens.Heading).text), id: slug((t as Tokens.Heading).text) }] : []));
}

/** the file names of the screenshots a piece of the guide shows, in order */
export function imageNames(md: string): string[] {
  return [...md.matchAll(/!\[[^\]]*\]\(img\/([^)\s]+)\)/g)].map((m) => m[1]);
}

/** The source's own table of contents (for readers on GitHub) sits between these marks; /help draws its own. */
const TOC = /<!-- contents -->[\s\S]*?<!-- \/contents -->\n?/;
export const withoutContents = (md: string) => md.replace(TOC, "");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The guide as HTML: headings with their anchors, screenshots from the build with their sizes, outside links in a new
 * tab. HTML written in the source is shown as text, never run (but for <kbd>, a key): the page puts this string
 * straight into the document.
 */
export function renderGuide(md: string, images: Record<string, GuideImage>): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        return depth === 1 ? `<h1>${inner}</h1>\n` : `<h${depth} id="${esc(slug(text))}">${inner}</h${depth}>\n`;
      },
      image({ href, text }) {
        const name = href.startsWith("img/") ? href.slice(4) : "";
        const img = images[name];
        if (!img) return `<span class="guide-missing">[${esc(text)}]</span>`;
        const kind = name.startsWith("phone-") ? " guide-shot--phone" : name.startsWith("tablet-") ? " guide-shot--tablet" : "";
        return `<img class="guide-shot${kind}" src="${esc(img.src)}" width="${img.width}" height="${img.height}" alt="${esc(text)}" loading="lazy" decoding="async">`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const outside = /^https?:\/\//i.test(href);
        const safe = outside || href.startsWith("#") || (href.startsWith("/") && !href.startsWith("//"));
        if (!safe) return inner;
        return outside ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<a href="${esc(href)}">${inner}</a>`;
      },
      html({ text }) {
        if (/^<!--[\s\S]*-->\s*$/.test(text)) return "";
        // the one tag the guide uses: <kbd> for a key
        return esc(text).replace(/&lt;(\/?)kbd&gt;/g, "<$1kbd>");
      },
    },
  });
  return marked.parse(md, { async: false });
}
