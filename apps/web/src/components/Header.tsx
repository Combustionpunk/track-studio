import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import logoSvg from "../brand/logo.svg?raw";
import { refreshTheme } from "../lib/api.js";
import { useSession } from "../lib/session.js";

export function Header() {
  const { me, config, ready, logout, loginUrl } = useSession();
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link to="/" className="brand">
          {/* inline (our own file), so the logo takes the theme's colours */}
          <span className="brand-logo" dangerouslySetInnerHTML={{ __html: logoSvg }} />
          <span className="brand-app">Track Studio</span>
        </Link>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Library
          </NavLink>
          <NavLink to="/v">Venues</NavLink>
          <NavLink to="/new">New track</NavLink>
        </nav>
        <div className="header-user">
          {!ready ? null : me ? (
            <>
              {me.avatarUrl && <img src={me.avatarUrl.replace("{size}", "48")} alt="" width={24} height={24} className="avatar" />}
              {me.organiser && <RefreshTheme />}
              <span className="who">
                {me.username}
                {me.organiser && <small> · organiser</small>}
              </span>
              <button type="button" className="btn btn-quiet" onClick={() => logout()}>
                Log out
              </button>
            </>
          ) : (
            <>
              {config?.devLogin && <DevLogin returnPath={here} />}
              <a className="btn btn-primary" href={loginUrl(here)}>
                Log in with the forum
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

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
      <button type="button" className="btn btn-quiet btn-icon" onClick={go} disabled={state.busy} title="Refresh theme now (fetch the forum's colours)">
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
      <button type="submit" className="btn btn-quiet">
        Dev login
      </button>
    </form>
  );
}
