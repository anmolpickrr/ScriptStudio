import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { EMPTY, importBriefFile, loadDraft, saveDraft, validUrl } from "../brief";
import { hostOf, Icon, Skeleton, Spinner, StatusBadge, timeAgo, useToast } from "../components/ui";
import { useSession } from "../session";
import type { JobStatus, JobSummary } from "../types";

const STEPS = [
  { icon: "🔗", title: "Share the product", text: "Paste the product link, or import your brief document." },
  { icon: "🔎", title: "Facts get checked", text: "Every product claim is matched to the product page. Gaps are flagged, never invented." },
  { icon: "🎬", title: "Script is written", text: "Concepts, scenes, voice-over and on-screen text, then an editorial quality review." },
  { icon: "📄", title: "Export & share", text: "Download in your Creative Brief format for Google Docs or Word." },
];

const BUCKETS: { label: string; match: (s: JobStatus) => boolean }[] = [
  { label: "Scripts", match: () => true },
  { label: "In progress", match: (s) => ["queued", "running", "awaiting_input"].includes(s) },
  { label: "Ready", match: (s) => s === "ready" || s === "needs_review" },
  { label: "Approved", match: (s) => s === "approved" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const { config } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [importing, setImporting] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.get<JobSummary[]>("/api/jobs").then((j) => alive && setJobs(j)).catch(() => alive && setJobs((x) => x ?? []));
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const start = (ev: FormEvent) => {
    ev.preventDefault();
    const u = url.trim();
    if (!validUrl(u)) { setUrlError("Paste the full product page link, starting with https://"); return; }
    nav(`/new?url=${encodeURIComponent(u)}`);
  };

  const importBrief = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const r = await importBriefFile(file);
      saveDraft({ ...EMPTY, engine: loadDraft().engine, ...r.fields });
      nav("/new", { state: { imported: r.recognised } });
    } catch (e) { toast((e as Error).message, "error"); setImporting(false); }
  };

  const recent = (jobs || []).slice(0, 4);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><Icon.spark /> {greeting()}</div>
          <h1>Turn any product page into a <span className="grad">ready-to-shoot</span> ad script.</h1>
          <p>Paste a product link to begin. ScriptStudio reads the page, follows your brief and writes a checked, formatted script.</p>
          <form className="quick" onSubmit={start} noValidate>
            <span className="quick-ic" aria-hidden="true">🔗</span>
            <input type="url" inputMode="url" aria-label="Product page link" placeholder="https://brand.com/products/…"
                   value={url} onChange={(e) => { setUrl(e.target.value); setUrlError(""); }} />
            <button className="btn primary">Start <span aria-hidden="true">→</span></button>
          </form>
          {urlError ? <div className="err" role="alert">{urlError}</div>
            : <p className="hint">Free · {config.daily_job_limit} automatic scripts a day · unlimited with your own ChatGPT or Claude</p>}
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="mock">
            <div className="mock-top"><i /><i /><i /><span>Scene 1 · 0–3s</span></div>
            <div className="mock-line l1"><b>VISUAL</b><span>Close-up: shoe lands on a wet pavement</span></div>
            <div className="mock-line l2"><b>VO</b><span>"Rain plans? Not a problem."</span></div>
            <div className="mock-line l3"><b>SUPER</b><span>Water-repellent upper</span></div>
            <div className="mock-qc"><span className="pill-ok">✓ Facts verified</span><span className="pill-ok">QC 5/5</span></div>
          </div>
          <div className="orb" />
        </div>
      </section>

      <section>
        <h2 className="sec-h">Choose how to start</h2>
        <div className="starts">
          <Link to="/new" className="start">
            <span className="start-ic s1"><Icon.plus /></span>
            <b>Fill in a new brief</b>
            <span>Step-by-step form that follows your Creative Brief template.</span>
            <span className="go">Open form →</span>
          </Link>
          <button type="button" className="start" disabled={importing} onClick={() => fileRef.current?.click()}>
            <span className="start-ic s2">{importing ? <Spinner /> : <Icon.upload />}</span>
            <b>Import a brief</b>
            <span>Upload your brief as a Word file (.docx). We fill in the form for you.</span>
            <span className="go">{importing ? "Reading…" : "Choose file →"}</span>
          </button>
          <Link to="/new?engine=chatgpt" className="start">
            <span className="start-ic s3"><span className="dotlogo gpt">G</span><span className="dotlogo claude">C</span></span>
            <b>Use ChatGPT or Claude</b>
            <span>Write with your own plan: copy one prompt, paste the reply back.</span>
            <span className="go">Set up →</span>
          </Link>
        </div>
        <input ref={fileRef} type="file" hidden onChange={importBrief}
               accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
      </section>

      <section>
        <h2 className="sec-h">How it works</h2>
        <ol className="how">
          {STEPS.map((s, i) => (
            <li key={s.title} style={{ animationDelay: `${i * 80}ms` }}>
              <span className="how-ic">{s.icon}</span>
              <span className="how-n">Step {i + 1}</span>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <div className="sec-row">
          <h2 className="sec-h">Your scripts</h2>
          {jobs && jobs.length > 0 && <Link to="/scripts" className="small">View all →</Link>}
        </div>
        {jobs === null ? (
          <div className="stats">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={78} />)}</div>
        ) : jobs.length === 0 ? (
          <div className="card empty slim">
            <div className="art">✍️</div>
            <h2>No scripts yet</h2>
            <p>Your scripts will appear here. Paste a product link above to write your first one.</p>
          </div>
        ) : (
          <>
            <div className="stats">
              {BUCKETS.map((b) => (
                <div key={b.label} className="stat"><b>{jobs.filter((j) => b.match(j.status)).length}</b><span>{b.label}</span></div>
              ))}
            </div>
            <div className="recent">
              {recent.map((j) => (
                <Link key={j.id} to={`/scripts/${j.id}`} className="rcard">
                  <div className="rcard-top">
                    <span className="rcard-ic">{(j.brand || hostOf(j.product_url))[0]?.toUpperCase() || "S"}</span>
                    <StatusBadge status={j.status} />
                  </div>
                  <b>{j.title || "Untitled (in progress)"}</b>
                  <span className="muted small">{j.brand || hostOf(j.product_url)} · {j.duration_sec}s · {timeAgo(j.updated_at)}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
