import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { saveDraft } from "../brief";
import { DraftCard, JobCard, useJobActions, useJobDelete } from "../components/Cards";
import { hostOf, Icon, Menu, Monogram, Skeleton, StatusBadge, timeAgo, useMedia, useToast } from "../components/ui";
import { Draft, listDrafts } from "../drafts";
import type { JobStatus, JobSummary } from "../types";

const COLUMNS: { key: string; label: string; hint: string; empty: string; icon: string; match: (s: JobStatus) => boolean }[] = [
  { key: "active", label: "In progress", hint: "Writing, or waiting for your chat", icon: "✍️", empty: "Scripts being written appear here, with live progress.", match: (s) => s === "queued" || s === "running" || s === "awaiting_input" },
  { key: "review", label: "Needs review", hint: "Flags or quality notes to check", icon: "🔎", empty: "All clear — nothing waiting for your review.", match: (s) => s === "needs_review" || s === "failed" },
  { key: "ready", label: "Ready", hint: "Passed every quality gate", icon: "✅", empty: "Scripts that pass every quality gate land here.", match: (s) => s === "ready" },
  { key: "approved", label: "Approved", hint: "In the house library", icon: "⭐", empty: "Approve a script to add it to the house library.", match: (s) => s === "approved" },
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
  const acts = useJobActions();
  const { hidden, remove } = useJobDelete();
  const [drafts, setDrafts] = useState<Draft[]>(listDrafts);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    const on = () => setDrafts(listDrafts());
    window.addEventListener("ss:drafts", on);
    return () => window.removeEventListener("ss:drafts", on);
  }, []);
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const endSelect = () => { setSelecting(false); setSel(new Set()); };

  useEffect(() => {
    let alive = true;
    const load = () => api.get<JobSummary[]>("/api/jobs").then((j) => alive && setJobs(j)).catch((e) => alive && toast(e.message, "error"));
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [toast]);

  const openDraftRow = (d: Draft) => { saveDraft(d.inputs); nav("/new", { state: { draftId: d.id } }); };
  const pickView = (v: "board" | "list") => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };
  const needle = q.toLowerCase();
  const shown = (jobs || []).filter((j) => !hidden.has(j.id) && `${j.title} ${j.brand} ${j.product_url} ${j.platform}`.toLowerCase().includes(needle));
  const shownDrafts = drafts.filter((d) => `${d.name} ${d.inputs.product_url}`.toLowerCase().includes(needle));
  const mode = narrow ? "list" : view;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow"><Icon.film /> Your scripts</div>
          <h1 className="display-sm">Scripts</h1>
          <p>{jobs === null ? "Everything you've written, by where it is in the process."
            : <>{shown.length} script{shown.length === 1 ? "" : "s"}{drafts.length ? <> · {drafts.length} draft{drafts.length === 1 ? "" : "s"}</> : null}
              {(() => { const r = shown.filter((j) => j.status === "needs_review" || j.status === "failed").length; return r ? <> · <span className="warn-text">{r} need{r === 1 ? "s" : ""} your review</span></> : null; })()}</>}</p>
        </div>
      </div>

      {jobs === null ? (
        <div className="board">{COLUMNS.map((c) => <div key={c.key} className="col"><Skeleton h={18} w="50%" /><Skeleton h={110} /><Skeleton h={110} /></div>)}</div>
      ) : jobs.length === 0 && drafts.length === 0 ? (
        <div className="card empty"><div className="art">✍️</div><h2>No scripts yet</h2>
          <p>Paste a product link and a brief to get your first ready-to-shoot script.</p>
          <Link className="btn primary" to="/">Write your first script</Link></div>
      ) : (
        <>
          <div className="toolbar">
            <label className="search"><Icon.search />
              <input type="search" placeholder="Search by title, brand or platform…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search scripts" />
            </label>
            {mode === "list" && shown.length > 0 && (
              <button className={`btn sm ${selecting ? "secondary" : "ghost"}`} onClick={() => (selecting ? endSelect() : setSelecting(true))}>
                <Icon.check /> {selecting ? "Done" : "Select"}</button>
            )}
            {!narrow && (
              <div className="seg-mini" role="radiogroup" aria-label="View">
                <button role="radio" aria-checked={view === "board"} className={view === "board" ? "on" : ""} onClick={() => pickView("board")}><Icon.board /> Board</button>
                <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => pickView("list")}><Icon.list /> List</button>
              </div>
            )}
          </div>

          {shown.length + shownDrafts.length === 0 ? <div className="card empty slim"><p>No scripts match “{q}”.</p></div> : mode === "board" ? (
            <div className={`board ${shownDrafts.length ? "with-drafts" : ""}`}>
              {shownDrafts.length > 0 && (
                <section className="col drafts" aria-label="Drafts">
                  <header><b>Drafts</b><span className="col-n">{shownDrafts.length}</span></header>
                  <p className="col-hint">Saved briefs, not written yet</p>
                  {shownDrafts.map((d, n) => <DraftCard key={d.id} draft={d} variant="tile" delay={n * 40} />)}
                </section>
              )}
              {COLUMNS.map((c) => {
                const items = shown.filter((j) => c.match(j.status));
                return (
                  <section key={c.key} className={`col ${c.key}`} aria-label={c.label}>
                    <header><b>{c.label}</b><span className="col-n">{items.length}</span></header>
                    <p className="col-hint">{c.hint}</p>
                    {items.length === 0 ? <div className="col-empty"><span>{c.icon}</span>{c.empty}</div> : items.map((j, n) => (
                      <JobCard key={j.id} job={j} variant="tile" delay={n * 40} onDelete={(id) => remove([id])} />
                    ))}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="rows">
              {shownDrafts.map((d) => (
                <div key={d.id} className="rowcard draft-row" onClick={() => openDraftRow(d)} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openDraftRow(d)}>
                  <span className="draft-ic" aria-hidden="true"><Icon.doc /></span>
                  <span className="grow"><b>{d.name}</b><small>{d.inputs.product_url ? hostOf(d.inputs.product_url) : "No product link yet"} · saved {timeAgo(d.updated_at)}</small></span>
                  <span className="badge draft">Draft</span>
                </div>
              ))}
              {shown.map((j, n) => (
                <div key={j.id} className={`rowcard ${selecting && sel.has(j.id) ? "selected" : ""}`} style={{ animationDelay: `${Math.min(n, 12) * 30}ms` }}
                     role={selecting ? "checkbox" : "link"} aria-checked={selecting ? sel.has(j.id) : undefined} tabIndex={0}
                     onClick={() => (selecting ? toggle(j.id) : nav(`/scripts/${j.id}`))}
                     onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (selecting) toggle(j.id); else nav(`/scripts/${j.id}`); } }}>
                  {selecting ? <span className={`check ${sel.has(j.id) ? "on" : ""}`} aria-hidden="true"><Icon.check /></span> : <Monogram text={j.brand || hostOf(j.product_url)} size={36} />}
                  <span className="grow"><b>{j.title || "Untitled (in progress)"}</b><small>{j.brand || hostOf(j.product_url)} · {j.platform} · {j.duration_sec}s</small></span>
                  <StatusBadge status={j.status} />
                  <span className="muted small nowrap rowcard-time">{timeAgo(j.updated_at)}</span>
                  {!selecting && (
                    <span className="card-tools" onClick={(e) => e.stopPropagation()}>
                      <Menu trigger={(t) => <button className="icon-btn" aria-label="Script actions" onClick={t}><Icon.more /></button>}>
                        {(close) => (<>
                          <button onClick={() => { close(); nav(`/scripts/${j.id}`); }}>Open</button>
                          <button onClick={() => { close(); acts.editAsNew(j.id); }}>Edit &amp; regenerate</button>
                          <button onClick={() => { close(); acts.duplicate(j.id); }}>Duplicate as draft</button>
                          <button className="danger" onClick={() => { close(); remove([j.id]); }}>Delete</button>
                        </>)}
                      </Menu>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {selecting && (
            <div className="bulk-bar" role="toolbar" aria-label="Selected scripts">
              <b>{sel.size}</b> selected
              <button className="btn ghost sm" onClick={() => setSel(new Set(shown.map((j) => j.id)))}>Select all</button>
              <button className="btn ghost sm" onClick={() => setSel(new Set())} disabled={!sel.size}>Clear</button>
              <button className="btn danger sm" disabled={!sel.size} onClick={() => { remove([...sel]); endSelect(); }}><Icon.trash /> Delete</button>
              <button className="btn sm" onClick={endSelect}>Done</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
