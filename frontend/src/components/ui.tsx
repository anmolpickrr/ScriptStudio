import { Link } from "react-router-dom";
import { Component, createContext, ErrorInfo, KeyboardEvent, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Engine, JobStatus } from "../types";
import logoUrl from "../assets/logo.svg";

export const ENGINE_NAME: Record<Engine, string> = { auto: "ScriptStudio AI", chatgpt: "ChatGPT", claude: "Claude" };
export const ENGINE_URL: Record<Engine, string> = { auto: "", chatgpt: "https://chatgpt.com/", claude: "https://claude.ai/new" };

// ---------------------------------------------------------------- toasts
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; kind: "info" | "error" | "ok"; text: string; action?: ToastAction };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"], action?: ToastAction) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const drop = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((text: string, kind: Toast["kind"] = "info", action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, text, action }]);
    setTimeout(() => drop(id), action ? 6000 : kind === "error" ? 7000 : 4000);
  }, [drop]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind} ${t.action ? "has-action" : ""}`}>
            <span className="toast-ic" aria-hidden="true">{t.kind === "ok" ? "✓" : t.kind === "error" ? "!" : "i"}</span>
            <span className="grow">{t.text}</span>
            {t.action && <button className="toast-action" onClick={() => { t.action!.onClick(); drop(t.id); }}>{t.action.label}</button>}
            {t.action && <i className="toast-timer" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- modal
export function Modal({ title, children, onClose, actions }: {
  title: string; children: ReactNode; onClose: () => void; actions: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dropdown menu
export function Menu({ trigger, children }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && <div className="menu" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- status badge
const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued", running: "Writing", ready: "Ready", needs_review: "Needs review", failed: "Failed", approved: "Approved",
  awaiting_input: "Waiting for your chat",
};
export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${status}`}><span className="dot" />{STATUS_LABEL[status]}</span>;
}

// ---------------------------------------------------------------- tag input
export function TagInput({ value, onChange, placeholder, max = 15, id }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number; id?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(/\n/).map((v) => v.trim()).filter(Boolean);
    const next = [...value];
    for (const v of parts) if (!next.includes(v) && next.length < max) next.push(v);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="chips">
      {value.map((v) => (
        <span key={v} className="chip"><span title={v}>{v}</span>
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
        </span>
      ))}
      {value.length < max && (
        <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add}
               placeholder={value.length ? "Add another…" : placeholder} maxLength={300} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- misc
export function Spinner({ label = "Loading" }: { label?: string }) { return <span className="spinner" role="status" aria-label={label} />; }

export function Skeleton({ h = 16, w = "100%", style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="sk" style={{ height: h, width: w, ...style }} />;
}

export function BrandMark({ small }: { small?: boolean }) {
  return (
    <Link className={`brand ${small ? "small" : ""}`} to="/" aria-label="ScriptStudio by fastrr — home">
      <img src={logoUrl} alt="ScriptStudio by fastrr" />
    </Link>
  );
}

export function PageSkeleton() {
  return (
    <div className="stack" aria-busy="true">
      <Skeleton h={28} w={260} />
      <Skeleton h={14} w={380} />
      <div className="card stack"><Skeleton h={16} w="40%" /><Skeleton h={40} /><Skeleton h={40} /><Skeleton h={90} /></div>
    </div>
  );
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const label = (k: string) => (k === "pov" ? "POV" : k.replace(/_/g, " "));

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ---------------------------------------------------------------- error boundary
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center">
        <div className="card empty" style={{ maxWidth: 440 }}>
          <div className="art gl lg bad"><Icon.alert /></div>
          <h2>Something went wrong on this page</h2>
          <p>Your work is saved. Reload to continue.</p>
          <button className="btn" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

// ---------------------------------------------------------------- icons (inline, no dependency)
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  home: () => <svg viewBox="0 0 24 24" {...P}><path d="m3 11 9-7 9 7" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>,
  plus: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>,
  doc: () => <svg viewBox="0 0 24 24" {...P}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>,
  star: () => <svg viewBox="0 0 24 24" {...P}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>,
  layout: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>,
  menu: () => <svg viewBox="0 0 24 24" {...P} width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  more: () => <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>,
  copy: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  ext: () => <svg viewBox="0 0 24 24" {...P} width="15" height="15"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>,
  spark: () => <svg viewBox="0 0 24 24" {...P} width="15" height="15"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>,
  upload: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>,
  search: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  back: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M15 18l-6-6 6-6" /></svg>,
  board: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="17" y="4" width="4" height="13" rx="1.5" /></svg>,
  list: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>,
  check: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M20 6 9 17l-5-5" /></svg>,
  film: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></svg>,
  flag: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 21V4h11l-1.5 4L16 12H5" /></svg>,
  user: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
  save: () => <svg viewBox="0 0 24 24" {...P} width="17" height="17"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></svg>,
  trash: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  edit: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>,
  arrow: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  down: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m6 9 6 6 6-6" /></svg>,
  link: () => <svg viewBox="0 0 24 24" {...P} width="18" height="18"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></svg>,
  pen: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>,
  shield: () => <svg viewBox="0 0 24 24" {...P} width="18" height="18"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>,
  share: () => <svg viewBox="0 0 24 24" {...P} width="18" height="18"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>,
  alert: () => <svg viewBox="0 0 24 24" {...P} width="18" height="18"><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>,
  info: () => <svg viewBox="0 0 24 24" {...P} width="18" height="18"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>,
  clock: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  frame: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16" /></svg>,
};

// ---------------------------------------------------------------- media query hook
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on(); m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** A stable colour per brand, so the same client always looks the same across the app. */
export function hueOf(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Monogram({ text, size = 34 }: { text: string; size?: number }) {
  const h = hueOf(text || "S");
  return (
    <span className="mono" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.42,
      background: `linear-gradient(135deg, hsl(${h} 70% 62%), hsl(${(h + 40) % 360} 75% 48%))` }}>
      {(text || "S").replace(/^www\./, "")[0]?.toUpperCase()}
    </span>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// ---------------------------------------------------------------- India time
const IST = "Asia/Kolkata";
export function istHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: IST }).format(d));
}
export function greetingIST(d = new Date()): string {
  const h = istHour(d);
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : "Good evening";
}
export function istStamp(d = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: IST }).format(d) + " IST";
}
/** Re-renders every minute, so time-based text (greeting, "x min ago") stays current. */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  return now;
}

