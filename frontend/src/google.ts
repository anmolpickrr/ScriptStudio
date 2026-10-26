// Google Identity Services: sign-in button (ID token) and Drive access token for Docs export.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { google?: any } }

let loader: Promise<void> | null = null;

export function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  loader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loader = null; reject(new Error("Couldn't load Google sign-in. Check your connection or ad blocker.")); };
    document.head.appendChild(s);
  });
  return loader;
}

export async function renderSignInButton(el: HTMLElement, clientId: string, onCredential: (c: string) => void) {
  await loadGis();
  window.google.accounts.id.initialize({ client_id: clientId, callback: (r: any) => onCredential(r.credential),
    ux_mode: "popup", auto_select: false });
  window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 280 });
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
let cached: { token: string; exp: number } | null = null;

/** Asks the user (popup, first time only) for permission to create files in their Drive. */
export async function getDriveToken(clientId: string, hint?: string): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: DRIVE_SCOPE, hint, prompt: "",
      callback: (r: any) => {
        if (r.error || !r.access_token) return reject(new Error("Google Drive permission wasn't granted."));
        cached = { token: r.access_token, exp: Date.now() + Number(r.expires_in || 3000) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e: any) => reject(new Error(e?.type === "popup_closed" ? "The Google window was closed." :
        "Couldn't open the Google permission window. Allow pop-ups for this site.")),
    });
    client.requestAccessToken();
  });
}
