import { Link } from "react-router-dom";
import { Component, createContext, ErrorInfo, KeyboardEvent, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Engine, JobStatus } from "../types";

export const ENGINE_NAME: Record<Engine, string> = { auto: "ScriptStudio AI", chatgpt: "ChatGPT", claude: "Claude" };
export const ENGINE_URL: Record<Engine, string> = { auto: "", chatgpt: "https://chatgpt.com/", claude: "https://claude.ai/new" };

// ---------------------------------------------------------------- toasts
type Toast = { id: number; kind: "info" | "error" | "ok"; text: string };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
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
    <Link className="brand" to="/new" aria-label="ScriptStudio by Fastrr">
      <span className="mark" aria-hidden="true"><i /><i /></span>
      <span className="word">ScriptStudio{!small && <small>by Fastrr</small>}</span>
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
          <div className="art">⚠️</div>
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
  plus: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>,
  doc: () => <svg viewBox="0 0 24 24" {...P}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>,
  star: () => <svg viewBox="0 0 24 24" {...P}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>,
  layout: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>,
  menu: () => <svg viewBox="0 0 24 24" {...P} width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  more: () => <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>,
  copy: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  ext: () => <svg viewBox="0 0 24 24" {...P} width="15" height="15"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>,
  spark: () => <svg viewBox="0 0 24 24" {...P} width="15" height="15"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>,
  down: () => <svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m6 9 6 6 6-6" /></svg>,
};
