import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Spinner, StatusBadge, timeAgo, useToast } from "../components/ui";
import type { JobSummary } from "../types";

export default function Scripts() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const load = () => api.get<JobSummary[]>("/api/jobs").then((j) => alive && setJobs(j)).catch((e) => toast(e.message, "error"));
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [toast]);

  if (!jobs) return <div className="center"><Spinner /></div>;
  const shown = jobs.filter((j) => `${j.title} ${j.brand} ${j.product_url} ${j.platform}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Scripts</h1><div className="muted">Everything you've generated.</div></div>
        <input type="text" style={{ width: 240 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Link className="btn" to="/new">＋ New script</Link>
      </div>
      {jobs.length === 0 ? (
        <div className="card empty"><h2>No scripts yet</h2><p>Paste a product link and a brief to get your first script.</p>
          <Link className="btn" to="/new">Create a script</Link></div>
      ) : (
        <table className="list">
          <thead><tr><th>Script</th><th className="hide-sm">Platform</th><th>Status</th><th className="hide-sm">Updated</th></tr></thead>
          <tbody>
            {shown.map((j) => (
              <tr key={j.id} className="click" onClick={() => nav(`/scripts/${j.id}`)}>
                <td><b>{j.title || "Untitled (in progress)"}</b><div className="muted small">{j.brand || new URL(j.product_url).hostname}</div></td>
                <td className="hide-sm">{j.platform} · {j.duration_sec}s</td>
                <td><StatusBadge status={j.status} /></td>
                <td className="hide-sm muted">{timeAgo(j.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
