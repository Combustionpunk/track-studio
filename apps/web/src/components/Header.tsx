import { LoaderCircle, Menu, RefreshCw, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import logoSvg from "../brand/logo.svg?raw";
import { refreshTheme } from "../lib/api.js";
import { useSession } from "../lib/session.js";

export function Header() {
  const { me, config, ready, logout, loginUrl } = useSession();
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  // phones: navigation and the user's controls fold behind the menu button; any navigation closes it
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <header className="ts-header" data-open={open || undefined}>
      <Link to="/" className="ts-brand">
        {/* inline (our own file), so the logo takes the theme's colours */}
        <span className="brand-logo" dangerouslySetInnerHTML={{ __html: logoSvg }} />
        <span className="ts-brand__app">Track Studio</span>
      </Link>
      <button type="button" className="ts-btn ts-btn--quiet ts-btn--touch ts-header__menu" aria-label="Menu" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((o) => !o)}>
        {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
      </button>
      <div className="ts-header__fold" id="main-nav">
        <nav className="ts-nav" aria-label="Main">
          {/* the library and its track pages */}
          <Link to="/" aria-current={inLibrary(loc.pathname) ? "page" : undefined}>
            Library
          </Link>
          <NavLink to="/v">Venues</NavLink>
          <NavLink to="/new">New track</NavLink>
        </nav>
        <div className="ts-header__end">
          {!ready ? null : me ? (
            <>
              {me.avatarUrl && <img src={me.avatarUrl.replace("{size}", "48")} alt="" width={24} height={24} className="avatar" />}
              <span>
                Signed in as {me.username}
                {me.organiser && " · organiser"}
              </span>
              {me.organiser && <RefreshTheme />}
              <button type="button" className="ts-btn ts-btn--quiet" onClick={() => logout()}>
                Log out
              </button>
            </>
          ) : (
            <>
              {config?.devLogin && <DevLogin returnPath={here} />}
              <a className="ts-btn ts-btn--primary" href={loginUrl(here)}>
                Log in with the forum
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const inLibrary = (path: string) => path === "/" || (path.startsWith("/t/") && !path.endsWith("/edit"));

/** Organisers (track-admins, forum admins): fetch the forum's colours now instead of waiting for the hourly sync. */
function RefreshTheme() {
  const [state, setState] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: "" });
  const go = async () => {
    setState({ busy: true, msg: "" });
    try {
      const res = await refreshTheme();
      let style = document.getElementById("theme");
      if (!style) {
        style = document.createElement("style");
        style.id = "theme";
        document.head.append(style);
      }
      style.textContent = res.css;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", res.theme.colors.headerBg);
      setState({ busy: false, msg: res.ok ? `Theme updated: ${res.theme.scheme.name}` : "Couldn't reach the forum; colours unchanged" });
    } catch (e) {
      setState({ busy: false, msg: e instanceof Error ? e.message : "Refresh failed" });
    }
  };
  return (
    <>
      <button type="button" className="ts-btn ts-btn--quiet ts-btn--icon" onClick={go} disabled={state.busy} title="Refresh theme now (fetch the forum's colours)">
        {state.busy ? <LoaderCircle size={18} aria-hidden className="spin" /> : <RefreshCw size={18} aria-hidden />}
        <span className="sr-only">Refresh theme now</span>
      </button>
      <span className="header-status" role="status">
        {state.msg}
      </span>
    </>
  );
}

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
