import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { buildJobBody, EMPTY, importBriefFile, loadDraft, saveDraft, validUrl } from "../brief";
import { ENGINE_NAME, hostOf, Icon, Monogram, Skeleton, Spinner, StatusBadge, timeAgo, useToast } from "../components/ui";
import { useSession } from "../session";
import type { Engine, JobInputs, JobStatus, JobSummary } from "../types";

const STEPS = [
  { title: "Share the product", text: "A product link and the client's brief, or import the brief as a .docx." },
  { title: "Facts get checked", text: "Every claim is matched to the product page. Gaps are flagged, never invented." },
  { title: "Script is written", text: "Concepts, labelled scenes, VO and on-screen text, then an editorial review." },
  { title: "Export & share", text: "One click to Word or Google Docs, in your script-sheet format." },
];
const BUCKETS: { label: string; tone: string; match: (s: JobStatus) => boolean }[] = [
  { label: "In progress", tone: "violet", match: (s) => ["queued", "running", "awaiting_input"].includes(s) },
  { label: "To review", tone: "warn", match: (s) => s === "needs_review" || s === "failed" },
  { label: "Ready", tone: "lime", match: (s) => s === "ready" },
  { label: "Approved", tone: "ok", match: (s) => s === "approved" },
];
const ENGINES: { key: Engine; logo: string; cls: string; label: string }[] = [
  { key: "auto", logo: "S", cls: "ss", label: "ScriptStudio AI" },
  { key: "chatgpt", logo: "G", cls: "gpt", label: "ChatGPT" },
  { key: "claude", logo: "C", cls: "claude", label: "Claude" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const { options, config } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<JobInputs>(() => ({ ...EMPTY, ...pick(loadDraft()) }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const set = <K extends keyof JobInputs>(k: K, v: JobInputs[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    let alive = true;
    const load = () => api.get<JobSummary[]>("/api/jobs").then((j) => alive && setJobs(j)).catch(() => alive && setJobs((x) => x ?? []));
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const plat = options!.platforms[f.platform];
  useEffect(() => {
    if (plat && !plat.durations.includes(f.duration_sec)) set("duration_sec", plat.durations.includes(30) ? 30 : plat.durations[0]);
  }, [f.platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const urlOk = validUrl(f.product_url);
  const briefOk = f.client_brief.trim().length >= 20;
  const ready = urlOk && briefOk;

  // keep the full form's draft in sync, so "More details" picks up exactly where the composer is
  const toDraft = () => saveDraft({ ...loadDraft(), ...pick(f) });

  const generate = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (!ready) { toast(!urlOk ? "Paste the full product link, starting with https://" : "Add a sentence or two of brief.", "error"); return; }
    setBusy(true);
    try {
      const job = await api.post<JobSummary>("/api/jobs", buildJobBody({ ...loadDraft(), ...pick(f) }));
      saveDraft(EMPTY);
      nav(`/scripts/${job.id}`);
    } catch (e) { toast((e as Error).message, "error"); setBusy(false); }
  };

  const importBrief = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const r = await importBriefFile(file);
      saveDraft({ ...EMPTY, engine: f.engine, ...r.fields });
      nav("/new", { state: { imported: r.recognised } });
    } catch (e) { toast((e as Error).message, "error"); setImporting(false); }
  };

  const counts = BUCKETS.map((b) => ({ ...b, n: (jobs || []).filter((j) => b.match(j.status)).length }));
  const recent = (jobs || []).slice(0, 6);

  return (
    <div className="studio">
      <section className="studio-hero">
        <div className="studio-intro">
          <div className="eyebrow"><span className="pulse-dot" /> {greeting()}</div>
          <h1 className="display">Write the ad.<br />We'll check <mark className="hl">every fact.</mark></h1>
          <p className="lede">Paste a product link and the client's brief. You get a ready-to-shoot script sheet, checked against the product page.</p>

          <form className={`composer ${touched && !ready ? "show-errors" : ""}`} onSubmit={generate} noValidate>
            <label className={`composer-url ${f.product_url && !urlOk ? "bad" : ""}`}>
              <span className="composer-ic" aria-hidden="true">🔗</span>
              <input type="url" inputMode="url" aria-label="Product link" placeholder="Paste the product link — https://brand.com/products/…"
                     value={f.product_url} onChange={(e) => set("product_url", e.target.value)} />
              {urlOk && <span className="composer-host"><Icon.check /> {hostOf(f.product_url)}</span>}
            </label>
            <textarea aria-label="Client brief" className="composer-brief" rows={3} maxLength={20000} value={f.client_brief}
                      placeholder="The brief: occasion or idea, the message, the offer, who it's for… e.g. “Karwa Chauth gifting film — husband surprises his wife with a comfort cushion after the fast.”"
                      onChange={(e) => set("client_brief", e.target.value)} />
            <div className="composer-row">
              <div className="chipset" role="radiogroup" aria-label="Platform">
                {Object.entries(options!.platforms).slice(0, 4).map(([k, p]) => (
                  <button type="button" role="radio" aria-checked={f.platform === k} key={k} className={`chip-opt ${f.platform === k ? "on" : ""}`} onClick={() => set("platform", k)}>{p.label}</button>))}
              </div>
              <div className="chipset" role="radiogroup" aria-label="Duration">
                {plat?.durations.map((d) => (
                  <button type="button" role="radio" aria-checked={f.duration_sec === d} key={d} className={`chip-opt ${f.duration_sec === d ? "on" : ""}`} onClick={() => set("duration_sec", d)}>{d}s</button>))}
              </div>
            </div>
            <div className="composer-foot">
              <div className="engine-pick" role="radiogroup" aria-label="Who writes the script">
                {ENGINES.map((e) => (
                  <button type="button" role="radio" aria-checked={f.engine === e.key} key={e.key} title={e.label}
                          className={f.engine === e.key ? "on" : ""} onClick={() => set("engine", e.key)}>
                    <span className={`dotlogo ${e.cls}`}>{e.logo}</span><span className="lbl">{e.label}</span>
                  </button>))}
              </div>
              <div className="composer-actions">
                <button type="button" className="btn ghost sm" disabled={importing} onClick={() => fileRef.current?.click()}>
                  {importing ? <Spinner /> : <Icon.upload />} Import .docx</button>
                <Link className="btn ghost sm" to="/new" onClick={toDraft}>More details</Link>
                <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : <Icon.spark />} {busy ? "Starting…" : f.engine === "auto" ? "Write script" : `Prepare for ${ENGINE_NAME[f.engine]}`}</button>
              </div>
            </div>
            <input ref={fileRef} type="file" hidden onChange={importBrief}
                   accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
          </form>
          <p className="hint composer-note">Free · {config.daily_job_limit} automatic scripts a day · press <b>N</b> anywhere for the full brief form</p>
        </div>

        <SheetPreview f={f} />
      </section>

      <section className="studio-row">
        <div className="sec-row">
          <h2 className="sec-h">On your desk</h2>
          {jobs && jobs.length > 0 && <Link to="/scripts" className="link-arrow">All scripts <Icon.arrow /></Link>}
        </div>
        <div className="counters">
          {counts.map((c) => (
            <Link key={c.label} to="/scripts" className={`counter ${c.tone}`}><b>{jobs === null ? "–" : c.n}</b><span>{c.label}</span></Link>
          ))}
        </div>
        {jobs === null ? (
          <div className="reel">{[0, 1, 2].map((i) => <Skeleton key={i} h={132} />)}</div>
        ) : jobs.length === 0 ? (
          <div className="empty-desk"><span>✍️</span><div><b>Your desk is clear.</b> Scripts you write appear here, newest first.</div></div>
        ) : (
          <div className="reel">
            {recent.map((j, n) => (
              <Link key={j.id} to={`/scripts/${j.id}`} className="reel-card" style={{ animationDelay: `${n * 50}ms` }}>
                <div className="reel-top"><Monogram text={j.brand || hostOf(j.product_url)} /><StatusBadge status={j.status} /></div>
                <b>{j.title || "Untitled (in progress)"}</b>
                <span className="muted small">{j.brand || hostOf(j.product_url)} · {j.platform} · {j.duration_sec}s</span>
                <span className="reel-time">{timeAgo(j.updated_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="studio-row">
        <h2 className="sec-h">How it works</h2>
        <ol className="flow">
          {STEPS.map((s, i) => (
            <li key={s.title}><span className="flow-n">0{i + 1}</span><b>{s.title}</b><span>{s.text}</span></li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** The composer's fields only, so the full form's other answers are never overwritten. */
function pick(f: JobInputs): Partial<JobInputs> {
  const { product_url, client_brief, platform, duration_sec, engine } = f;
  return { product_url, client_brief, platform, duration_sec, engine };
}

/** A live miniature of the script sheet you'll get, filled in as you type. */
export function SheetPreview({ f, compact }: { f: JobInputs; compact?: boolean }) {
  const { options } = useSession();
  const plat = options!.platforms[f.platform];
  const host = validUrl(f.product_url) ? hostOf(f.product_url) : "";
  const brand = f.brand_name || (host ? host.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : "");
  const rows: [string, string][] = [
    ["Model", f.creative_direction], ["Language", f.language], ["Subtitle", f.subtitles ? "Yes" : "No"],
    ["Format", plat ? `${plat.label} · ${f.duration_sec}s · ${plat.aspect}` : ""], ["Product Link", host], ["CTA", f.cta],
  ];
  const brief = f.client_brief.trim();
  return (
    <div className={`sheet ${compact ? "compact" : ""}`} aria-label="Preview of the script sheet">
      <div className="sheet-paper">
        <div className="sheet-file">{[brand || "Brand", "Product", plat ? plat.label.replace(/\s/g, "") : "", `${f.duration_sec}s`, "v1"].filter(Boolean).join("_")}</div>
        <div className="sheet-title">SCRIPT</div>
        <div className={`sheet-brand ${brand ? "filled" : ""}`}>BRAND: {brand || <i className="ph" />}</div>
        {rows.map(([k, v]) => (
          <div key={k} className={`sheet-line ${v ? "filled" : ""}`}><b>{k}:</b> {v ? <span>{v}</span> : <i className="ph" />}</div>
        ))}
        <div className={`sheet-line ${brief ? "filled" : ""}`}><b>Idea:</b> {brief ? <span className="clamp">{brief}</span> : <i className="ph long" />}</div>
        {[1, 2, 3].map((n) => (
          <div key={n} className="sheet-scene">
            <b>Scene {n}{n === 1 ? " (Hook)" : n === 3 ? " (CTA)" : ""}</b>
            <i className="ph long" /><i className="ph" />
          </div>
        ))}
      </div>
      <div className="sheet-tag"><Icon.spark /> Live preview of your script sheet</div>
    </div>
  );
}
