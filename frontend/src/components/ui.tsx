import { createContext, ReactNode, useCallback, useContext, useState, KeyboardEvent } from "react";
import type { JobStatus } from "../types";

// ---------------------------------------------------------------- toasts
type Toast = { id: number; kind: "info" | "error" | "ok"; text: string };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, kind, text }]);
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

// ---------------------------------------------------------------- status badge
const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued", running: "Generating", ready: "Ready", needs_review: "Needs review", failed: "Failed", approved: "Approved",
};
export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${status}`}><span className="dot" />{STATUS_LABEL[status]}</span>;
}

// ---------------------------------------------------------------- tag input
export function TagInput({ value, onChange, placeholder, max = 15 }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v) && value.length < max) onChange([...value, v]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="chips">
      {value.map((v) => (
        <span key={v} className="chip">{v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
        </span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add}
             placeholder={value.length ? "" : placeholder} maxLength={300} />
    </div>
  );
}

export function Spinner() { return <span className="spinner" aria-label="Loading" />; }

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const label = (k: string) => (k === "pov" ? "POV" : k.replace(/_/g, " "));
