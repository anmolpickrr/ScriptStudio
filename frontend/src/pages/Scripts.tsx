import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { saveDraft } from "../brief";
import { DraftCard, JobCard, useJobActions, useJobDelete } from "../components/Cards";
import { hostOf, Icon, Menu, Monogram, Skeleton, StatusBadge, timeAgo, useMedia, useToast } from "../components/ui";
import { Draft, listDrafts } from "../drafts";
import type { JobStatus, JobSummary } from "../types";

const COLUMNS: { key: string; label: string; hint: string; empty: string; icon: keyof typeof Icon; tone: string; match: (s: JobStatus) => boolean }[] = [
  { key: "active", tone: "violet", label: "In progress", hint: "Writing, or waiting for your chat", icon: "pen", empty: "Scripts being written appear here, with live progress.", match: (s) => s === "queued" || s === "running" || s === "awaiting_input" },
  { key: "review", tone: "warn", label: "Needs review", hint: "Flags or quality notes to check", icon: "search", empty: "All clear. Nothing waiting for your review.", match: (s) => s === "needs_review" || s === "failed" },
  { key: "ready", tone: "lime", label: "Ready", hint: "Passed every quality gate", icon: "check", empty: "Scripts that pass every quality gate land here.", match: (s) => s === "ready" },
  { key: "approved", tone: "ok", label: "Approved", hint: "In the house library", icon: "star", empty: "Approve a script to add it to the house library.", match: (s) => s === "approved" },
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
  const [tab, setTab] = useState("all");
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
  const mode = narrow ? "board" : view;

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
        <div className="reel">{[0, 1, 2].map((i) => <Skeleton key={i} h={118} />)}</div>
      ) : jobs.length === 0 && drafts.length === 0 ? (
        <div className="card empty"><div className="art gl lg"><Icon.pen /></div><h2>No scripts yet</h2>
          <p>Paste a product link and a brief to get your first ready-to-shoot script.</p>
          <Link className="btn primary" to="/">Write your first script</Link></div>
      ) : (
        <>
          <div className="toolbar">
            <label className="search"><Icon.search />
              <input type="search" placeholder="Search by title, brand or platform…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search scripts" />
            </label>
            {mode === "board" && (
              <div className="desk-pills grp-tabs" role="tablist" aria-label="Filter by status">
                {[{ key: "all", label: "All", tone: "", n: shown.length + shownDrafts.length },
                  { key: "drafts", label: "Drafts", tone: "draft", n: shownDrafts.length },
                  ...COLUMNS.map((c) => ({ key: c.key, label: c.label, tone: c.tone, n: shown.filter((j) => c.match(j.status)).length }))]
                  .filter((t) => t.key === "all" || t.key === tab || t.n > 0).map((t) => (
                  <button key={t.key} role="tab" aria-selected={tab === t.key} className={`desk-pill ${t.tone} ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>
                    {t.key !== "all" && <i className="pill-dot" />}{t.label}<b>{t.n}</b></button>))}
              </div>
            )}
            {mode === "list" && shown.length > 0 && (
              <button className={`btn sm ${selecting ? "secondary" : "ghost"}`} onClick={() => (selecting ? endSelect() : setSelecting(true))}>
                <Icon.check /> {selecting ? "Done" : "Select"}</button>
            )}
            {!narrow && (
              <div className="seg-mini" role="radiogroup" aria-label="View">
                <button role="radio" aria-checked={view === "board"} className={view === "board" ? "on" : ""} onClick={() => pickView("board")}><Icon.board /> Cards</button>
                <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => pickView("list")}><Icon.list /> List</button>
              </div>
            )}
          </div>

          {shown.length + shownDrafts.length === 0 ? <div className="card empty slim"><p>No scripts match “{q}”.</p></div> : mode === "board" ? (
            tab === "all" ? (
              <div className="reel">
                {shownDrafts.map((d, n) => <DraftCard key={d.id} draft={d} delay={n * 30} />)}
                {shown.map((j, n) => <JobCard key={j.id} job={j} delay={Math.min(n + shownDrafts.length, 12) * 30} onDelete={(id) => remove([id])} />)}
              </div>
            ) : <div className="groups">
              {[{ key: "drafts", label: "Drafts", hint: "Saved briefs, not written yet", tone: "draft", n: shownDrafts.length },
                ...COLUMNS.map((c) => ({ key: c.key, label: c.label, hint: c.hint, tone: c.tone, n: shown.filter((j) => c.match(j.status)).length }))]
                .filter((g) => g.n > 0 && (tab === "all" || tab === g.key)).map((g) => (
                <section key={g.key} className={`grp ${g.tone}`} aria-label={g.label}>
                  <header className="grp-h"><i className="pill-dot" /><b>{g.label}</b><span className="col-n">{g.n}</span><small>{g.hint}</small></header>
                  <div className="reel">
                    {g.key === "drafts"
                      ? shownDrafts.map((d, n) => <DraftCard key={d.id} draft={d} delay={n * 30} />)
                      : shown.filter((j) => COLUMNS.find((c) => c.key === g.key)!.match(j.status)).map((j, n) => (
                        <JobCard key={j.id} job={j} delay={n * 30} onDelete={(id) => remove([id])} />))}
                  </div>
                </section>
              ))}
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
                  <span className="grow"><b>{j.title || `Script for ${j.brand || hostOf(j.product_url)}`}</b><small>{j.brand || hostOf(j.product_url)} · {j.platform} · {j.duration_sec}s</small></span>
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
