// The site's header (#149): the shared RC Misfits top bar, <rm-header site="tracks"> from the brand package (logo,
// Forum · Meetings · Tracks · Timing, the account), and under it Track Studio's own pages. Sign in is the existing forum
// sign-in; Sign out is the bar's rm-sign-out event, handled with the existing POST /auth/logout, never a GET link.
import "@rcmisfits/brand/header.js";
import { useEffect, useRef, useState, type DetailedHTMLProps, type FormEvent, type HTMLAttributes } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import type { ServerConfig } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { SITE_MENU_OPENED, watchSiteMenu } from "../lib/siteMenu.js";

type RmHeaderAttributes = {
  site?: string;
  user?: string;
  "sign-in-url"?: string;
  "sign-out-url"?: string;
  "forum-url"?: string;
  "meetings-url"?: string;
  "tracks-url"?: string;
  "timing-url"?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "rm-header": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & RmHeaderAttributes;
    }
  }
}

/** The bar's links from the server's addresses (the dev forum and timing site in dev); none said, the bar's live links stand. */
export function siteLinks(config: Pick<ServerConfig, "forumUrl"> & { timingUrl?: string } | null): { forum?: string; meetings?: string; timing?: string } {
  const out: { forum?: string; meetings?: string; timing?: string } = {};
  const forum = config?.forumUrl?.replace(/\/+$/, "");
  if (forum) {
    out.forum = `${forum}/`;
    out.meetings = `${forum}/events`;
  }
  const timing = config?.timingUrl?.replace(/\/+$/, "");
  if (timing) out.timing = `${timing}/`;
  return out;
}

export function Header() {
  const { me, config, ready, logout, loginUrl } = useSession();
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  const bar = useRef<HTMLElement>(null);
  const links = siteLinks(config);

  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const onSignOut = (event: Event) => {
      event.preventDefault();
      void logout(); // the existing sign-out: a POST, then the forum's logout (#132)
    };
    element.addEventListener("rm-sign-out", onSignOut);
    // the designer's sheets give way when the bar's phone menu opens (lib/siteMenu.ts)
    const stop = watchSiteMenu(element, () => window.dispatchEvent(new Event(SITE_MENU_OPENED)));
    return () => {
      element.removeEventListener("rm-sign-out", onSignOut);
      stop();
    };
  }, [logout]);

  return (
    <div className="ts-site-header">
      <rm-header
        ref={bar}
        site="tracks"
        user={ready && me ? me.username : ""}
        sign-in-url={loginUrl(here)}
        tracks-url="/"
        forum-url={links.forum}
        meetings-url={links.meetings}
        timing-url={links.timing}
      />
      <nav className="ts-appnav" aria-label="Track Studio">
        <div className="ts-appnav__links">
          {/* the library and its track pages */}
          <Link to="/" aria-current={inLibrary(loc.pathname) ? "page" : undefined}>
            Library
          </Link>
          <NavLink to="/v">Venues</NavLink>
          <NavLink to="/new">New track</NavLink>
          {/* the class speeds behind the lap time estimates (#76) */}
          {me?.organiser && <NavLink to="/lap-speeds">Lap speeds</NavLink>}
        </div>
        {ready && !me && config?.devLogin && <DevLogin returnPath={here} />}
      </nav>
    </div>
  );
}

const inLibrary = (path: string) => path === "/" || (path.startsWith("/t/") && !path.endsWith("/edit"));

/** Only when the server runs with DEV_LOGIN=1. */
function DevLogin({ returnPath }: { returnPath: string }) {
  const [name, setName] = useState("");
  const [organiser, setOrganiser] = useState(true);
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    window.location.href = `/auth/dev-login?user=${encodeURIComponent(name.trim())}${organiser ? "&organiser=1" : ""}&return=${encodeURIComponent(returnPath)}`;
  };
  return (
    <form className="dev-login" onSubmit={go} title="Development only: log in without the forum">
      <input aria-label="Dev user name" placeholder="dev user" value={name} onChange={(e) => setName(e.target.value)} size={9} />
      <label>
        <input type="checkbox" checked={organiser} onChange={(e) => setOrganiser(e.target.checked)} /> org
      </label>
      <button type="submit" className="ts-btn ts-btn--quiet">
        Dev login
      </button>
    </form>
  );
}
