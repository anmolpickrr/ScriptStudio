import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
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

export function SessionProvider({ children }: { children: (s: Session | null, error: string) => ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<AppConfig>("/api/config").then((c) => { setConfig(c); setUser(c.user); })
      .catch((e) => setError(e.message));
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
    window.google?.accounts?.id?.disableAutoSelect?.();
    setUser(null);
  }, []);

  const session = config ? { config, user, options, setUser, signOut } : null;
  return <Ctx.Provider value={session}>{children(session, error)}</Ctx.Provider>;
}
