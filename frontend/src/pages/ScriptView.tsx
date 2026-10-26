import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { getDriveToken } from "../google";
import { label, Modal, Spinner, StatusBadge, timeAgo, useToast } from "../components/ui";
import { useSession } from "../session";
import type { Job, JobSummary, StageEvent } from "../types";

const FULL = ["product_analysis", "brief", "reconcile", "concepts", "beats", "write", "qc"];
const PARTIAL = ["beats", "write", "qc"];
const STAGE_LABEL: Record<string, string> = {
  product_analysis: "Product analysis", brief: "Brief", reconcile: "Accuracy check", concepts: "Concepts",
  beats: "Beat sheet", write: "Writing", qc: "Quality review", revise: "Revising",
};
const SEV_ORDER = ["blocker", "major", "minor", "info"];
const BUSY = ["queued", "running"];

export default function ScriptView() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { config, user } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [modal, setModal] = useState<"approve" | "revise" | "delete" | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try { setJob(await api.get<Job>(`/api/jobs/${id}`)); }
    catch (e) { if (e instanceof ApiError && e.status === 404) setNotFound(true); else toast((e as Error).message, "error"); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);
  const busy = !!job && BUSY.includes(job.status);
  useEffect(() => {
    if (!busy) { setFrameKey((k) => k + 1); return; }
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  if (notFound) return <div className="empty"><h2>Script not found</h2><Link to="/scripts">Back to scripts</Link></div>;
  if (!job) return <div className="center"><Spinner /></div>;

  const qc = job.qc_history.at(-1);
  const flags = job.flags.filter((f) => f.severity !== "info").sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  const blockers = flags.filter((f) => f.severity === "blocker").length;

  const rerun = async (path: string, body: unknown, msg: string) => {
    try { await api.post<JobSummary>(`/api/jobs/${job.id}/${path}`, body); toast(msg); setModal(null); await load(); }
    catch (e) { toast((e as Error).message, "error"); }
  };

  const exportDoc = async () => {
    setExporting(true);
    try {
      const access_token = config.auth_mode === "google" ? await getDriveToken(config.google_client_id, user?.email) : undefined;
      const r = await api.post<{ doc_url: string }>(`/api/jobs/${job.id}/export`, { access_token });
      toast("Google Doc created.", "ok");
      window.open(r.doc_url, "_blank", "noopener");
      await load();
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setExporting(false); }
  };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="row"><h1>{job.script?.title || job.dossier?.name || "New script"}</h1><StatusBadge status={job.status} /></div>
          <div className="muted small">
            {job.dossier?.brand && <>{job.dossier.brand} · </>}{job.inputs.platform.replace(/_/g, " ")} · {job.inputs.duration_sec}s · created {timeAgo(job.created_at)}
            {job.format_version && <> · {job.format_version}</>}
          </div>
        </div>
        {job.script && !busy && (
          <div className="row">
            <a className="btn ghost" href={`/api/jobs/${job.id}/download`}>Download</a>
            <button className="btn secondary" onClick={() => setModal("revise")}>Revise with notes</button>
            <button className="btn secondary" onClick={exportDoc} disabled={exporting}>{exporting && <Spinner />} {job.doc_url ? "Export again" : "Export to Google Docs"}</button>
            <button className="btn" onClick={() => setModal("approve")} disabled={job.status === "approved"}>{job.status === "approved" ? "Approved" : "Approve"}</button>
          </div>
        )}
      </div>

      <Progress job={job} />

      {job.status === "failed" && (
        <div className="card" style={{ borderColor: "#f1c4bf", marginTop: 16 }}>
          <h2 style={{ color: "var(--bad)" }}>Generation failed</h2>
          <p>{job.error || "Something went wrong."}</p>
          <div className="row"><Link className="btn secondary" to="/new">Start a new script</Link>
            {job.concepts.length > 0 && <button className="btn" onClick={() => rerun("concept", { index: job.concept_decision?.chosen_index ?? 0 }, "Retrying from the beat sheet…")}>Retry</button>}</div>
        </div>
      )}

      {job.doc_url && <div className="card" style={{ marginTop: 16 }}>📄 Google Doc: <a href={job.doc_url} target="_blank" rel="noopener noreferrer">{job.doc_url}</a></div>}

      <div className="split" style={{ marginTop: 16 }}>
        <div>
          {job.script ? (
            <iframe key={frameKey} className="doc-frame" title="Script preview" src={`/api/jobs/${job.id}/preview`}
                    onLoad={(e) => { const d = e.currentTarget.contentDocument; if (d) e.currentTarget.style.height = d.body.scrollHeight + 40 + "px"; }} />
          ) : (
            <div className="card empty">{busy ? <><Spinner /><p>Your script will appear here when it's written and reviewed.</p></> : <p>No script was produced.</p>}</div>
          )}
        </div>

        <div className="stack">
          {flags.length > 0 && (
            <div className="card">
              <h2>Flags for the client {blockers > 0 && <span className="badge failed">{blockers} blocker{blockers > 1 ? "s" : ""}</span>}</h2>
              <p className="hint">Missing or conflicting information. The script never fills these gaps with invented details.</p>
              {flags.map((f, i) => (
                <div key={i} className={`flag ${f.severity}`}>
                  <span className="sev">{f.severity.toUpperCase()}</span>{f.message}
                  {f.suggestion && <div className="sug">→ {f.suggestion}</div>}
                </div>
              ))}
            </div>
          )}

          {qc && (
            <div className="card">
              <h2>Quality review</h2>
              <p className="hint">{qc.passed ? "✓ Passed every gate" : "Needs an editor's eye"} · round {qc.iteration}{qc.summary && <> · {qc.summary}</>}</p>
              <div className="scores">
                {Object.entries(qc.scores).map(([k, v]) => <div key={k} className={`score ${v < 4 ? "low" : ""}`}><b>{v}</b>{label(k)}</div>)}
              </div>
              {qc.findings.filter((f) => f.severity !== "minor" && f.severity !== "info").map((f, i) => (
                <div key={i} className={`flag ${f.severity}`}><span className="sev">{label(f.check).toUpperCase()}</span>
                  {f.scene ? `Scene ${f.scene}: ` : ""}{f.message}{f.fix && <div className="sug">→ {f.fix}</div>}</div>
              ))}
            </div>
          )}

          {job.concepts.length > 0 && (
            <div className="card">
              <h2>Concepts explored</h2>
              {job.concept_decision?.director_notes && <p className="hint">Director's notes: {job.concept_decision.director_notes}</p>}
              <div className="concepts">
                {job.concepts.map((c, i) => {
                  const chosen = i === (job.concept_decision?.chosen_index ?? 0);
                  return (
                    <div key={i} className={`concept ${chosen ? "chosen" : ""}`}>
                      <b>{c.title}{chosen && <span className="badge" style={{ marginLeft: 6 }}>in script</span>}</b>
                      <div>{c.logline}</div>
                      <div className="hookline">Hook: “{c.hook_line}”</div>
                      <div className="muted small">{c.why_it_works}</div>
                      {!chosen && !busy && <button className="btn secondary" onClick={() => rerun("concept", { index: i }, "Rewriting with this concept…")}>Use this concept</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {job.dossier && (
            <div className="card">
              <h2>Product facts</h2>
              <p className="hint">From <a href={job.dossier.url} target="_blank" rel="noopener noreferrer">the product page</a>. Crossed-out items couldn't be verified and aren't used.</p>
              <ul className="facts">
                {job.dossier.facts.map((f) => (
                  <li key={f.id} title={`“${f.evidence.quote}” (${f.evidence.source})`} className={f.verified ? "" : "no"}>
                    <b>{f.id}</b> · {f.statement} <span className="muted">[{f.category}]</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {job.revisions.length > 0 && (
            <div className="card">
              <h2>History</h2>
              {job.revisions.slice().reverse().map((r, i) => (
                <div key={i} className="small" style={{ marginTop: 6 }}>
                  <b>{r.kind === "feedback" ? "Revised with notes" : "Switched concept"}</b> · {timeAgo(r.at)}
                  <div className="muted">{r.detail}</div>
                </div>
              ))}
            </div>
          )}

          {!busy && <button className="btn danger" onClick={() => setModal("delete")}>Delete script</button>}
        </div>
      </div>

      {modal === "revise" && <ReviseModal onClose={() => setModal(null)} onSubmit={(feedback) => rerun("revise", { feedback }, "Revising… this takes a minute or two.")} />}
      {modal === "approve" && <ApproveModal blockers={blockers} admin={!!user?.admin} onClose={() => setModal(null)}
        onSubmit={async (body) => {
          try { await api.post(`/api/jobs/${job.id}/approve`, body); toast("Approved and added to the house library.", "ok"); setModal(null); load(); }
          catch (e) { toast((e as Error).message, "error"); }
        }} />}
      {modal === "delete" && (
        <Modal title="Delete this script?" onClose={() => setModal(null)} actions={<>
          <button className="btn ghost" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn danger" onClick={async () => {
            try { await api.del(`/api/jobs/${job.id}`); toast("Deleted."); nav("/scripts"); } catch (e) { toast((e as Error).message, "error"); }
          }}>Delete</button></>}>
          <p>This removes it from your scripts. Google Docs you exported stay in your Drive.</p>
        </Modal>
      )}
    </>
  );
}

function Progress({ job }: { job: Job }) {
  const { steps, current, detail } = useMemo(() => {
    const lastRun = job.events.map((e) => e.stage).lastIndexOf("run");
    const evs: StageEvent[] = lastRun >= 0 ? job.events.slice(lastRun) : job.events;
    const isFull = (evs[0]?.detail || "").startsWith("Full") || evs.length === 0;
    const plan = isFull ? FULL : evs.some((e) => e.stage === "revise") ? ["revise", "qc"] : PARTIAL;
    const done = new Set(evs.filter((e) => e.status === "done").map((e) => e.stage));
    const failed = new Set(evs.filter((e) => e.status === "failed").map((e) => e.stage));
    const last = [...evs].reverse().find((e) => e.stage !== "run");
    return { steps: plan.map((s) => ({ s, done: done.has(s), failed: failed.has(s) })), current: last?.stage, detail: last?.detail };
  }, [job.events]);
  if (!BUSY.includes(job.status)) return null;
  return (
    <div className="card">
      <div className="row"><Spinner /><b>{job.status === "queued" ? "Queued…" : `Working: ${STAGE_LABEL[current || ""] || "starting"}`}</b></div>
      <div className="timeline">
        {steps.map(({ s, done, failed }) => (
          <span key={s} className={`step ${failed ? "failed" : current === s || (s === "qc" && current === "revise") ? "active" : done ? "done" : ""}`}>
            {done && current !== s ? "✓ " : ""}{STAGE_LABEL[s]}</span>
        ))}
      </div>
      {detail && <div className="progress-detail">{detail}</div>}
    </div>
  );
}

function ReviseModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (f: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Revise with notes" onClose={onClose} actions={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy || text.trim().length < 5} onClick={async () => { setBusy(true); await onSubmit(text.trim()); setBusy(false); }}>
        {busy && <Spinner />} Revise script</button></>}>
      <p className="hint">Write notes as you would to a writer: what to change and why. The revision goes through the full quality review again.</p>
      <textarea autoFocus style={{ minHeight: 140 }} value={text} maxLength={5000} onChange={(e) => setText(e.target.value)}
                placeholder="e.g. The hook feels slow; open on the spill. Make scene 3 dialogue less formal. Client wants the price on the end frame." />
    </Modal>
  );
}

function ApproveModal({ blockers, admin, onClose, onSubmit }: {
  blockers: number; admin: boolean; onClose: () => void;
  onSubmit: (b: { notes: string; category: string; promote_note_to_format: boolean; acknowledge_flags: boolean }) => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  const [promote, setPromote] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Approve as house standard" onClose={onClose} actions={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy || (blockers > 0 && !ack)} onClick={async () => {
        setBusy(true); await onSubmit({ notes, category, promote_note_to_format: promote, acknowledge_flags: ack }); setBusy(false);
      }}>{busy && <Spinner />} Approve</button></>}>
      <p className="hint">Approved scripts become reference examples for future scripts on the same platform and hook type.</p>
      <div className="field"><span>What makes this script good?</span>
        <textarea className="short" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. The hook is specific and visual; the product enters as the answer, not an ad break." /></div>
      <div className="field"><span>Product category <em>· optional</em></span>
        <input type="text" value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Skincare, Beverages" /></div>
      {admin && notes && <label className="row small" style={{ marginTop: 10 }}><input type="checkbox" checked={promote} onChange={(e) => setPromote(e.target.checked)} /> Also add this note to the house format's editorial rules</label>}
      {blockers > 0 && <label className="row small err" style={{ marginTop: 10 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I confirm the {blockers} blocker flag(s) have been resolved with the client</label>}
    </Modal>
  );
}
