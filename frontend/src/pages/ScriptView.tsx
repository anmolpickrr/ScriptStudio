import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { getDriveToken } from "../google";
import { ENGINE_NAME, ENGINE_URL, hostOf, Icon, label, Menu, Modal, PageSkeleton, Spinner, StatusBadge, timeAgo, useToast } from "../components/ui";
import { useSession } from "../session";
import type { Job, JobSummary, StageEvent } from "../types";

const FULL = ["product_analysis", "brief", "reconcile", "concepts", "beats", "write", "qc"];
const STAGE: Record<string, string> = {
  product_analysis: "Reading the product page", brief: "Understanding the brief", reconcile: "Checking facts against the brief",
  concepts: "Developing concepts", beats: "Building the beat sheet", write: "Writing the script", qc: "Editorial quality review",
  revise: "Applying revisions",
};
const SEV_ORDER = ["blocker", "major", "minor", "info"];
const BUSY = ["queued", "running"];
type Tab = "script" | "review" | "flags" | "concepts" | "facts" | "history";

export default function ScriptView() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { config, user, options } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("script");
  const [frameKey, setFrameKey] = useState(0);
  const [modal, setModal] = useState<"approve" | "revise" | "delete" | null>(null);
  const [working, setWorking] = useState("");

  const load = useCallback(async () => {
    try { setJob(await api.get<Job>(`/api/jobs/${id}`)); setLoadError(""); }
    catch (e) {
      if (e instanceof ApiError && e.status === 404) setLoadError("404");
      else setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => { setJob(null); setTab("script"); load(); }, [load]);
  const busy = !!job && BUSY.includes(job.status);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) { wasBusy.current = true; const t = setInterval(load, 2500); return () => clearInterval(t); }
    if (wasBusy.current) { wasBusy.current = false; setFrameKey((k) => k + 1); }
  }, [busy, load]);

  if (loadError === "404") return (
    <div className="card empty"><div className="art">🔍</div><h2>Script not found</h2>
      <p>It may have been deleted, or it belongs to another workspace.</p><Link className="btn primary" to="/scripts">Back to my scripts</Link></div>
  );
  if (!job) return loadError
    ? <div className="card empty"><h2>Couldn't load this script</h2><p>{loadError}</p><button className="btn primary" onClick={load}>Try again</button></div>
    : <PageSkeleton />;

  const qc = job.qc_history.at(-1);
  const flags = job.flags.filter((f) => f.severity !== "info").sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  const blockers = flags.filter((f) => f.severity === "blocker").length;
  const openFindings = qc ? qc.findings.filter((f) => f.severity === "blocker" || f.severity === "major") : [];

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setWorking(key);
    try { await fn(); if (ok) toast(ok, "ok"); setModal(null); await load(); }
    catch (e) { toast((e as Error).message, "error"); }
    finally { setWorking(""); }
  };
  const rerun = (path: string, body: unknown, msg: string) => act(path, () => api.post<JobSummary>(`/api/jobs/${job.id}/${path}`, body), msg);

  const exportGoogle = () => act("export", async () => {
    const access_token = config.auth_mode === "none" ? undefined : await getDriveToken(config.google_client_id, user?.guest ? undefined : user?.email);
    const r = await api.post<{ doc_url: string }>(`/api/jobs/${job.id}/export`, { access_token });
    window.open(r.doc_url, "_blank", "noopener");
  }, "Google Doc created in your Drive.");

  const download = (kind: "docx" | "download") => act(kind, () =>
    api.download(`/api/jobs/${job.id}/${kind}`, `${job.script?.title || "script"}.${kind === "docx" ? "docx" : "html"}`));

  const tabs: { key: Tab; label: string; count?: number; show: boolean }[] = [
    { key: "script", label: "Script", show: true },
    { key: "review", label: "Quality review", count: openFindings.length || undefined, show: !!qc },
    { key: "flags", label: "Client flags", count: flags.length || undefined, show: flags.length > 0 },
    { key: "concepts", label: "Concepts", count: job.concepts.length || undefined, show: job.concepts.length > 0 },
    { key: "facts", label: "Product facts", show: !!job.dossier },
    { key: "history", label: "History", show: job.revisions.length > 0 },
  ];

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="row" style={{ gap: 10 }}><h1>{job.script?.title || job.dossier?.name || `Script for ${hostOf(job.inputs.product_url)}`}</h1><StatusBadge status={job.status} /></div>
          <p className="small">
            {[job.dossier?.brand || hostOf(job.inputs.product_url), options?.platforms[job.inputs.platform]?.label || job.inputs.platform, `${job.inputs.duration_sec}s`, `created ${timeAgo(job.created_at)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        {job.script && !busy && (
          <div className="row">
            <button className="btn secondary" onClick={() => setModal("revise")}>Revise</button>
            <Menu trigger={(toggle) => (
              <button className="btn secondary" onClick={toggle} aria-haspopup="menu" disabled={["export", "docx", "download"].includes(working)}>
                {["export", "docx", "download"].includes(working) ? <Spinner /> : null} Export <Icon.down /></button>
            )}>
              {(close) => (<>
                {config.drive_export && <button onClick={() => { close(); exportGoogle(); }}>Google Docs<small>Creates a formatted Doc in your Drive</small></button>}
                <button onClick={() => { close(); download("docx"); }}>Word (.docx)<small>{config.drive_export ? "For Word, Pages or Drive" : "Opens in Google Docs, Word or Pages"}</small></button>
                <button onClick={() => { close(); download("download"); }}>HTML<small>Same layout, for email or archiving</small></button>
              </>)}
            </Menu>
            <button className="btn primary" onClick={() => setModal("approve")} disabled={job.status === "approved"}>{job.status === "approved" ? "✓ Approved" : "Approve"}</button>
            <Menu trigger={(toggle) => <button className="btn ghost icon" aria-label="More actions" onClick={toggle}><Icon.more /></button>}>
              {(close) => <button className="danger" onClick={() => { close(); setModal("delete"); }}>Delete script</button>}
            </Menu>
          </div>
        )}
      </div>

      {busy && <Progress job={job} />}
      {job.status === "awaiting_input" && job.relay && <RelayPanel job={job} onDone={load} />}

      {job.status === "failed" && (
        <div className="banner bad" role="alert">
          <span>⛔</span>
          <div style={{ flex: 1 }}><b>Generation failed.</b> {job.error || "Something went wrong."}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" disabled={!!working} onClick={() => rerun("retry", {}, "Restarted.")}>{working === "retry" && <Spinner />}Try again</button>
              <Link className="btn secondary" to="/new">Edit inputs in a new script</Link>
            </div>
          </div>
        </div>
      )}
      {job.error && job.status !== "failed" && !busy && <div className="banner">ℹ️ {job.error}</div>}
      {blockers > 0 && !busy && job.script && (
        <div className="banner bad"><span>⚠️</span><span><b>{blockers} blocker{blockers > 1 ? "s" : ""} for the client.</b> Some details couldn't be confirmed, so the script works around them. <button className="toggle-link" style={{ margin: 0 }} onClick={() => setTab("flags")}>Review flags</button></span></div>
      )}
      {job.doc_url && <div className="banner info">📄 <span>Google Doc: <a href={job.doc_url} target="_blank" rel="noopener noreferrer">open in Google Docs</a></span></div>}

      {(job.script || (!busy && job.status !== "awaiting_input")) && (
        <>
          <div className="tabs" role="tablist">
            {tabs.filter((t) => t.show).map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
                {t.label}{t.count ? <span className="badge count">{t.count}</span> : null}
              </button>
            ))}
          </div>

          {tab === "script" && (job.script ? (
            <ScriptPreview key={frameKey} jobId={job.id} />
          ) : <div className="card empty"><p>No script was produced.</p></div>)}

          {tab === "review" && qc && (
            <div className="card stack">
              <div className="card-head"><h2 className="grow">{qc.passed ? "✓ Passed every quality gate" : "Needs an editor's eye"}</h2>
                <span className="muted small">Review round {qc.iteration}</span></div>
              {qc.summary && <p className="muted" style={{ margin: 0 }}>{qc.summary}</p>}
              <div className="scores">
                {Object.entries(qc.scores).map(([k, v]) => <div key={k} className={`score ${v < 4 ? "low" : v === 5 ? "high" : ""}`}><b>{v}<span className="small muted">/5</span></b>{label(k)}</div>)}
              </div>
              {qc.findings.length === 0 ? <p className="muted">No open findings.</p> : (
                <div className="stack-sm">
                  {qc.findings.filter((f) => f.severity !== "info").sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).map((f, i) => (
                    <div key={i} className={`flag ${f.severity}`}><span className="sev">{label(f.check)}</span>
                      {f.scene ? <b>Scene {f.scene}: </b> : null}{f.message}{f.fix && <div className="sug">→ {f.fix}</div>}</div>
                  ))}
                </div>
              )}
              {!qc.passed && <div><button className="btn secondary" onClick={() => setModal("revise")}>Revise with notes</button></div>}
            </div>
          )}

          {tab === "flags" && (
            <div className="card stack-sm">
              <p className="muted" style={{ margin: "0 0 6px" }}>Missing or conflicting information to confirm with the client. The script never fills these gaps with invented details.</p>
              {flags.map((f, i) => (
                <div key={i} className={`flag ${f.severity}`}><span className="sev">{f.severity}</span>{f.message}{f.suggestion && <div className="sug">→ {f.suggestion}</div>}</div>
              ))}
            </div>
          )}

          {tab === "concepts" && (
            <div className="stack">
              {job.concept_decision?.director_notes && <div className="banner info"><span>🎬</span><span><b>Director's notes:</b> {job.concept_decision.director_notes}</span></div>}
              <div className="concepts">
                {job.concepts.map((c, i) => {
                  const chosen = i === (job.concept_decision?.chosen_index ?? 0);
                  const score = job.concept_decision?.scores.find((s) => s.index === i);
                  return (
                    <div key={i} className={`concept ${chosen ? "chosen" : ""}`}>
                      <div className="row"><b style={{ flex: 1 }}>{c.title}</b>{chosen && <span className="badge ready">In script</span>}</div>
                      <div>{c.logline}</div>
                      <div className="hookline">Hook: “{c.hook_line}”</div>
                      <div className="muted small">{c.why_it_works}</div>
                      {score && <div className="muted small">Hook {score.hook}/5 · Brief fit {score.brief_fit}/5 · Originality {score.originality}/5</div>}
                      {!chosen && !busy && <div className="foot"><button className="btn secondary" disabled={!!working} onClick={() => rerun("concept", { index: i }, job.inputs.engine === "auto" ? "Rewriting with this concept…" : `Prompt ready — copy it into ${ENGINE_NAME[job.inputs.engine]}.`)}>Use this concept</button></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "facts" && job.dossier && (
            <div className="card stack-sm">
              <p className="muted" style={{ margin: "0 0 6px" }}>From <a href={job.dossier.url} target="_blank" rel="noopener noreferrer">the product page</a>. Hover a fact to see the exact quote it's based on. Crossed-out items couldn't be verified and aren't used.</p>
              <ul className="facts">
                {job.dossier.facts.map((f) => (
                  <li key={f.id} title={`“${f.evidence.quote}”`} className={f.verified ? "" : "no"}>
                    <span className="id">{f.id}</span><span>{f.statement}</span><span className="cat">{f.category}</span>
                  </li>
                ))}
              </ul>
              {job.dossier.packaging_description && <p className="small"><b>Packaging:</b> {job.dossier.packaging_description}</p>}
            </div>
          )}

          {tab === "history" && (
            <div className="card stack-sm">
              {job.revisions.slice().reverse().map((r, i) => (
                <div key={i} style={{ paddingBottom: 10, borderBottom: "1px solid var(--line-2)" }}>
                  <b>{r.kind === "feedback" ? "Revised with notes" : "Switched concept"}</b> <span className="muted small">· {timeAgo(r.at)}</span>
                  <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{r.detail}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {modal === "revise" && <ReviseModal engine={job.inputs.engine} onClose={() => setModal(null)}
        onSubmit={(feedback) => rerun("revise", { feedback }, job.inputs.engine === "auto" ? "Revising… this takes a minute or two." : `Revision prompt ready — copy it into ${ENGINE_NAME[job.inputs.engine]}.`)} />}
      {modal === "approve" && <ApproveModal blockers={blockers} admin={!!user?.admin} onClose={() => setModal(null)}
        onSubmit={(body) => act("approve", () => api.post(`/api/jobs/${job.id}/approve`, body), "Approved and added to the house library.")} />}
      {modal === "delete" && (
        <Modal title="Delete this script?" onClose={() => setModal(null)} actions={<>
          <button className="btn ghost" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn danger" disabled={!!working} onClick={() => act("delete", async () => { await api.del(`/api/jobs/${job.id}`); nav("/scripts"); }, "Script deleted.")}>Delete</button></>}>
          <p className="muted">This removes it from your scripts. Exported Google Docs and downloads are not affected.</p>
        </Modal>
      )}
    </>
  );
}

function Progress({ job }: { job: Job }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const { plan, done, failed, current, started, details } = useMemo(() => {
    const lastRun = job.events.map((e) => e.stage).lastIndexOf("run");
    const evs: StageEvent[] = lastRun >= 0 ? job.events.slice(lastRun) : [];
    const label = evs[0]?.detail || "Full generation";
    const plan = job.inputs.engine !== "auto" ? ["product_analysis"]
      : label.startsWith("Full") ? FULL : label.startsWith("Revise") ? ["revise", "qc"] : ["beats", "write", "qc"];
    const done = new Set(evs.filter((e) => e.status === "done").map((e) => e.stage));
    const failed = new Set(evs.filter((e) => e.status === "failed").map((e) => e.stage));
    const lastStarted = [...evs].reverse().find((e) => e.stage !== "run" && e.status === "started");
    const details: Record<string, string> = {};
    evs.forEach((e) => { if (e.detail && e.stage !== "run") details[e.stage] = e.detail; });
    return { plan, done, failed, current: lastStarted?.stage, started: evs[0]?.at || job.created_at, details };
  }, [job.events, job.created_at, job.inputs.engine]);
  const elapsed = Math.max(0, Math.floor((now - new Date(started).getTime()) / 1000));
  const pct = Math.min(95, Math.round(((plan.filter((s) => done.has(s)).length + 0.5) / plan.length) * 100));
  const curStep = current === "revise" && plan.includes("qc") && done.has("revise") ? "qc" : current;

  return (
    <div className="card" style={{ marginBottom: 16 }} aria-live="polite">
      <div className="card-head">
        <Spinner /><h2 className="grow">{job.status === "queued" ? "Queued — starting shortly" : STAGE[curStep || ""] || "Working…"}</h2>
        <span className="muted small nowrap">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed</span>
      </div>
      <div className="bar"><div style={{ width: `${job.status === "queued" ? 3 : pct}%` }} /></div>
      <ul className="steps">
        {plan.map((s) => {
          const isDone = done.has(s) && s !== curStep;
          const cls = failed.has(s) ? "failed" : s === curStep ? "active" : isDone ? "done" : "";
          return <li key={s} className={cls}><span className="ic">{isDone ? "✓" : ""}</span>{STAGE[s]}
            {details[s] && (isDone || s === curStep) && <span className="detail">{details[s]}</span>}</li>;
        })}
      </ul>
      <p className="hint" style={{ marginTop: 12 }}>Usually 2–5 minutes. You can leave this page — your script keeps generating and will be in <Link to="/scripts">My scripts</Link>.</p>
    </div>
  );
}

function ReviseModal({ engine, onClose, onSubmit }: { engine: Job["inputs"]["engine"]; onClose: () => void; onSubmit: (f: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Revise with notes" onClose={onClose} actions={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || text.trim().length < 5} onClick={async () => { setBusy(true); await onSubmit(text.trim()); setBusy(false); }}>
        {busy && <Spinner />} {engine === "auto" ? "Revise script" : "Prepare revision prompt"}</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>{engine === "auto"
        ? "Write notes as you would to a writer. The revision goes through the full quality review again."
        : `Write notes as you would to a writer. We'll turn them, plus any quality findings, into a revision prompt for ${ENGINE_NAME[engine]}.`}</p>
      <textarea autoFocus style={{ minHeight: 150 }} value={text} maxLength={5000} onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Open on the spill instead of the alarm. Make scene 3 dialogue less formal. Add the price on the end frame." />
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
    <Modal title="Approve this script" onClose={onClose} actions={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || (blockers > 0 && !ack)} onClick={async () => {
        setBusy(true); await onSubmit({ notes, category, promote_note_to_format: promote, acknowledge_flags: ack }); setBusy(false);
      }}>{busy && <Spinner />} Approve</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Approved scripts join the house library and guide future scripts on the same platform and hook type.</p>
      <div className="field"><label className="label" htmlFor="ap-notes">What makes it good? <em>· optional</em></label>
        <textarea id="ap-notes" className="short" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Specific, visual hook; the product enters as the answer, not an ad break." /></div>
      <div className="field"><label className="label" htmlFor="ap-cat">Product category <em>· optional</em></label>
        <input id="ap-cat" type="text" value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Skincare, Beverages" /></div>
      {admin && notes && <label className="row small" style={{ marginTop: 12 }}><input type="checkbox" checked={promote} onChange={(e) => setPromote(e.target.checked)} /> Also add this note to the house format's editorial rules</label>}
      {blockers > 0 && <label className="row small err" style={{ marginTop: 12 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I've resolved the {blockers} blocker flag(s) with the client</label>}
    </Modal>
  );
}

function RelayPanel({ job, onDone }: { job: Job; onDone: () => Promise<void> }) {
  const toast = useToast();
  const relay = job.relay!;
  const name = ENGINE_NAME[job.inputs.engine];
  const [sent, setSent] = useState(false);
  const [back, setBack] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState(relay.last_error);
  const [busy, setBusy] = useState(false);

  // when the user comes back from the chat tab, point them at step 2
  useEffect(() => {
    if (!sent) return;
    const onFocus = () => setBack(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [sent]);

  const copyAndOpen = async () => {
    try { await navigator.clipboard.writeText(relay.prompt); }
    catch {  // no clipboard permission: select the text so Ctrl/⌘+C works
      setShowPrompt(true);
      setTimeout(() => { const el = document.getElementById("relay-prompt"); if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); } }, 50);
      toast("Press Ctrl/⌘ + C to copy the selected prompt, then open " + name + ".");
      return;
    }
    setSent(true);
    window.open(ENGINE_URL[job.inputs.engine], "_blank", "noopener");
    toast(`Prompt copied. In ${name}, paste it (Ctrl/⌘ + V) and send.`, "ok");
  };
  const submit = async (text: string) => {
    if (text.trim().length < 2) return;
    setBusy(true); setError("");
    try { await api.post(`/api/jobs/${job.id}/relay`, { answer: text }); toast("Script checked and formatted.", "ok"); await onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const pasteReply = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.includes("{")) { setError(`The clipboard doesn't hold ${name}'s reply yet. Click the copy icon under ${name}'s answer, then try again.`); return; }
      setAnswer(text); await submit(text);
    } catch { setError("Your browser blocked reading the clipboard. Paste the reply into the box below instead."); }
  };

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h2 className="grow">{relay.kind === "full" ? `Write it with ${name}` : `Revise with ${name}`} <span className="muted small">· round {relay.round}</span></h2>
      </div>
      <p className="muted" style={{ margin: "4px 0 16px" }}>Two steps. Your {name} plan does the writing; ScriptStudio fact-checks the reply against the product page, runs the quality checks and formats it.</p>
      <div className="relay-steps">
        <div className={`relay-step ${sent ? "done" : ""}`}>
          <span className="n">{sent ? "✓" : 1}</span>
          <div>
            <h3>Send the prompt to {name}</h3>
            <div className="muted small">We copy the prompt and open {name}. There, press <b>Ctrl/⌘ + V</b> and send. For best results pick the strongest model in your plan{job.inputs.engine === "chatgpt" ? " (e.g. a “Thinking” model)" : " (e.g. Opus)"}.</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={copyAndOpen}><Icon.copy /> {sent ? "Copy & open again" : `Copy prompt & open ${name}`} <Icon.ext /></button>
              <button className="btn ghost sm" onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? "Hide" : "View"} prompt</button>
            </div>
            {showPrompt && <div id="relay-prompt" className="prompt-box">{relay.prompt}</div>}
          </div>
        </div>
        <div className={`relay-step ${back ? "focus" : ""}`}>
          <span className="n">2</span>
          <div>
            <h3>Bring the reply back</h3>
            <div className="muted small">When {name} finishes, click the <b>copy</b> icon under its answer, then click the button below. If the answer stops halfway, ask {name} to “continue” first.</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy} onClick={pasteReply}>{busy ? <Spinner /> : <Icon.spark />} {busy ? "Checking the script…" : "Paste reply & build script"}</button>
            </div>
            {error && <div className="banner bad" style={{ marginTop: 12, marginBottom: 0 }} role="alert"><span>⚠️</span><span>{error}</span></div>}
            <details className="manual" open={!!answer && !busy}>
              <summary>Or paste it yourself</summary>
              <textarea className="mono" style={{ marginTop: 10, minHeight: 130 }} value={answer} aria-label={`${name} reply`}
                        placeholder={'```json\n{ "product_name": … }\n```'} onChange={(e) => setAnswer(e.target.value)}
                        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t.includes("{") && t.length > 300) { e.preventDefault(); setAnswer(t); submit(t); } }} />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" disabled={busy || answer.trim().length < 2} onClick={() => submit(answer)}>Check & format</button>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The rendered document, fetched with the session (works when the API lives on another origin). */
function ScriptPreview({ jobId }: { jobId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    api.text(`/api/jobs/${jobId}/preview`).then((h) => alive && setHtml(h.replace("<head>", '<head><base target="_blank">')))
      .catch((e) => alive && setErr((e as Error).message));
    return () => { alive = false; };
  }, [jobId]);
  if (err) return <div className="card empty"><p>{err}</p></div>;
  if (html === null) return <div className="doc-frame doc-loading"><Spinner label="Loading the script" /></div>;
  return (
    <iframe className="doc-frame" title="Script preview" srcDoc={html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            onLoad={(e) => {
              const fr = e.currentTarget; const d = fr.contentDocument;
              if (!d) return;
              const fit = () => { fr.style.height = d.documentElement.scrollHeight + 24 + "px"; };
              fit(); new ResizeObserver(fit).observe(d.body);
            }} />
  );
}
