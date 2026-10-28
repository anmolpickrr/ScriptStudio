import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { hostOf, Icon, Monogram, Skeleton, StatusBadge, timeAgo, useMedia, useToast } from "../components/ui";
import type { JobStatus, JobSummary } from "../types";

const COLUMNS: { key: string; label: string; hint: string; match: (s: JobStatus) => boolean }[] = [
  { key: "active", label: "In progress", hint: "Writing, or waiting for your chat", match: (s) => s === "queued" || s === "running" || s === "awaiting_input" },
  { key: "review", label: "Needs review", hint: "Flags or quality notes to check", match: (s) => s === "needs_review" || s === "failed" },
  { key: "ready", label: "Ready", hint: "Passed every quality gate", match: (s) => s === "ready" },
  { key: "approved", label: "Approved", hint: "In the house library", match: (s) => s === "approved" },
];
const VIEW_KEY = "ss:scripts-view";

export default function Scripts() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"board" | "list">(() => {
    try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board"; } catch { return "board"; }
  });
  const narrow = useMedia("(max-width: 900px)");
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const load = () => api.get<JobSummary[]>("/api/jobs").then((j) => alive && setJobs(j)).catch((e) => alive && toast(e.message, "error"));
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [toast]);

  const pickView = (v: "board" | "list") => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };
  const shown = (jobs || []).filter((j) => `${j.title} ${j.brand} ${j.product_url} ${j.platform}`.toLowerCase().includes(q.toLowerCase()));
  const mode = narrow ? "list" : view;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow"><Icon.film /> Your scripts</div>
          <h1 className="display-sm">Scripts</h1>
          <p>Everything you've written, by where it is in the process.</p>
        </div>
        <Link className="btn primary" to="/new"><Icon.plus /> New script</Link>
      </div>

      {jobs === null ? (
        <div className="board">{COLUMNS.map((c) => <div key={c.key} className="col"><Skeleton h={18} w="50%" /><Skeleton h={110} /><Skeleton h={110} /></div>)}</div>
      ) : jobs.length === 0 ? (
        <div className="card empty"><div className="art">✍️</div><h2>No scripts yet</h2>
          <p>Paste a product link and a brief to get your first ready-to-shoot script.</p>
          <Link className="btn primary" to="/">Write your first script</Link></div>
      ) : (
        <>
          <div className="toolbar">
            <label className="search"><Icon.search />
              <input type="search" placeholder="Search by title, brand or platform…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search scripts" />
            </label>
            {!narrow && (
              <div className="seg-mini" role="radiogroup" aria-label="View">
                <button role="radio" aria-checked={view === "board"} className={view === "board" ? "on" : ""} onClick={() => pickView("board")}><Icon.board /> Board</button>
                <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => pickView("list")}><Icon.list /> List</button>
              </div>
            )}
          </div>

          {shown.length === 0 ? <div className="card empty slim"><p>No scripts match “{q}”.</p></div> : mode === "board" ? (
            <div className="board">
              {COLUMNS.map((c) => {
                const items = shown.filter((j) => c.match(j.status));
                return (
                  <section key={c.key} className={`col ${c.key}`} aria-label={c.label}>
                    <header><span className="col-dot" /><b>{c.label}</b><span className="col-n">{items.length}</span></header>
                    <p className="col-hint">{c.hint}</p>
                    {items.length === 0 ? <div className="col-empty">Nothing here</div> : items.map((j, n) => (
                      <Link key={j.id} to={`/scripts/${j.id}`} className="tile" style={{ animationDelay: `${n * 40}ms` }}>
                        <div className="tile-top"><Monogram text={j.brand || hostOf(j.product_url)} size={30} /><span className="tile-brand">{j.brand || hostOf(j.product_url)}</span></div>
                        <b>{j.title || "Untitled (in progress)"}</b>
                        <div className="tile-meta"><span>{j.platform} · {j.duration_sec}s</span><span>{timeAgo(j.updated_at)}</span></div>
                        {c.key === "review" && <StatusBadge status={j.status} />}
                      </Link>
                    ))}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="rows">
              {shown.map((j, n) => (
                <button key={j.id} className="rowcard" style={{ animationDelay: `${Math.min(n, 12) * 30}ms` }} onClick={() => nav(`/scripts/${j.id}`)}>
                  <Monogram text={j.brand || hostOf(j.product_url)} size={36} />
                  <span className="grow"><b>{j.title || "Untitled (in progress)"}</b><small>{j.brand || hostOf(j.product_url)} · {j.platform} · {j.duration_sec}s</small></span>
                  <StatusBadge status={j.status} />
                  <span className="muted small nowrap rowcard-time">{timeAgo(j.updated_at)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
