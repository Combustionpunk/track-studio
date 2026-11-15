import logo from "@rcmisfits/brand/logo.svg";
import { Menu, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
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
        {/* the brand's logo, as it is: never recoloured (#135) */}
        <img className="brand-logo" src={logo} alt="RC Misfits" height={28} />
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
          {/* the class speeds behind the lap time estimates (#76) */}
          {me?.organiser && <NavLink to="/lap-speeds">Lap speeds</NavLink>}
        </nav>
        <div className="ts-header__end">
          {!ready ? null : me ? (
            <>
              {me.avatarUrl && <img src={me.avatarUrl.replace("{size}", "48")} alt="" width={24} height={24} className="avatar" />}
              <span>
                Signed in as {me.username}
                {me.organiser && " · organiser"}
              </span>
              <button type="button" className="ts-btn ts-btn--quiet" onClick={() => logout()}>
                Log out
              </button>
            </>
          ) : (
            <>
              {config?.devLogin && <DevLogin returnPath={here} />}
              <a className="ts-btn" href={loginUrl(here)}>
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
