import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { label, Spinner, TagInput, useToast } from "../components/ui";
import { useSession } from "../session";
import type { JobInputs, JobSummary, Reference } from "../types";

const DRAFT_KEY = "sw:new-script-draft";

const EMPTY: JobInputs = {
  product_url: "", client_brief: "", product_copy: "", product_image_urls: [], platform: "instagram_reels",
  duration_sec: 30, creative_direction: "", references: [], hook_type: null, theme: "", target_audience: "",
  tone: "", language: "English", mandatories: [], exclusions: [], brand_name: "", format_id: "house-v1", concept_count: 3,
};

function loadDraft(): JobInputs {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") }; } catch { return EMPTY; }
}

export default function NewScript() {
  const { options } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<JobInputs>(loadDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof JobInputs>(k: K, v: JobInputs[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); } catch { /* storage unavailable */ } }, [f]);

  const plat = options?.platforms[f.platform];
  useEffect(() => {
    if (plat && !plat.durations.includes(f.duration_sec)) set("duration_sec", plat.durations.includes(30) ? 30 : plat.durations[0]);
  }, [f.platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = () => {
    const e: Record<string, string> = {};
    try { const u = new URL(f.product_url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { e.product_url = "Enter the full product page link (https://…)."; }
    if (f.client_brief.trim().length < 20) e.client_brief = "Paste the client brief (at least a couple of sentences).";
    f.product_image_urls.forEach((u) => { if (!u.startsWith("https://")) e.product_image_urls = "Image links must start with https://"; });
    f.references.forEach((r) => { if (!r.value.trim()) e.references = "Remove empty references or fill them in."; });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) { toast("Please fix the highlighted fields.", "error"); return; }
    setBusy(true);
    try {
      const body = { ...f, theme: f.theme || null, brand_name: f.brand_name || null,
        references: f.references.map((r) => ({ ...r, kind: /^https?:\/\//.test(r.value.trim()) ? "url" : "note" })) };
      const job = await api.post<JobSummary>("/api/jobs", body);
      localStorage.removeItem(DRAFT_KEY);
      nav(`/scripts/${job.id}`);
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  const hookEntries = useMemo(() => Object.entries(options?.hook_types || {}), [options]);
  if (!options) return <div className="center"><Spinner /></div>;

  return (
    <form onSubmit={submit} noValidate>
      <div className="page-head">
        <div className="grow"><h1>New script</h1>
          <div className="muted">Takes about 2–5 minutes. You can leave this page; it keeps working.</div></div>
        <button type="button" className="btn ghost" onClick={() => { setF(EMPTY); setErrors({}); }}>Clear form</button>
      </div>

      <div className="stack">
        <Section n={1} title="Product" hint="The product page is the source of truth for every product detail, claim and pack description.">
          <div className="grid2">
            <Field label="Product page link" required error={errors.product_url}>
              <input type="url" value={f.product_url} onChange={(e) => set("product_url", e.target.value)} placeholder="https://brand.com/products/…" />
            </Field>
            <Field label="Brand name" optional>
              <input type="text" value={f.brand_name || ""} onChange={(e) => set("brand_name", e.target.value)} maxLength={300} />
            </Field>
          </div>
          <details className="more" open={!!f.product_copy || f.product_image_urls.length > 0}>
            <summary>Page won't load, or want to add pack images?</summary>
            <Field label="Product copy" optional hint="Paste the product description if the page is behind a login or loads with JavaScript. Used as a secondary source.">
              <textarea value={f.product_copy} onChange={(e) => set("product_copy", e.target.value)} maxLength={20000} />
            </Field>
            <Field label="Pack image links" optional hint="Up to 4 https image links, so packaging is described from the real pack." error={errors.product_image_urls}>
              <TagInput value={f.product_image_urls} onChange={(v) => set("product_image_urls", v)} max={4} placeholder="Paste an image link and press Enter" />
            </Field>
          </details>
        </Section>

        <Section n={2} title="Client brief" hint="Objective, key message, tone and expected outcome come from here.">
          <Field label="Brief" required error={errors.client_brief}>
            <textarea style={{ minHeight: 140 }} value={f.client_brief} onChange={(e) => set("client_brief", e.target.value)}
                      maxLength={20000} placeholder="Paste the client brief: objective, audience, key message, tone, deliverables…" />
          </Field>
          <div className="grid3">
            <Field label="Target audience" optional>
              <input type="text" value={f.target_audience} onChange={(e) => set("target_audience", e.target.value)} placeholder="e.g. Working women 25–34, metros" />
            </Field>
            <Field label="Tone" optional>
              <input type="text" value={f.tone} onChange={(e) => set("tone", e.target.value)} placeholder="e.g. witty, warm" maxLength={300} />
            </Field>
            <Field label="Language">
              <select value={f.language} onChange={(e) => set("language", e.target.value)}>
                {options.languages.map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid2">
            <Field label="Mandatories" optional hint="Exact lines, legal supers, hashtags. Included verbatim.">
              <TagInput value={f.mandatories} onChange={(v) => set("mandatories", v)} placeholder="Type and press Enter" />
            </Field>
            <Field label="Exclusions" optional hint="Words, claims or visuals the client has ruled out.">
              <TagInput value={f.exclusions} onChange={(v) => set("exclusions", v)} max={30} placeholder="Type and press Enter" />
            </Field>
          </div>
        </Section>

        <Section n={3} title="Creative" hint="Optional. Leave blank and the creative director stage picks the strongest approach.">
          <Field label="Hook type" optional>
            <div className="hook-grid">
              <button type="button" className={`hook ${!f.hook_type ? "on" : ""}`} onClick={() => set("hook_type", null)}>
                <b>Let the system choose</b>Best hook per concept</button>
              {hookEntries.map(([k, d]) => (
                <button type="button" key={k} title={d} className={`hook ${f.hook_type === k ? "on" : ""}`} onClick={() => set("hook_type", k)}>
                  <b>{label(k)}</b>{d.split(/\.\s/)[0]}</button>
              ))}
            </div>
          </Field>
          <div className="grid2">
            <Field label="Theme" optional>
              <input type="text" value={f.theme || ""} onChange={(e) => set("theme", e.target.value)} placeholder="e.g. Monday mornings, festive gifting" maxLength={300} />
            </Field>
            <Field label="Creative direction" optional>
              <input type="text" value={f.creative_direction} onChange={(e) => set("creative_direction", e.target.value)} placeholder="e.g. creator-led, single location, no voiceover" />
            </Field>
          </div>
          <Field label="References" optional hint="Links or notes. Say what to take from each; video links can't be watched." error={errors.references}>
            <RefsEditor value={f.references} onChange={(v) => set("references", v)} />
          </Field>
        </Section>

        <Section n={4} title="Platform & format">
          <div className="grid2">
            <Field label="Platform">
              <div className="seg">{Object.entries(options.platforms).map(([k, p]) => (
                <button type="button" key={k} className={f.platform === k ? "on" : ""} onClick={() => set("platform", k)}>{p.label}</button>))}
              </div>
            </Field>
            <Field label="Duration">
              <div className="seg">{plat?.durations.map((d) => (
                <button type="button" key={d} className={f.duration_sec === d ? "on" : ""} onClick={() => set("duration_sec", d)}>{d}s</button>))}
              </div>
            </Field>
          </div>
          {plat && <p className="hint" style={{ marginTop: 8 }}>{plat.aspect} · hook must land in {plat.hook_window_sec}s · {plat.notes}</p>}
          <div className="grid2">
            <Field label="Concepts to explore">
              <div className="seg">{[1, 2, 3, 4].map((n) => (
                <button type="button" key={n} className={f.concept_count === n ? "on" : ""} onClick={() => set("concept_count", n)}>{n}</button>))}
              </div>
            </Field>
            <Field label="Script format">
              <select value={f.format_id} onChange={(e) => set("format_id", e.target.value)}>
                {options.formats.map((x) => <option key={x.id} value={x.id}>{x.name} (v{x.version})</option>)}
              </select>
            </Field>
          </div>
        </Section>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn lg" disabled={busy}>{busy ? <Spinner /> : null} Generate script</button>
        </div>
      </div>
    </form>
  );
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="section-title"><span className="num">{n}</span><h2>{title}</h2></div>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function Field({ label: l, required, optional, hint, error, children }: {
  label: string; required?: boolean; optional?: boolean; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="field">
      <span>{l}{required && " *"}{optional && <em> · optional</em>}</span>
      {children}
      {hint && <div className="hint" style={{ margin: "4px 0 0" }}>{hint}</div>}
      {error && <div className="err">{error}</div>}
    </div>
  );
}

function RefsEditor({ value, onChange }: { value: Reference[]; onChange: (v: Reference[]) => void }) {
  const upd = (i: number, k: keyof Reference, v: string) => onChange(value.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {value.map((r, i) => (
        <div key={i} className="row" style={{ alignItems: "stretch" }}>
          <input type="text" style={{ flex: 2, minWidth: 200 }} value={r.value} onChange={(e) => upd(i, "value", e.target.value)} placeholder="Link or description" maxLength={2000} />
          <input type="text" style={{ flex: 1, minWidth: 160 }} value={r.what_to_take} onChange={(e) => upd(i, "what_to_take", e.target.value)} placeholder="What to take (pacing, tone…)" maxLength={500} />
          <button type="button" className="btn ghost" aria-label="Remove reference" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {value.length < 8 && (
        <div><button type="button" className="btn secondary" onClick={() => onChange([...value, { kind: "note", value: "", what_to_take: "" }])}>+ Add reference</button></div>
      )}
    </div>
  );
}
