import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { renderSignInButton } from "../google";
import { useSession } from "../session";
import type { User } from "../types";

export default function SignIn() {
  const { config, setUser } = useSession();
  const btn = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!btn.current || !config.google_client_id) return;
    renderSignInButton(btn.current, config.google_client_id, async (credential) => {
      setBusy(true); setError("");
      try { setUser(await api.post<User>("/api/auth/google", { credential })); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }).catch((e) => setError(e.message));
  }, [config.google_client_id, setUser]);

  return (
    <div className="signin">
      <div className="card">
        <img src="/favicon.svg" alt="" width={44} height={44} />
        <h1 style={{ marginTop: 12 }}>Scriptwright</h1>
        <p className="muted">Production-ready video scripts from a product link and a client brief.</p>
        <ul>
          <li>Every product claim checked against the product page</li>
          <li>Scene-by-scene visuals and VO, timed and in sync</li>
          <li>Automated editorial review before you see it</li>
          <li>One click to a formatted Google Doc</li>
        </ul>
        <div style={{ display: "flex", justifyContent: "center", minHeight: 44 }} ref={btn} />
        {busy && <p className="muted small">Signing you in…</p>}
        {error && <p className="err">{error}</p>}
        {!config.google_client_id && <p className="err">Sign-in isn't configured (GOOGLE_CLIENT_ID missing).</p>}
      </div>
    </div>
  );
}
