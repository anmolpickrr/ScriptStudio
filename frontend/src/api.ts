export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Empty when the API serves this page; set at build time for the GitHub Pages copy (a different origin).
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined || "").replace(/\/$/, "");
const TOKEN_KEY = "ss:session";
let memoryToken = "";

// Cross-origin requests can't rely on cookies, so the session also travels in a header.
function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || memoryToken; } catch { return memoryToken; }
}
function setToken(t: string) {
  memoryToken = t;
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}
export const clearSession = () => setToken("");

async function send(method: string, path: string, body?: unknown, timeoutMs = 90_000, keepalive = false): Promise<Response> {
  const token = getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, {
      method,
      credentials: API_BASE ? "omit" : "same-origin",
      signal: ctrl.signal,
      keepalive,
      headers: {
        "X-Requested-With": "scriptwright", // required by the API's CSRF guard
        ...(token ? { "X-Session-Token": token } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const fresh = res.headers.get("X-Session-Token");
    if (fresh) setToken(fresh);
    return res;
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs?: number, keepalive?: boolean): Promise<T> {
  const res = await send(method, path, body, timeoutMs, keepalive);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    const msg = typeof detail === "string" ? detail : `Request failed (${res.status})`;
    if (res.status === 401) window.dispatchEvent(new Event("sw:unauthorized"));
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, timeoutMs?: number) => request<T>("GET", path, undefined, timeoutMs),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string, keepalive = false) => request<T>("DELETE", path, undefined, undefined, keepalive),
  /** Raw text (e.g. the rendered script preview). */
  text: async (path: string) => {
    const res = await send("GET", path);
    if (!res.ok) throw new ApiError(res.status, `Couldn't load (${res.status})`);
    return res.text();
  },
  /** Downloads a file through fetch so the session header is sent, then saves it. */
  download: async (path: string, fallbackName: string) => {
    const res = await send("GET", path);
    if (!res.ok) throw new ApiError(res.status, "The download failed. Please try again.");
    const cd = res.headers.get("Content-Disposition") || "";
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name ? decodeURIComponent(name) : fallbackName });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
