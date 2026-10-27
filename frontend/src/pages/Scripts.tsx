import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { hostOf, Skeleton, StatusBadge, timeAgo, useToast } from "../components/ui";
import type { JobStatus, JobSummary } from "../types";

const FILTERS: { key: string; label: string; match: (s: JobStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "active", label: "In progress", match: (s) => s === "queued" || s === "running" },
  { key: "review", label: "Needs review", match: (s) => s === "needs_review" || s === "failed" },
  { key: "ready", label: "Ready", match: (s) => s === "ready" },
  { key: "approved", label: "Approved", match: (s) => s === "approved" },
];

export default function Scripts() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const load = () => api.get<JobSummary[]>("/api/jobs").then((j) => alive && setJobs(j)).catch((e) => alive && toast(e.message, "error"));
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [toast]);

  const f = FILTERS.find((x) => x.key === filter)!;
  const shown = (jobs || []).filter((j) => f.match(j.status) &&
    `${j.title} ${j.brand} ${j.product_url} ${j.platform}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>My scripts</h1><p>Everything you've generated, newest first.</p></div>
        <Link className="btn" to="/new">+ New script</Link>
      </div>
      {jobs === null ? (
        <div className="card stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={44} />)}</div>
      ) : jobs.length === 0 ? (
        <div className="card empty"><div className="art">✍️</div><h2>No scripts yet</h2>
          <p>Paste a product link and a client brief to get your first production-ready script.</p>
          <Link className="btn" to="/new">Create a script</Link></div>
      ) : (
        <>
          <div className="filters">
            <input type="search" placeholder="Search scripts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search scripts" />
            <div className="options">
              {FILTERS.map((x) => {
                const n = jobs.filter((j) => x.match(j.status)).length;
                return <button key={x.key} className={`opt sm ${filter === x.key ? "on" : ""}`} onClick={() => setFilter(x.key)}>{x.label} {n > 0 && <span className="muted" style={{ color: "inherit", opacity: .7 }}>· {n}</span>}</button>;
              })}
            </div>
          </div>
          {shown.length === 0 ? <div className="card empty"><p>No scripts match.</p></div> : (
            <>
              <table className="list">
                <thead><tr><th>Script</th><th>Platform</th><th>Status</th><th>Updated</th></tr></thead>
                <tbody>
                  {shown.map((j) => (
                    <tr key={j.id} className="click" onClick={() => nav(`/scripts/${j.id}`)}>
                      <td><Link to={`/scripts/${j.id}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}><b>{j.title || "Untitled (in progress)"}</b></Link>
                        <div className="muted small">{j.brand || hostOf(j.product_url)}</div></td>
                      <td className="nowrap">{j.platform} · {j.duration_sec}s</td>
                      <td><StatusBadge status={j.status} /></td>
                      <td className="muted nowrap">{timeAgo(j.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="list-cards">
                {shown.map((j) => (
                  <Link key={j.id} to={`/scripts/${j.id}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                      <b style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title || "Untitled (in progress)"}</b>
                      <StatusBadge status={j.status} />
                    </div>
                    <div className="muted small" style={{ marginTop: 4 }}>{j.brand || hostOf(j.product_url)} · {j.platform} · {j.duration_sec}s · {timeAgo(j.updated_at)}</div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
