import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { buildJobBody, EMPTY, importBriefFile, loadDraft, saveDraft, validUrl } from "../brief";
import { DraftCard, JobCard, useJobDelete } from "../components/Cards";
import { ENGINE_NAME, greetingIST, hostOf, Icon, isMac, istStamp, PlatformIcon, Skeleton, Spinner, useMinute, useToast } from "../components/ui";
import { Draft, hasContent, listDrafts, saveNamedDraft } from "../drafts";
import { useSession } from "../session";
import type { Engine, JobInputs, JobStatus, JobSummary } from "../types";

const STEPS = [
  { icon: "🔗", title: "Share the product", text: "A product link and the client's brief, or import the brief as a .docx." },
  { icon: "🔍", title: "Facts get checked", text: "Every claim is matched to the product page. Gaps are flagged, never invented." },
  { icon: "🎬", title: "Script is written", text: "Concepts, labelled scenes, VO and on-screen text, then an editorial review." },
  { icon: "📄", title: "Export & share", text: "One click to Word or Google Docs, in your script-sheet format." },
];
const BUCKETS: { label: string; tone: string; match: (s: JobStatus) => boolean }[] = [
  { label: "In progress", tone: "violet", match: (s) => ["queued", "running", "awaiting_input"].includes(s) },
  { label: "To review", tone: "warn", match: (s) => s === "needs_review" || s === "failed" },
  { label: "Ready", tone: "lime", match: (s) => s === "ready" },
  { label: "Approved", tone: "ok", match: (s) => s === "approved" },
];
const ENGINES: { key: Engine; logo: string; cls: string; short: string; hint: string }[] = [
  { key: "auto", logo: "S", cls: "ss", short: "ScriptStudio AI", hint: "Free and fully automatic" },
  { key: "chatgpt", logo: "G", cls: "gpt", short: "ChatGPT", hint: "Uses your ChatGPT plan" },
  { key: "claude", logo: "C", cls: "claude", short: "Claude", hint: "Uses your Claude plan" },
];


