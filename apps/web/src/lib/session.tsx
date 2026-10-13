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

const Ctx = createContext<Session | null>(null);

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
    await post("/auth/logout");
    setMe(null);
  }, []);

  const loginUrl = (returnPath = window.location.pathname + window.location.search) => `/auth/login?return=${encodeURIComponent(returnPath)}`;

  return <Ctx.Provider value={{ me, config, ready, refresh, logout, loginUrl }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
