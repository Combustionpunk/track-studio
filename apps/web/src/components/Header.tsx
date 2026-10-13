import { useState, type FormEvent } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useSession } from "../lib/session.js";

export function Header() {
  const { me, config, ready, logout, loginUrl } = useSession();
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <span>Track Studio</span>
        </Link>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Library
          </NavLink>
          <NavLink to="/v">Venues</NavLink>
        </nav>
        <div className="header-user">
          {!ready ? null : me ? (
            <>
              {me.avatarUrl && <img src={me.avatarUrl.replace("{size}", "48")} alt="" width={24} height={24} className="avatar" />}
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
