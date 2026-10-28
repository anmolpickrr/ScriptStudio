import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { JobSummary } from "../types";
import { hostOf, Icon, Kbd, StatusBadge } from "./ui";

type Item = { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void; job?: JobSummary };

/** ⌘K / Ctrl+K: jump to any page or script, or start a new one, without leaving the keyboard. */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setI(0);
    setTimeout(() => input.current?.focus(), 20);
    api.get<JobSummary[]>("/api/jobs").then(setJobs).catch(() => {});
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => { onClose(); nav(to); };
    const pages: Item[] = [
      { id: "new", group: "Actions", label: "New script", hint: "Start from a product link", icon: <Icon.plus />, run: go("/new") },
      { id: "home", group: "Go to", label: "Studio", icon: <Icon.home />, run: go("/") },
      { id: "scripts", group: "Go to", label: "My scripts", icon: <Icon.doc />, run: go("/scripts") },
      { id: "library", group: "Go to", label: "House library", icon: <Icon.star />, run: go("/library") },
      { id: "format", group: "Go to", label: "House format", icon: <Icon.layout />, run: go("/format") },
    ];
    const scripts: Item[] = jobs.slice(0, 30).map((j) => ({
      id: j.id, group: "Scripts", label: j.title || "Untitled (in progress)", hint: `${j.brand || hostOf(j.product_url)} · ${j.platform} · ${j.duration_sec}s`,
      icon: <Icon.film />, run: go(`/scripts/${j.id}`), job: j,
    }));
    const needle = q.trim().toLowerCase();
    const all = [...pages, ...scripts];
    return needle ? all.filter((x) => `${x.label} ${x.hint || ""}`.toLowerCase().includes(needle)) : all.slice(0, 12);
  }, [jobs, q, nav, onClose]);

  useEffect(() => { setI(0); }, [q]);
  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[i]?.run(); }
    else if (e.key === "Escape") onClose();
  };
  let last = "";
  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="palette-search"><Icon.search />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scripts or jump to…" aria-label="Search" />
          <Kbd>Esc</Kbd>
        </div>
        <div className="palette-list" role="listbox">
          {items.length === 0 && <div className="palette-empty">Nothing matches “{q}”.</div>}
          {items.map((x, n) => {
            const head = x.group !== last ? <div className="palette-group">{(last = x.group)}</div> : null;
            return (
              <div key={x.id}>
                {head}
                <button role="option" aria-selected={n === i} className={n === i ? "on" : ""} onMouseEnter={() => setI(n)} onClick={x.run}>
                  <span className="palette-ic">{x.icon}</span>
                  <span className="grow"><b>{x.label}</b>{x.hint && <small>{x.hint}</small>}</span>
                  {x.job ? <StatusBadge status={x.job.status} /> : n === i ? <Icon.arrow /> : null}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span></div>
      </div>
    </div>
  );
}
