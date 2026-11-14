import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, post, type Me, type ServerConfig } from "./api.js";

interface Session {
  me: Me | null;
  config: ServerConfig | null;
  ready: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  loginUrl: (returnPath?: string) => string;
}

/** Ends the session here, then sends the browser to the forum's logout so every site is signed out (#132). True when it navigates away. */
export async function signOut(postFn: (path: string) => Promise<{ redirect?: string | null }>, go: (url: string) => void): Promise<boolean> {
  const { redirect } = await postFn("/auth/logout");
  if (!redirect) return false;
  go(redirect);
  return true;
}

/** The server's note on the page address that this browser keeps no cookies, so it isn't sent round the forum again (#132). */
export const NO_SIGNIN_PARAM = "nosignin";

/** The query string without the server's `?nosignin=1` marker, so it isn't bookmarked or shared; unchanged otherwise. */
export function withoutNoSignin(search: string): string {
  if (!search.startsWith("?")) return search;
  const parts = search.slice(1).split("&");
  const rest = parts.filter((part) => part.split("=")[0] !== NO_SIGNIN_PARAM);
  if (rest.length === parts.length) return search;
  return rest.length ? `?${rest.join("&")}` : "";
}

const Ctx = createContext<Session | null>(null);
/** For tests: provide a session without the API. */
export const SessionContext = Ctx;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [m, c] = await Promise.all([api<Me | null>("/api/me"), api<ServerConfig>("/api/config")]);
    setMe(m);
    setConfig(c);
    setReady(true);
  }, []);

  useEffect(() => {
    refresh().catch(() => setReady(true));
  }, [refresh]);

  const logout = useCallback(async () => {
    const away = await signOut((path) => post<{ redirect?: string | null }>(path), (url) => window.location.assign(url));
    if (!away) setMe(null);
  }, []);

  const loginUrl = (returnPath = window.location.pathname + window.location.search) => `/auth/login?return=${encodeURIComponent(returnPath)}`;

  return <Ctx.Provider value={{ me, config, ready, refresh, logout, loginUrl }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
