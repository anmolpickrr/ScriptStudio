import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { EMPTY, saveDraft } from "../brief";
import { getDriveToken } from "../google";
import ConnectSetup, { getGptUrl } from "../components/ConnectSetup";
import { useJobActions } from "../components/Cards";
import { ENGINE_NAME, ENGINE_URL, hostOf, Icon, label, Menu, Modal, Monogram, PageSkeleton, Spinner, StatusBadge, timeAgo, useMedia, useToast } from "../components/ui";
import { useSession } from "../session";
import type { Job, JobSummary, StageEvent } from "../types";

const FULL = ["product_analysis", "brief", "reconcile", "concepts", "beats", "write", "qc"];
const STAGE: Record<string, string> = {
  product_analysis: "Reading the product page", brief: "Understanding the brief", reconcile: "Checking facts against the brief",
  concepts: "Developing concepts", beats: "Building the beat sheet", write: "Writing the script", qc: "Editorial quality review",
  revise: "Applying revisions", handoff: "Writing in your chat",
};
const stageLabel = (st: string, job: Job) => (st === "handoff" ? `Writing in ${ENGINE_NAME[job.inputs.engine]}`
  : st === "qc" && job.inputs.engine !== "auto" ? "Quality checks" : STAGE[st]);

/** The same three steps every chat-written script goes through, so Claude and ChatGPT read like the free model. */
function ChatSteps({ job, at }: { job: Job; at: number }) {
  const plan = ["product_analysis", "handoff", "qc"];
  return (
    <div className="track mini" style={{ ["--pct" as string]: `${Math.min(95, Math.round(((at + 0.5) / plan.length) * 100))}%` }}>
      <div className="track-fill" />
      <ol>
        {plan.map((st, n) => (
          <li key={st} className={n < at ? "done" : n === at ? "active" : ""}>
            <span className="node">{n < at ? <Icon.check /> : String(n + 1).padStart(2, "0")}</span>
            <span className="lbl">{stageLabel(st, job)}</span>
          </li>))}
      </ol>
    </div>
  );
}
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
  const wide = useMedia("(min-width: 1100px)");
  const jobActs = useJobActions();
  const [docRef, setDocRef] = useState<{ doc: Document; frame: HTMLIFrameElement } | null>(null);

  const load = useCallback(async () => {
    try { setJob(await api.get<Job>(`/api/jobs/${id}`)); setLoadError(""); }
    catch (e) {
      if (e instanceof ApiError && e.status === 404) setLoadError("404");
      else setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => { setJob(null); setTab("script"); setDocRef(null); load(); }, [load]);
  const busy = !!job && BUSY.includes(job.status);
  const waiting = job?.status === "awaiting_input";
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      try {
        const j = await api.get<Job>(`/api/jobs/${id}`);
        if (j.status !== "awaiting_input") {
          setJob(j); setFrameKey((k) => k + 1);
          toast(j.relay?.submitted_via ? `Script received from ${ENGINE_NAME[j.inputs.engine]} and checked.` : "Script updated.", "ok");
        } else if (j.relay?.last_error) setJob(j);
      } catch { /* keep listening */ }
    }, 4000);
    return () => clearInterval(t);
  }, [waiting, id, toast]);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) { wasBusy.current = true; const t = setInterval(load, 2500); return () => clearInterval(t); }
    if (wasBusy.current) { wasBusy.current = false; setFrameKey((k) => k + 1); }
  }, [busy, load]);

  if (loadError === "404") return (
    <div className="card empty"><div className="art gl lg"><Icon.search /></div><h2>Script not found</h2>
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

  const allTabs: { key: Tab; label: string; count?: number; show: boolean }[] = [
    { key: "script", label: "Script", show: !wide },
    { key: "review", label: "Quality", count: openFindings.length || undefined, show: !!qc },
    { key: "flags", label: "Flags", count: flags.length || undefined, show: flags.length > 0 },
    { key: "concepts", label: "Concepts", count: job.concepts.length || undefined, show: job.concepts.length > 0 },
    { key: "facts", label: "Facts", count: job.dossier?.facts.filter((f) => f.verified).length || undefined, show: !!job.dossier },
    { key: "history", label: "History", count: job.revisions.length || undefined, show: job.revisions.length > 0 },
  ];
  const tabs = allTabs.filter((t) => t.show);
  // on wide screens the script is always visible, so the panel shows the first other tab instead
  const active: Tab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? "script");
  const brand = job.dossier?.brand || job.inputs.brand_name || hostOf(job.inputs.product_url);
  const title = job.script?.title || job.dossier?.name || `Script for ${hostOf(job.inputs.product_url)}`;
  const openPanel = (t: Tab) => { setTab(t); if (!wide) window.scrollTo({ top: 0, behavior: "smooth" }); };

  const panel = (t: Tab) => {
    if (t === "review" && qc) return (
      <div className="panel">
        <div className="score-head">
          {Object.keys(qc.scores).length ? <ScoreRing scores={qc.scores} /> : <CheckRing open={openFindings.length} />}
          <div><b>{qc.passed ? "Passed every quality check" : `${openFindings.length} thing${openFindings.length === 1 ? "" : "s"} to fix`}</b>
            <div className="muted small">{Object.keys(qc.scores).length ? "Editorial review" : "Automatic checks"} · round {qc.iteration}</div></div>
        </div>
        {qc.summary && <p className="muted small" style={{ margin: 0 }}>{qc.summary}</p>}
        <div className="scores">
          {Object.entries(qc.scores).map(([k, v]) => (
            <div key={k} className={`score ${v < 4 ? "low" : v === 5 ? "high" : ""}`}>
              <span>{label(k)}</span><span className="pips" aria-label={`${v} of 5`}>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= v ? "on" : ""} />)}</span>
            </div>))}
        </div>
        {qc.findings.filter((f) => f.severity !== "info").length === 0 ? <p className="muted small">No open findings.</p> : (
          <div className="stack-sm">
            {qc.findings.filter((f) => f.severity !== "info").sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).map((f, i) => (
              <div key={i} className={`flag ${f.severity}`}><span className="sev">{label(f.check)}</span>
                {f.scene ? <b>Scene {f.scene}: </b> : null}{f.message}{f.fix && <div className="sug">→ {f.fix}</div>}</div>
            ))}
          </div>
        )}
        {!qc.passed && <button className="btn primary sm" onClick={() => setModal("revise")}><Icon.spark /> {job.inputs.engine === "auto" ? "Fix these in a revision" : `Fix these with ${ENGINE_NAME[job.inputs.engine]}`}</button>}
      </div>
    );
    if (t === "flags") return (
      <div className="panel">
        <p className="muted small" style={{ margin: 0 }}>Missing or conflicting details to confirm with the client. The script never fills these gaps with invented details.</p>
        {flags.map((f, i) => (
          <div key={i} className={`flag ${f.severity}`}><span className="sev">{f.severity}</span>{f.message}{f.suggestion && <div className="sug">→ {f.suggestion}</div>}</div>
        ))}
      </div>
    );
    if (t === "concepts") return (
      <div className="panel">
        {job.concept_decision?.director_notes && <div className="note-card"><b><Icon.film /> Director's notes</b><span>{job.concept_decision.director_notes}</span></div>}
        {job.concepts.map((c, i) => {
          const chosen = i === (job.concept_decision?.chosen_index ?? 0);
          const score = job.concept_decision?.scores.find((x) => x.index === i);
          return (
            <div key={i} className={`concept ${chosen ? "chosen" : ""}`}>
              <div className="row" style={{ flexWrap: "nowrap" }}><b style={{ flex: 1 }}>{c.title}</b>{chosen && <span className="badge ready">In script</span>}</div>
              <div className="small">{c.logline}</div>
              <div className="hookline">“{c.hook_line}”</div>
              {score && <div className="muted small">Hook {score.hook}/5 · Brief fit {score.brief_fit}/5 · Originality {score.originality}/5</div>}
              {!chosen && !busy && <div className="foot"><button className="btn secondary sm" disabled={!!working} onClick={() => rerun("concept", { index: i }, job.inputs.engine === "auto" ? "Rewriting with this concept…" : `Prompt ready — copy it into ${ENGINE_NAME[job.inputs.engine]}.`)}>Use this concept</button></div>}
            </div>
          );
        })}
      </div>
    );
    if (t === "facts" && job.dossier) return (
      <div className="panel">
        <p className="muted small" style={{ margin: 0 }}>From <a href={job.dossier.url} target="_blank" rel="noopener noreferrer">the product page</a>. Hover a fact for the exact quote. Crossed-out items couldn't be verified and aren't used.</p>
        <ul className="facts">
          {job.dossier.facts.map((f) => (
            <li key={f.id} title={`“${f.evidence.quote}”`} className={f.verified ? "" : "no"}>
              <span className="id">{f.id}</span><span>{f.statement}</span><span className="cat">{f.category}</span>
            </li>
          ))}
        </ul>
        {job.dossier.packaging_description && <p className="small"><b>Packaging:</b> {job.dossier.packaging_description}</p>}
      </div>
    );
    if (t === "history") return (
      <div className="panel">
        <ol className="timeline">
          {job.revisions.slice().reverse().map((r, i) => (
            <li key={i}><b>{r.kind === "feedback" ? "Revised with notes" : "Switched concept"}</b> <span className="muted small">· {timeAgo(r.at)}</span>
              <div className="muted small" style={{ whiteSpace: "pre-wrap" }}>{r.detail}</div></li>
          ))}
        </ol>
      </div>
    );
    return job.script ? <ScriptPreview key={frameKey} jobId={job.id} onReady={setDocRef} /> : <div className="card empty"><p>No script was produced.</p></div>;
  };

  return (
    <>
      <div className="room-head">
        <Link className="back-link" to="/scripts"><Icon.back /> Scripts</Link>
        <div className="room-title">
          <Monogram text={brand} size={52} />
          <div className="grow">
            <h1>{title}</h1>
            <div className="meta-chips">
              <StatusBadge status={job.status} />
              <span className="chip-meta">{brand}</span>
              <span className="chip-meta">{options?.platforms[job.inputs.platform]?.label || job.inputs.platform} · {job.inputs.duration_sec}s</span>
              <span className="chip-meta">{job.inputs.language}</span>
              <span className="chip-meta"><span className={`dotlogo xs ${job.inputs.engine === "auto" ? "ss" : job.inputs.engine === "chatgpt" ? "gpt" : "claude"}`} />{ENGINE_NAME[job.inputs.engine]}</span>
              <span className="chip-meta muted">created {timeAgo(job.created_at)}</span>
            </div>
          </div>
        </div>
        {job.script && !busy && (
          <div className="room-actions">
            <button className="btn secondary" onClick={() => setModal("revise")}><Icon.edit /> Revise</button>
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
            <button className={`btn primary ${job.status === "approved" ? "done" : ""}`} onClick={() => setModal("approve")} disabled={job.status === "approved"}>
              {job.status === "approved" ? <><Icon.check /> Approved</> : "Approve"}</button>
            <Menu trigger={(toggle) => <button className="btn ghost icon" aria-label="More actions" onClick={toggle}><Icon.more /></button>}>
              {(close) => (<>
                <button onClick={() => { close(); jobActs.editAsNew(job.id); }}>Edit &amp; regenerate<small>Change the brief, write a new version</small></button>
                <button onClick={() => { close(); jobActs.duplicate(job.id); }}>Duplicate as draft<small>Reuse these inputs later</small></button>
                <button onClick={() => { close(); navigator.clipboard.writeText(window.location.href).then(() => toast("Link copied.", "ok"), () => toast("Couldn't copy the link.", "error")); }}>Copy link<small>Opens in your workspace</small></button>
                <button className="danger" onClick={() => { close(); setModal("delete"); }}>Delete script</button>
              </>)}
            </Menu>
          </div>
        )}
      </div>

      {busy && <Progress job={job} />}
      {job.status === "awaiting_input" && job.relay && <RelayPanel job={job} onDone={load} />}

      {job.status === "failed" && (
        <div className="banner bad" role="alert">
          <span className="gl bad"><Icon.alert /></span>
          <div style={{ flex: 1 }}><b>Generation failed.</b> {job.error || "Something went wrong."}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" disabled={!!working} onClick={() => rerun("retry", {}, "Restarted.")}>{working === "retry" && <Spinner />}Try again</button>
              <button className="btn secondary" onClick={() => { saveDraft({ ...EMPTY, ...job.inputs }); nav("/new"); }}>Edit inputs &amp; try again</button>
            </div>
          </div>
        </div>
      )}
      {job.error && job.status !== "failed" && !busy && <div className="banner"><span className="gl"><Icon.info /></span><span>{job.error}</span></div>}
      {blockers > 0 && !busy && job.script && (
        <div className="banner bad"><span className="gl bad"><Icon.alert /></span><span><b>{blockers} blocker{blockers > 1 ? "s" : ""} for the client.</b> Some details couldn't be confirmed, so the script works around them. <button className="toggle-link" style={{ margin: 0 }} onClick={() => openPanel("flags")}>Review flags</button></span></div>
      )}
      {job.doc_url && <div className="banner info"><span className="gl"><Icon.doc /></span><span>Google Doc: <a href={job.doc_url} target="_blank" rel="noopener noreferrer">open in Google Docs</a></span></div>}

      {(job.script || (!busy && !["awaiting_input", "failed"].includes(job.status))) && (wide ? (
        <div className={`room ${job.script?.scenes?.length ? "" : "no-nav"}`}>
          {!!job.script?.scenes?.length && <SceneNav scenes={job.script.scenes} doc={docRef} />}
          <div className="room-paper">{panel("script")}</div>
          {tabs.length > 0 && (
            <aside className="inspector">
              <div className="tabs" role="tablist">
                {tabs.map((t) => (
                  <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
                    {t.label}{t.count ? <span className="badge count">{t.count}</span> : null}</button>))}
              </div>
              <div className="inspector-body" key={active}>{panel(active)}</div>
            </aside>
          )}
        </div>
      ) : (
        <>
          <div className="tabs sticky-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
                {t.label}{t.count ? <span className="badge count">{t.count}</span> : null}</button>))}
          </div>
          <div className="mobile-panel" key={active}>{panel(active)}</div>
        </>
      ))}

      {modal === "revise" && <ReviseModal engine={job.inputs.engine} onClose={() => setModal(null)}
        onSubmit={(feedback) => rerun("revise", { feedback }, job.inputs.engine === "auto" ? "Revising… this takes a minute or two." : `Revision prompt ready — copy it into ${ENGINE_NAME[job.inputs.engine]}.`)} />}
      {modal === "approve" && <ApproveModal blockers={blockers} findings={openFindings.length} admin={!!user?.admin} onClose={() => setModal(null)}
        onSubmit={(body) => act("approve", () => api.post(`/api/jobs/${job.id}/approve`, body), "Approved and added to the house library. 🎉")} />}
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

