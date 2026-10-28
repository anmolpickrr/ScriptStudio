import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, clearSession } from "./api";
import type { AppConfig, Options, User } from "./types";

interface Session {
  config: AppConfig;
  user: User | null;
  options: Options | null;
  setUser: (u: User | null) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => useContext(Ctx)!;

export function SessionProvider({ children }: { children: (s: Session | null, error: string, waking: boolean) => ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [waking, setWaking] = useState(false);

  // The free server sleeps when idle and takes up to a minute to wake, so be patient on first load.
  useEffect(() => {
    let alive = true;
    const slow = setTimeout(() => alive && setWaking(true), 3500);
    (async () => {
      for (let attempt = 0; attempt < 4 && alive; attempt++) {
        try {
          const c = await api.get<AppConfig>("/api/config", 75_000);
          if (alive) { setConfig(c); setUser(c.user); }
          return;
        } catch (e) {
          if (attempt === 3 && alive) setError((e as Error).message);
          else await new Promise((r) => setTimeout(r, 4000));
        }
      }
    })().finally(() => clearTimeout(slow));
    return () => { alive = false; clearTimeout(slow); };
  }, []);

  useEffect(() => {
    if (!user) { setOptions(null); return; }
    api.get<Options>("/api/options").then(setOptions).catch((e) => setError(e.message));
  }, [user]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("sw:unauthorized", onUnauthorized);
    return () => window.removeEventListener("sw:unauthorized", onUnauthorized);
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    clearSession();
    window.google?.accounts?.id?.disableAutoSelect?.();
    setUser(null);
  }, []);

  const session = config ? { config, user, options, setUser, signOut } : null;
  return <Ctx.Provider value={session}>{children(session, error, waking)}</Ctx.Provider>;
}
