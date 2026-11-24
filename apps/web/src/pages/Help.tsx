// /help (#171): the user guide, from docs/guide (help/guide.ts). Anyone can read it, signed in or not. The contents
// list and the section anchors come from the guide's own headings; Help in the menu and the app's "?" links land here.
import { useEffect, useMemo, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { guideImages, guideSource, headings, renderGuide, withoutContents } from "../help/guide.js";

/** Bring a section to the top, under the site's bar. */
function showSection(hash: string) {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // a hash that isn't valid percent-encoding: use it as it is
  }
  if (id) document.getElementById(id)?.scrollIntoView();
}

export function Help() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const html = useMemo(() => renderGuide(withoutContents(guideSource), guideImages), []);
  const contents = useMemo(() => headings(guideSource).filter((h) => h.level === 2 || h.level === 3), []);

  useEffect(() => {
    document.title = "Help · Track Studio";
  }, []);
  // after the page's own scroll to the top on arrival (routes.tsx, Layout), which runs after this effect
  useEffect(() => {
    if (!hash) return;
    const frame = requestAnimationFrame(() => showSection(hash));
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  // links to the app's own pages (/new, /v) change page without a reload; anchors and outside links are the browser's
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href || !href.startsWith("/") || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <div className="wrap page help-page">
      <nav className="help-contents" aria-label="Contents">
        <h2 className="help-contents__h">Contents</h2>
        <ol>
          {contents
            .filter((h) => h.level === 2)
            .map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`} aria-current={hash === `#${h.id}` ? "location" : undefined}>
                  {h.text}
                </a>
                <Sub items={contents.slice(contents.indexOf(h) + 1)} hash={hash} />
              </li>
            ))}
        </ol>
      </nav>
      {/* the guide is the repo's own Markdown, rendered with raw HTML escaped (help/guide.ts) */}
      <article className="guide" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** the sub-headings of one section: those up to the next section */
function Sub({ items, hash }: { items: { level: number; text: string; id: string }[]; hash: string }) {
  const end = items.findIndex((h) => h.level === 2);
  const subs = end < 0 ? items : items.slice(0, end);
  if (!subs.length) return null;
  return (
    <ol>
      {subs.map((s) => (
        <li key={s.id}>
          <a href={`#${s.id}`} aria-current={hash === `#${s.id}` ? "location" : undefined}>
            {s.text}
          </a>
        </li>
      ))}
    </ol>
  );
}