export default function Home() {
  const { options, config } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const now = useMinute();
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const startNew = () => { window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => formRef.current?.querySelector<HTMLInputElement>("input[type=url]")?.focus(), 350); };
  const [f, setF] = useState<JobInputs>(() => ({ ...EMPTY, ...pick(loadDraft()) }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saved, setSaved] = useState<"" | "auto" | "draft">("");
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>(listDrafts);
  const [filter, setFilter] = useState("all");
  const { hidden, remove } = useJobDelete();
  const set = <K extends keyof JobInputs>(k: K, v: JobInputs[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    let alive = true;
    const load = () => api.get<JobSummary[]>("/api/jobs").then((j) => alive && setJobs(j)).catch(() => alive && setJobs((x) => x ?? []));
    load();
    const t = setInterval(load, 8000);
    const onDrafts = () => setDrafts(listDrafts());
    window.addEventListener("ss:drafts", onDrafts);
    return () => { alive = false; clearInterval(t); window.removeEventListener("ss:drafts", onDrafts); };
  }, []);

  // autosave the composer into the working draft (the full form picks it up too)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { saveDraft({ ...loadDraft(), ...pick(f) }); setSaved("auto"); }, 500);
    return () => clearTimeout(t);
  }, [f]);

  const plat = options!.platforms[f.platform];
  useEffect(() => {
    if (plat && !plat.durations.includes(f.duration_sec)) set("duration_sec", plat.durations.includes(30) ? 30 : plat.durations[0]);
  }, [f.platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const urlOk = validUrl(f.product_url);
  const briefOk = f.client_brief.trim().length >= 20;
  const ready = urlOk && briefOk;
  const full = () => ({ ...loadDraft(), ...pick(f) });

  const generate = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (!ready) { toast(!urlOk ? "Paste the full product link, starting with https://" : "Add a sentence or two of brief.", "error"); return; }
    setBusy(true);
    try {
      const job = await api.post<JobSummary>("/api/jobs", buildJobBody(full()));
      saveDraft(EMPTY);
      nav(`/scripts/${job.id}`);
    } catch (e) { toast((e as Error).message, "error"); setBusy(false); }
  };

  const saveAsDraft = () => {
    if (!hasContent(full())) { toast("Add a product link or a few words of brief first.", "error"); return; }
    saveNamedDraft(full());
    setSaved("draft"); setFilter("drafts");
    toast("Saved to your drafts.", "ok", { label: "Start fresh", onClick: () => { saveDraft(EMPTY); setF({ ...EMPTY, engine: f.engine }); } });
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

  const visible = (jobs || []).filter((j) => !hidden.has(j.id));
  const tabs = [{ key: "all", label: "All", n: visible.length + drafts.length, tone: "" },
    { key: "drafts", label: "Drafts", n: drafts.length, tone: "draft" },
    ...BUCKETS.map((b) => ({ key: b.label, label: b.label, n: visible.filter((j) => b.match(j.status)).length, tone: b.tone }))];
  const bucket = BUCKETS.find((b) => b.label === filter);
  const shownJobs = filter === "drafts" ? [] : visible.filter((j) => !bucket || bucket.match(j.status)).slice(0, 8);
  const shownDrafts = filter === "all" || filter === "drafts" ? drafts.slice(0, filter === "drafts" ? 12 : 3) : [];

  return (
    <div className="studio">
      <section className="studio-hero">
        <div className="studio-intro">
          <div className="hero-meta">
            <span className="eyebrow"><span className="pulse-dot" /> {greetingIST(now)}</span>
            <span className="clock-pill" title="India Standard Time">{istStamp(now)}</span>
          </div>
          <h1 className="display">Write the ad.<br />We'll check <mark className="hl">every fact.</mark></h1>
          <p className="lede">Paste a product link and the client's brief. You get a ready-to-shoot script sheet, checked against the product page.</p>

          <form ref={formRef} className={`composer ${touched && !ready ? "show-errors" : ""}`} onSubmit={generate} noValidate
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); formRef.current?.requestSubmit(); } }}>
            <label className={`composer-url ${f.product_url && !urlOk ? "bad" : ""}`}>
              <span className="composer-ic" aria-hidden="true">🔗</span>
              <input type="url" inputMode="url" aria-label="Product link" placeholder="Paste the product link — https://brand.com/products/…"
                     value={f.product_url} onChange={(e) => set("product_url", e.target.value)} />
              {urlOk && <span className="composer-host"><Icon.check /> {hostOf(f.product_url)}</span>}
            </label>
            <div className="composer-brief-wrap">
              <textarea aria-label="Client brief" className="composer-brief" rows={3} maxLength={20000} value={f.client_brief}
                        placeholder="The brief: occasion or idea, the message, the offer, who it's for… e.g. “Karwa Chauth gifting film — husband surprises his wife with a comfort cushion after the fast.”"
                        onChange={(e) => set("client_brief", e.target.value)} />
              <div className="brief-tools">
                <button type="button" className="tool-btn" disabled={importing} onClick={() => fileRef.current?.click()} title="Fill the form from a brief document">
                  {importing ? <Spinner /> : <Icon.upload />} Import .docx</button>
                <button type="button" className="tool-btn" onClick={saveAsDraft} title="Keep this brief for later"><Icon.save /> Save draft</button>
                <span className={`brief-count ${briefOk ? "ok" : ""}`}>{briefOk ? <><Icon.check /> Brief added</> : f.client_brief.trim() ? "Add a little more…" : ""}</span>
              </div>
            </div>
            <div className="composer-opts">
              <div className="opt-group">
                <span className="opt-label">Platform</span>
                <div className="chipset" role="radiogroup" aria-label="Platform">
                  {Object.entries(options!.platforms).slice(0, 4).map(([k, p]) => (
                    <button type="button" role="radio" aria-checked={f.platform === k} key={k} className={`chip-opt icon ${f.platform === k ? "on" : ""}`} onClick={() => set("platform", k)}>
                      <PlatformIcon p={p.label} size={14} />{p.label}</button>))}
                </div>
              </div>
              <div className="opt-group">
                <span className="opt-label">Length</span>
                <div className="length-seg" role="radiogroup" aria-label="Duration" style={{ ["--i" as string]: Math.max(0, plat?.durations.indexOf(f.duration_sec) ?? 0), ["--n" as string]: plat?.durations.length || 1 }}>
                  <i className="length-thumb" aria-hidden="true" />
                  {plat?.durations.map((d) => (
                    <button type="button" role="radio" aria-checked={f.duration_sec === d} key={d} className={f.duration_sec === d ? "on" : ""} onClick={() => set("duration_sec", d)}>
                      <span className="tick" style={{ width: `${Math.min(100, (d / Math.max(...(plat?.durations || [d]))) * 100)}%` }} />{d}s</button>))}
                </div>
              </div>
              <div className="opt-group">
                <span className="opt-label">Writer</span>
                <div className="writer-seg" role="radiogroup" aria-label="Who writes the script">
                  {ENGINES.map((e) => (
                    <button type="button" role="radio" aria-checked={f.engine === e.key} key={e.key} title={e.hint}
                            className={f.engine === e.key ? "on" : ""} onClick={() => set("engine", e.key)}>
                      <span className={`dotlogo ${e.cls}`}>{e.logo}</span>{e.short}
                    </button>))}
                </div>
              </div>
            </div>
            <div className="composer-foot">
              <div className="composer-actions">
                <Link className="btn ghost sm" to="/new">More details</Link>
                <button className="btn primary write-btn" disabled={busy} title={`${isMac ? "⌘" : "Ctrl"} + Enter`}>{busy ? <Spinner /> : <Icon.spark />} {busy ? "Starting…" : f.engine === "auto" ? "Write script" : `Prepare for ${ENGINE_NAME[f.engine]}`}
                  {!busy && <span className="kbd-hint">{isMac ? "⌘" : "Ctrl"} ↵</span>}</button>
              </div>
            </div>
            <input ref={fileRef} type="file" hidden onChange={importBrief}
                   accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
          </form>
          <div className="composer-note">
            <span>Free · {config.daily_job_limit} automatic scripts a day · ChatGPT &amp; Claude unlimited</span>
            {saved && <span className="saved-pill" key={saved}><Icon.check /> {saved === "draft" ? "Saved to drafts" : "Autosaved"}</span>}
          </div>
        </div>

        <SheetPreview f={f} />
      </section>

      <section className="desk">
        <div className="desk-head">
          <div>
            <h2 className="desk-title">On your desk</h2>
            <p className="muted small">{jobs === null ? "Loading…" : visible.length + drafts.length === 0 ? "Nothing yet — your scripts and drafts will appear here." : "Pick up where you left off."}</p>
          </div>
          <Link to="/scripts" className="link-arrow">All scripts <Icon.arrow /></Link>
        </div>
        <div className="desk-pills" role="tablist" aria-label="Filter">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={filter === t.key} className={`desk-pill ${t.tone} ${filter === t.key ? "on" : ""}`} onClick={() => setFilter(t.key)}>
              {t.key !== "all" && <i className="pill-dot" />}{t.label}<b>{jobs === null && t.key !== "drafts" ? "–" : t.n}</b>
            </button>
          ))}
        </div>
        {jobs === null ? (
          <div className="reel">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={150} />)}</div>
        ) : shownJobs.length + shownDrafts.length === 0 ? (
          <div className="empty-desk"><span>{filter === "drafts" ? "📝" : "✍️"}</span><div>
            <b>{filter === "drafts" ? "No saved drafts." : filter === "all" ? "Your desk is clear." : `Nothing in “${filter}”.`}</b>{" "}
            {filter === "drafts" ? "Use “Save draft” in the composer to keep a brief for later." : "Write your first script above — it appears here as it's written."}</div>
            <button className="btn sm" onClick={startNew}><Icon.plus /> New script</button></div>
        ) : (
          <div className="reel">
            {shownDrafts.map((d, n) => <DraftCard key={d.id} draft={d} delay={n * 40} />)}
            {shownJobs.map((j, n) => <JobCard key={j.id} job={j} delay={(n + shownDrafts.length) * 40} onDelete={(id) => remove([id])} />)}
            {filter === "all" && shownJobs.length + shownDrafts.length < 4 && (
              <button className="jcard ghost-card" onClick={startNew}>
                <span className="ghost-plus"><Icon.plus /></span>
                <span><b>Start a new script</b><small>Paste a link and a brief above</small></span>
              </button>
            )}
          </div>
        )}
      </section>

      <section className="journey-wrap">
        <div className="sec-row"><h2 className="sec-h">How it works</h2><span className="muted small">From link to ready-to-shoot in about 3 minutes</span></div>
        <ol className="journey">
          {STEPS.map((st, i) => (
            <li key={st.title} style={{ animationDelay: `${i * 90}ms` }}>
              <span className="j-node"><span className="j-ic" aria-hidden="true">{st.icon}</span><span className="j-n">{i + 1}</span></span>
              <b>{st.title}</b><span>{st.text}</span>
            </li>
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