// ---------------------------------------------------------------- platforms: icon + frame shape
type PlatformKind = "ig" | "tiktok" | "yt" | "ytl" | "meta" | "tv";
export function platformKind(p: string): PlatformKind {
  const s = p.toLowerCase();
  if (s.includes("tiktok")) return "tiktok";
  if (s.includes("short")) return "yt";
  if (s.includes("youtube")) return "ytl";
  if (s.includes("meta") || s.includes("facebook")) return "meta";
  if (s.includes("tv")) return "tv";
  return "ig";
}
const ASPECT: Record<PlatformKind, string> = { ig: "9 / 16", tiktok: "9 / 16", yt: "9 / 16", ytl: "16 / 9", meta: "4 / 5", tv: "16 / 9" };
export function PlatformIcon({ p, size = 15 }: { p: string; size?: number }) {
  const k = platformKind(p);
  const a = { ...P, width: size, height: size, viewBox: "0 0 24 24" };
  if (k === "ig") return <svg {...a}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r=".6" fill="currentColor" /></svg>;
  if (k === "tiktok") return <svg {...a}><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" /><path d="M14 3c.5 2.6 2.4 4.4 5 4.6" /></svg>;
  if (k === "yt" || k === "ytl") return <svg {...a}><rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" /></svg>;
  if (k === "meta") return <svg {...a}><path d="M3 15c0-4 2-7 4-7 3 0 5 8 8 8 2 0 3-2 3-4.5S17 7 15.5 7C12 7 10 16 7 16c-2 0-4-1-4-1z" /></svg>;
  return <svg {...a}><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
}

/** A tiny "poster" of the ad: the platform's frame shape in the brand's colour, with platform and length. */
export function Poster({ brand, platform, seconds, height = 96 }: { brand: string; platform: string; seconds: number; height?: number }) {
  const h = hueOf(brand || "S");
  const k = platformKind(platform);
  const wide = k === "ytl" || k === "tv";
  return (
    <span className={`poster ${wide ? "wide" : ""}`} aria-hidden="true" style={{ height: wide ? height * 0.62 : height, aspectRatio: ASPECT[k],
      background: `radial-gradient(120% 80% at 20% 0%, hsl(${h} 85% 66% / .95), transparent 60%), linear-gradient(160deg, hsl(${(h + 30) % 360} 70% 38%), hsl(${(h + 300) % 360} 60% 14%))` }}>
      <span className="poster-p"><PlatformIcon p={platform} size={12} /></span>
      <b className="poster-l">{(brand || "S").replace(/^www\./, "")[0]?.toUpperCase()}</b>
      <span className="poster-d">{seconds}s</span>
      <i className="poster-bar" />
    </span>
  );
}
