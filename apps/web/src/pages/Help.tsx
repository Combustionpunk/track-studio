// /help (#171): the user guide, from docs/guide (help/guide.ts). Anyone can read it, signed in or not. The contents
// list and the section anchors come from the guide's own headings; Help in the menu and the app's "?" links land here.
import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { guideImages, guideSource, headings, renderGuide, withoutContents } from "../help/guide.js";

/** Bring a section to the top, under the site's bar. */
function showSection(hash: string) {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // a hash that isn't valid percent-encoding: use it as it is
  }
  const section = id ? document.getElementById(id) : null;
  if (!section) return;
  section.scrollIntoView();
  // the keyboard and a screen reader carry on from the section, not from the top of the page
  section.focus({ preventScroll: true });
}

export function Help() {
  const { hash } = useLocation();
  const html = useMemo(() => renderGuide(withoutContents(guideSource), guideImages), []);
  const contents = useMemo(() => headings(guideSource).filter((h) => h.level === 2 || h.level === 3), []);

  useEffect(() => {
    document.title = "Help · Track Studio";
  }, []);
  // after the page's own scroll to the top on arrival (routes.tsx, Layout), which runs after this effect
  // (Help in the menu, from a section: back to the top)
  useEffect(() => {
    const frame = requestAnimationFrame(() => (hash ? showSection(hash) : window.scrollTo(0, 0)));
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <div className="wrap page help-page">
      <nav className="help-contents" aria-labelledby="help-contents-h">
        <p className="help-contents__h" id="help-contents-h">
          Contents
        </p>
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
      <article className="guide" dangerouslySetInnerHTML={{ __html: html }} />
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