/** Overall quality as a ring: the average of the critic's eight scores. */
function ScoreRing({ scores }: { scores: Record<string, number> }) {
  const vals = Object.values(scores);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="ring" aria-label={`Average score ${avg.toFixed(1)} of 5`}>
      <svg viewBox="0 0 64 64" width="64" height="64">
        <circle cx="32" cy="32" r={r} className="ring-bg" />
        <circle cx="32" cy="32" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - avg / 5)} />
      </svg>
      <b>{avg.toFixed(1)}</b>
    </div>
  );
}

/** For chat-written scripts (no editorial scores): a ring that reads as a checklist result. */
function CheckRing({ open }: { open: number }) {
  return (
    <div className={`ring checks ${open ? "todo" : "ok"}`} aria-label={open ? `${open} to fix` : "All checks passed"}>
      <svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r={26} className="ring-bg" /><circle cx="32" cy="32" r={26} className="ring-fg" /></svg>
      <b>{open ? open : <Icon.check />}</b>
    </div>
  );
}

/** Scene list beside the script: jumps to a scene and follows along as you scroll. */
function SceneNav({ scenes, doc }: { scenes: NonNullable<Job["script"]>["scenes"]; doc: { doc: Document; frame: HTMLIFrameElement } | null }) {
  const [active, setActive] = useState(1);
  const heads = useCallback(() => {
    if (!doc) return [] as { n: number; el: HTMLElement }[];
    return Array.from(doc.doc.querySelectorAll<HTMLElement>("p")).map((el) => ({ n: Number(/^Scene (\d+)/.exec(el.textContent || "")?.[1]), el }))
      .filter((x) => x.n > 0);
  }, [doc]);
  useEffect(() => {
    if (!doc) return;
    const onScroll = () => {
      const top = doc.frame.getBoundingClientRect().top;
      let cur = 1;
      for (const h of heads()) if (top + h.el.offsetTop < window.innerHeight * 0.4) cur = h.n;
      setActive(cur);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [doc, heads]);
  const jump = (n: number) => {
    const h = heads().find((x) => x.n === n);
    if (!h || !doc) return;
    window.scrollTo({ top: doc.frame.getBoundingClientRect().top + window.scrollY + h.el.offsetTop - 96, behavior: "smooth" });
  };
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
  return (
    <nav className="scene-nav" aria-label="Scenes">
      <div className="scene-nav-h">Scenes</div>
      {scenes.map((sc) => (
        <button key={sc.number} className={active === sc.number ? "on" : ""} onClick={() => jump(sc.number)}>
          <span className="sn">{String(sc.number).padStart(2, "0")}</span>
          <span className="grow"><b>{sc.label || `Scene ${sc.number}`}</b><small>{fmt(sc.start_sec)}–{fmt(sc.end_sec)}</small></span>
        </button>
      ))}
    </nav>
  );
}

function Progress({ job }: { job: Job }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const { plan, done, failed, current, started, details } = useMemo(() => {
    const lastRun = job.events.map((e) => e.stage).lastIndexOf("run");
    const evs: StageEvent[] = lastRun >= 0 ? job.events.slice(lastRun) : [];
    const label = evs[0]?.detail || "Full generation";
    const plan = job.inputs.engine !== "auto" ? ["product_analysis", "handoff", "qc"]
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
    <div className="production" aria-live="polite">
      <div className="production-head">
        <div className="production-orb" aria-hidden="true"><i /><i /><i /></div>
        <div className="grow">
          <div className="eyebrow">{job.status === "queued" ? "Queued" : "Writing your script"}</div>
          <h2>{job.status === "queued" ? "Starting shortly…" : STAGE[curStep || ""] || "Working…"}</h2>
          {curStep && details[curStep] && <p className="muted small">{details[curStep]}</p>}
        </div>
        <div className="clock"><b>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</b><span>elapsed</span></div>
      </div>
      <div className="track" style={{ ["--pct" as string]: `${job.status === "queued" ? 2 : pct}%` }}>
        <div className="track-fill" />
        <ol>
          {plan.map((st, n) => {
            const isDone = done.has(st) && st !== curStep;
            const cls = failed.has(st) ? "failed" : st === curStep ? "active" : isDone ? "done" : "";
            return (
              <li key={st} className={cls}>
                <span className="node">{isDone ? <Icon.check /> : String(n + 1).padStart(2, "0")}</span>
                <span className="lbl">{stageLabel(st, job)}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="hint">{job.inputs.engine === "auto" ? "Usually 2 to 5 minutes." : `Reading the product page takes a few seconds, then ${ENGINE_NAME[job.inputs.engine]} writes the script.`} You can leave this page. The script keeps going and appears in <Link to="/scripts">Scripts</Link>.</p>
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
        {busy && <Spinner />} Revise script</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>{engine === "auto"
        ? "Write notes as you would to a writer. The revision goes through the full quality review again."
        : `Write notes as you would to a writer. We'll turn them, plus any quality findings, into a revision prompt for ${ENGINE_NAME[engine]}.`}</p>
      <textarea autoFocus style={{ minHeight: 150 }} value={text} maxLength={5000} onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Open on the spill instead of the alarm. Make scene 3 dialogue less formal. Add the price on the end frame." />
    </Modal>
  );
}

function ApproveModal({ blockers, findings, admin, onClose, onSubmit }: {
  blockers: number; findings: number; admin: boolean; onClose: () => void;
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
      {findings > 0 && <div className="banner" style={{ marginBottom: 14 }}><span className="gl warn"><Icon.alert /></span><span>{findings} quality finding{findings === 1 ? " is" : "s are"} still open. You can approve anyway, or cancel and revise first.</span></div>}
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
  const engine = job.inputs.engine as "chatgpt" | "claude";
  const name = ENGINE_NAME[engine];
  const [sent, setSent] = useState(false);
  const [pluginSent, setPluginSent] = useState(false);
  const [setup, setSetup] = useState(false);
  const [gptUrl, setGpt] = useState(getGptUrl());
  const [showPrompt, setShowPrompt] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState(relay.last_error);
  const [busy, setBusy] = useState(false);
  // ChatGPT can only call ScriptStudio from a custom GPT with Actions; otherwise the full brief travels by clipboard
  const viaGpt = engine === "chatgpt" && /\/g\/g-/.test(gptUrl);
  const assisted = engine === "chatgpt" && !viaGpt;
  const ask = engine === "chatgpt" ? `@ScriptStudio write script ${relay.code}` : `Use ScriptStudio to write script ${relay.code}`;

  useEffect(() => { setError(relay.last_error); }, [relay.last_error]);

  // after the brief goes to ChatGPT by clipboard, coming back to this tab picks up the copied reply
  useEffect(() => {
    if (!assisted || !sent) return;
    const onFocus = async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (t && t !== relay.prompt && t.includes("{") && t.length > 300 && !busy) { setAnswer(t); submit(t); }
      } catch { /* permission not granted: the paste button still works */ }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // one click: the request is typed into a new chat (and copied, in case the app ignores the prefill)
  const send = async () => {
    if (assisted) {
      try { await navigator.clipboard.writeText(relay.prompt); }
      catch { setShowPrompt(true); toast("Your browser blocked copying. Copy the prompt below instead.", "error"); return; }
      window.open("https://chatgpt.com/", "_blank", "noopener");
      setSent(true);
      toast("Brief copied. In ChatGPT, paste it (Ctrl/⌘ + V) and press Enter.", "ok");
      return;
    }
    try { await navigator.clipboard.writeText(ask); } catch { /* the prefill still works */ }
    // a custom GPT link opens a chat with that GPT; a plugin's page doesn't, so plugins start a normal new chat
    const base = engine === "claude" ? "https://claude.ai/new" : /\/g\/g-/.test(gptUrl) ? gptUrl : "https://chatgpt.com/";
    window.open(`${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(ask)}`, "_blank", "noopener");
    setSent(true);
    toast(`${name} is open with the request typed in — press Enter there.`, "ok");
  };

  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(relay.prompt); toast("Full prompt copied. Paste it into a new chat.", "ok"); }
    catch {
      setShowPrompt(true);
      setTimeout(() => { const el = document.getElementById("relay-prompt"); if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); } }, 50);
      toast("Press Ctrl/⌘ + C to copy the selected prompt.");
    }
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
    <div className="handoff">
      <ChatSteps job={job} at={1} />
      <div className="handoff-main">
        <span className={`dotlogo ${engine === "claude" ? "claude" : "gpt"} handoff-logo`}>{engine === "claude" ? "C" : "G"}</span>
        <div className="grow">
          <div className="eyebrow">{relay.kind === "full" ? "Write with your plan" : `Revision · round ${relay.round}`}</div>
          <h2>{sent ? (assisted ? "Bring ChatGPT's reply back" : `Waiting for ${name}…`) : `Send this job to ${name}`}</h2>
          <p className="muted">{assisted
            ? (sent ? "When ChatGPT finishes, click the copy icon under its reply and come back to this tab. We pick it up and build the script, or use the button below."
              : "We copy the full brief and product facts, and open ChatGPT. Paste it there (Ctrl/⌘ + V) and press Enter. No plugin needed.")
            : sent ? `Press Enter in ${name}. It fetches the brief and product facts, writes the script and sends it back. This page updates by itself.`
              : `${name} opens with the request already typed. Press Enter there; the finished script appears here automatically.`}</p>
          <div className="row" style={{ marginTop: 14 }}>
            {assisted && sent
              ? <button className="btn primary lg" disabled={busy} onClick={pasteReply}>{busy ? <Spinner /> : <Icon.copy />} Paste ChatGPT's reply</button>
              : <button className="btn primary lg" onClick={send}>{sent ? <Icon.ext /> : <Icon.spark />} {sent ? `Open ${name} again` : `Send to ${name}`}</button>}
            {assisted && sent && <button className="btn ghost sm" onClick={send}><Icon.copy /> Copy the brief again</button>}
            <button className="btn ghost sm" onClick={() => setSetup(true)}>{engine === "claude" ? "First time? Connect Claude" : "Connection settings"}</button>
          </div>
          {sent && !assisted && <div className="waiting"><span className="pulse-dot" /> Listening for the script from {name}…</div>}
          {error && <div className="banner bad" style={{ marginTop: 14, marginBottom: 0 }} role="alert"><span>⚠️</span><span>{error}</span></div>}
          {engine === "chatgpt" && (
            <div className="plugin-tip">
              <span className="gl"><Icon.info /></span>
              <div>
                <b>Using the ChatGPT desktop app with the ScriptStudio plugin?</b>
                <span>Copy the request, pick <b>ScriptStudio</b> in the message box, paste and press Enter. The plugin writes and sends the script back here by itself.</span>
              </div>
              <button className="btn sm secondary" onClick={async () => {
                try { await navigator.clipboard.writeText(`write script ${relay.code}`); setPluginSent(true); toast("Request copied. Paste it into ChatGPT with ScriptStudio selected.", "ok"); }
                catch { toast(`Copy this into ChatGPT: write script ${relay.code}`); }
              }}><Icon.copy /> Copy request</button>
            </div>
          )}
          {pluginSent && <div className="waiting"><span className="pulse-dot" /> Listening for the script from the ChatGPT plugin…</div>}
          <div className="code-chip" title="The job's private code">Job code <code>{relay.code}</code></div>
        </div>
      </div>

      <details className="manual">
        <summary>No connector? Copy and paste instead</summary>
        <div className="relay-steps" style={{ marginTop: 12 }}>
          <div className="relay-step">
            <span className="n">1</span>
            <div>
              <h3>Copy the full prompt into a new {name} chat</h3>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={copyPrompt}><Icon.copy /> Copy prompt</button>
                <a className="btn sm ghost" href={ENGINE_URL[engine]} target="_blank" rel="noopener noreferrer">Open {name} <Icon.ext /></a>
                <button className="btn ghost sm" onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? "Hide" : "View"} prompt</button>
              </div>
              {showPrompt && <div id="relay-prompt" className="prompt-box">{relay.prompt}</div>}
            </div>
          </div>
          <div className="relay-step">
            <span className="n">2</span>
            <div>
              <h3>Bring the reply back</h3>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" disabled={busy} onClick={pasteReply}>{busy ? <Spinner /> : <Icon.spark />} Paste reply &amp; build script</button>
              </div>
              <textarea className="mono" style={{ marginTop: 10, minHeight: 110 }} value={answer} aria-label={`${name} reply`}
                        placeholder={'Or paste the reply here: ```json { … } ```'} onChange={(e) => setAnswer(e.target.value)}
                        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t.includes("{") && t.length > 300) { e.preventDefault(); setAnswer(t); submit(t); } }} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" disabled={busy || answer.trim().length < 2} onClick={() => submit(answer)}>Check &amp; format</button>
              </div>
            </div>
          </div>
        </div>
      </details>
      {setup && <ConnectSetup initial={engine} onClose={() => setSetup(false)} onSaved={() => setGpt(getGptUrl())} />}
    </div>
  );
}

/** The rendered document, fetched with the session (works when the API lives on another origin). */
function ScriptPreview({ jobId, onReady }: { jobId: string; onReady?: (d: { doc: Document; frame: HTMLIFrameElement }) => void }) {
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
              onReady?.({ doc: d, frame: fr });
            }} />
  );
}
