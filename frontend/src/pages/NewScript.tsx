import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { clearDraft, EMPTY, importBriefFile, loadDraft, saveDraft, validUrl } from "../brief";
import { ENGINE_NAME, hostOf, Icon, label, Spinner, TagInput, useToast } from "../components/ui";
import { useSession } from "../session";
import type { Engine, JobInputs, JobSummary, Reference } from "../types";

const ENGINES: { key: Engine; logo: string; cls: string; hint: string }[] = [
  { key: "auto", logo: "S", cls: "ss", hint: "Free and fully automatic — concepts, script and an editorial review in 3–6 minutes." },
  { key: "chatgpt", logo: "G", cls: "gpt", hint: "Uses your ChatGPT plan: copy one prompt into ChatGPT, paste the reply back." },
  { key: "claude", logo: "C", cls: "claude", hint: "Uses your Claude plan: copy one prompt into Claude, paste the reply back." },
];
const AD_TYPES = ["Video", "UGC video", "Product demo", "Testimonial", "Unboxing", "Explainer", "Lifestyle film"];
const DESIGN_STYLES = ["Creator / UGC", "Lifestyle", "Premium studio", "Minimal product", "Documentary", "Animated / motion"];
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i;

const optUrl = (u: string) => !u.trim() || validUrl(u);

/** If the free-text brief is thin, build one from the structured fields so the writer has everything. */
function composeBrief(f: JobInputs): string {
  const text = f.client_brief.trim();
  if (text.length >= 60) return text;
  const lines = [
    f.brand_name && `Brand: ${f.brand_name}`, f.target_audience && `Primary audience: ${f.target_audience}`,
    f.creative_direction && `Creator direction: ${f.creative_direction}`, `Ad type: ${f.ad_type}`,
    f.headline_ideas.length && `Headline ideas: ${f.headline_ideas.join("; ")}`,
    f.key_usps.length && `Key USPs: ${f.key_usps.join("; ")}`, f.offer && `Offer: ${f.offer}`, f.cta && `CTA: ${f.cta}`,
    f.tone && `Tone: ${f.tone}`, f.design_style && `Design style: ${f.design_style}`,
    f.elements_to_highlight.length && `Elements to highlight: ${f.elements_to_highlight.join("; ")}`,
  ].filter(Boolean);
  return [text, lines.length > 1 ? `Brief details:\n${lines.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

export default function NewScript() {
  const { options } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  // quick start from the home page: ?url=…&engine=…
  const [f, setF] = useState<JobInputs>(() => {
    const d = loadDraft(); const url = params.get("url"); const engine = params.get("engine") as Engine | null;
    return { ...d, ...(url ? { product_url: url } : {}), ...(engine && ["auto", "chatgpt", "claude"].includes(engine) ? { engine } : {}) };
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string[]>(() => (loc.state as { imported?: string[] } | null)?.imported || []);
  useEffect(() => { if (params.size) setParams({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [showCopy, setShowCopy] = useState(() => !!f.product_copy);
  const set = <K extends keyof JobInputs>(k: K, v: JobInputs[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => saveDraft(f), [f]);

  const plat = options!.platforms[f.platform];
  useEffect(() => {
    if (plat && !plat.durations.includes(f.duration_sec)) set("duration_sec", plat.durations.includes(30) ? 30 : plat.durations[0]);
  }, [f.platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const composed = useMemo(() => composeBrief(f), [f]);
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!validUrl(f.product_url)) e.product_url = "Paste the full product page link, starting with https://";
    if (composed.trim().length < 20) e.client_brief = "Add the brief or creative direction — a couple of sentences is enough.";
    if (!optUrl(f.logo_url)) e.logo_url = "Use a full link starting with https://";
    if (!optUrl(f.brand_guidelines_url)) e.brand_guidelines_url = "Use a full link starting with https://";
    if (f.asset_links.some((u) => !validUrl(u))) e.asset_links = "Each product image/video link must start with https://";
    if (f.references.some((r) => !r.value.trim())) e.references = "Fill in or remove empty references.";
    return e;
  }, [f, composed]);
  const show = (k: string) => (touched[k] || touched._submit) && errors[k];
  const ready = !errors.product_url && !errors.client_brief;
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  const importBrief = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const r = await importBriefFile(file);
      setF((x) => ({ ...x, ...r.fields }));
      setImported(r.recognised);
      toast(`Brief imported — ${r.recognised.length} field${r.recognised.length === 1 ? "" : "s"} filled. Check and add anything missing.`, "ok");
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setImporting(false); }
  };

  const submit = async (ev?: FormEvent) => {
    ev?.preventDefault();
    setTouched((t) => ({ ...t, _submit: true }));
    const keys = Object.keys(errors);
    if (keys.length) {
      document.querySelector(`[data-field="${keys[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Please complete the highlighted fields.", "error");
      return;
    }
    setBusy(true);
    try {
      const images = f.asset_links.filter((u) => IMAGE_RE.test(u));
      const body = { ...f, product_url: f.product_url.trim(), client_brief: composed, theme: f.theme || null, brand_name: f.brand_name || null,
        product_image_urls: Array.from(new Set([...f.product_image_urls, ...images])).filter((u) => u.startsWith("https://")).slice(0, 4),
        references: f.references.map((r) => ({ ...r, kind: /^https?:\/\//.test(r.value.trim()) ? "url" : "note" })) };
      const job = await api.post<JobSummary>("/api/jobs", body);
      clearDraft();
      nav(`/scripts/${job.id}`);
    } catch (e) { toast((e as Error).message, "error"); setBusy(false); }
  };

  const cta = f.engine === "auto" ? "Generate script" : `Prepare ${ENGINE_NAME[f.engine]} prompt`;
  const engine = ENGINES.find((e) => e.key === f.engine)!;

  return (
    <form onSubmit={submit} noValidate>
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow"><Icon.spark /> Creative brief → script</div>
          <h1>New script</h1>
          <p>Fill in the brief, or import your brief document. Only the product link and direction are required.</p>
        </div>
        <div className="row">
          <input ref={fileRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={importBrief} />
          <button type="button" className="btn" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? <Spinner /> : <Icon.upload />} Import brief (.docx)</button>
          <button type="button" className="btn ghost" onClick={() => { setF(EMPTY); setTouched({}); setImported([]); }}>Reset</button>
        </div>
      </div>
      {imported.length > 0 && (
        <div className="banner ok"><span>✓</span><span>Imported from your brief: {imported.slice(0, 8).join(", ")}{imported.length > 8 ? "…" : ""}. Review the fields below.</span></div>
      )}

      <div className="compose">
        <div className="form">
          <div className="writer">
            <div className="writer-label">Written by</div>
            <div className="seg" role="radiogroup" aria-label="Who writes the script">
              {ENGINES.map((e) => (
                <button type="button" role="radio" aria-checked={f.engine === e.key} key={e.key}
                        className={f.engine === e.key ? "on" : ""} onClick={() => set("engine", e.key)}>
                  <span className={`dotlogo ${e.cls}`}>{e.logo}</span>{e.key === "auto" ? "ScriptStudio AI" : `Your ${ENGINE_NAME[e.key]}`}
                  {e.key === "auto" && <span className="free">Free</span>}
                </button>
              ))}
            </div>
            <p className="hint">{engine.hint}</p>
          </div>

          <Section n={1} title="Basic Information" done={!errors.product_url}>
            <div className="grid2">
              <Field id="product_url" label="Product Link" required error={show("product_url")}>
                <input id="product_url" type="url" inputMode="url" value={f.product_url} className={show("product_url") ? "invalid" : ""}
                       placeholder="https://brand.com/products/…" onChange={(e) => set("product_url", e.target.value)} onBlur={blur("product_url")} />
              </Field>
              <Field id="brand_name" label="Brand">
                <input id="brand_name" type="text" value={f.brand_name || ""} maxLength={300} placeholder="Detected from the page if empty"
                       onChange={(e) => set("brand_name", e.target.value)} />
              </Field>
              <Field id="logo_url" label="Logo Image" error={show("logo_url")}>
                <input id="logo_url" type="url" value={f.logo_url} placeholder="Link to the logo" onChange={(e) => set("logo_url", e.target.value)} onBlur={blur("logo_url")} />
              </Field>
              <Field id="brand_guidelines_url" label="Color Palette or Brand Guidelines Link" error={show("brand_guidelines_url")}>
                <input id="brand_guidelines_url" type="url" value={f.brand_guidelines_url} placeholder="https://…" onChange={(e) => set("brand_guidelines_url", e.target.value)} onBlur={blur("brand_guidelines_url")} />
              </Field>
            </div>
            <Field id="asset_links" label="Raw/Clicked Product Link (Images/Videos)" error={show("asset_links")}
                   hint="Image links also help describe the real pack accurately.">
              <TagInput id="asset_links" value={f.asset_links} onChange={(v) => set("asset_links", v)} max={10} placeholder="Paste a link and press Enter" />
            </Field>
            {!showCopy ? <button type="button" className="toggle-link" onClick={() => setShowCopy(true)}>+ Product page won't load? Paste the product copy</button> : (
              <Field id="product_copy" label="Product Copy" hint="Used alongside the page so every claim can still be checked.">
                <textarea id="product_copy" className="short" value={f.product_copy} maxLength={20000} onChange={(e) => set("product_copy", e.target.value)} />
              </Field>
            )}
          </Section>

          <Section n={2} title="Targeting & Audience">
            <div className="grid2">
              <Field id="target_audience" label="Primary Audience" hint="Age, location, interests">
                <input id="target_audience" type="text" value={f.target_audience} maxLength={1000} placeholder="e.g. Working women 25–34, metros" onChange={(e) => set("target_audience", e.target.value)} />
              </Field>
              <Field id="language" label="Creative Language">
                <select id="language" value={f.language} onChange={(e) => set("language", e.target.value)}>
                  {Array.from(new Set([...options!.languages, f.language])).map((l) => <option key={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            <Field id="creative_direction" label="Creator Direction">
              <input id="creative_direction" type="text" value={f.creative_direction} maxLength={5000} placeholder="e.g. Female creator, 25, home setting, natural light" onChange={(e) => set("creative_direction", e.target.value)} />
            </Field>
          </Section>

          <Section n={3} title="Ad Format & Specifications" done>
            <Field label="Platform">
              <div className="options" role="radiogroup" aria-label="Platform">
                {Object.entries(options!.platforms).map(([k, p]) => (
                  <button type="button" role="radio" aria-checked={f.platform === k} key={k} className={`opt ${f.platform === k ? "on" : ""}`} onClick={() => set("platform", k)}>{p.label}</button>))}
              </div>
            </Field>
            <div className="grid2">
              <Field label="Ad Type">
                <div className="options">{AD_TYPES.map((t) => (
                  <button type="button" key={t} className={`opt sm ${f.ad_type === t ? "on" : ""}`} onClick={() => set("ad_type", t)}>{t}</button>))}
                  {!AD_TYPES.includes(f.ad_type) && f.ad_type && <button type="button" className="opt sm on">{f.ad_type}</button>}
                </div>
              </Field>
              <Field label="Duration">
                <div className="options" role="radiogroup" aria-label="Duration">
                  {plat?.durations.map((d) => (
                    <button type="button" role="radio" aria-checked={f.duration_sec === d} key={d} className={`opt sm ${f.duration_sec === d ? "on" : ""}`} onClick={() => set("duration_sec", d)}>{d}s</button>))}
                </div>
              </Field>
            </div>
            {plat && <p className="hint">{plat.aspect} · hook lands within {plat.hook_window_sec}s · {plat.notes}</p>}
          </Section>

          <Section n={4} title="Messaging & Copy">
            <div className="grid2">
              <Field id="headline_ideas" label="Headline Options">
                <TagInput id="headline_ideas" value={f.headline_ideas} onChange={(v) => set("headline_ideas", v)} max={10} placeholder="Optional — we'll suggest some" />
              </Field>
              <Field id="key_usps" label="Key USPs (Unique Selling Points)">
                <TagInput id="key_usps" value={f.key_usps} onChange={(v) => set("key_usps", v)} placeholder="Type a USP and press Enter" />
              </Field>
              <Field id="offer" label="Offer">
                <input id="offer" type="text" value={f.offer} maxLength={300} placeholder="e.g. Flat 10% off first order" onChange={(e) => set("offer", e.target.value)} />
              </Field>
              <Field id="cta" label="Call-To-Action (CTA)">
                <input id="cta" type="text" value={f.cta} maxLength={300} placeholder="e.g. Shop now on brand.com" onChange={(e) => set("cta", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section n={5} title="Creative Direction" done={!errors.client_brief}>
            <Field id="client_brief" label="Brief / Highlight Creative Direction" required error={show("client_brief")}
                   extra={<span className="counter">{f.client_brief.length.toLocaleString()} / 20,000</span>}>
              <textarea id="client_brief" style={{ minHeight: 130 }} value={f.client_brief} maxLength={20000} className={show("client_brief") ? "invalid" : ""}
                        placeholder="Objective, the story you want, key message, what success looks like…"
                        onChange={(e) => set("client_brief", e.target.value)} onBlur={blur("client_brief")} />
            </Field>
            <div className="grid2">
              <Field id="tone" label="Tone">
                <input id="tone" type="text" value={f.tone} maxLength={300} placeholder="e.g. witty, warm, premium" onChange={(e) => set("tone", e.target.value)} />
              </Field>
              <Field id="theme" label="Theme">
                <input id="theme" type="text" value={f.theme || ""} maxLength={300} placeholder="e.g. Monday mornings" onChange={(e) => set("theme", e.target.value)} />
              </Field>
            </div>
            <Field label="Hook Type">
              <div className="options">
                <button type="button" className={`opt sm ${!f.hook_type ? "on" : ""}`} onClick={() => set("hook_type", null)}>Auto</button>
                {Object.keys(options!.hook_types).map((k) => (
                  <button type="button" key={k} title={options!.hook_types[k]} className={`opt sm ${f.hook_type === k ? "on" : ""}`} onClick={() => set("hook_type", k)}>
                    <span style={{ textTransform: k === "pov" ? "none" : "capitalize" }}>{label(k)}</span></button>))}
              </div>
              {f.hook_type && <p className="hint">{options!.hook_types[f.hook_type]}</p>}
            </Field>
            <div className="grid2">
              <Field id="mandatories" label="Must Include" hint="Exact lines, legal supers, hashtags — used word for word.">
                <TagInput id="mandatories" value={f.mandatories} onChange={(v) => set("mandatories", v)} placeholder="Type and press Enter" />
              </Field>
              <Field id="exclusions" label="Avoid" hint="Words, claims or visuals the client has ruled out.">
                <TagInput id="exclusions" value={f.exclusions} onChange={(v) => set("exclusions", v)} max={30} placeholder="Type and press Enter" />
              </Field>
            </div>
          </Section>

          <Section n={6} title="Visual Direction">
            <Field label="Design Style">
              <div className="options">{DESIGN_STYLES.map((d) => (
                <button type="button" key={d} className={`opt sm ${f.design_style === d ? "on" : ""}`} onClick={() => set("design_style", f.design_style === d ? "" : d)}>{d}</button>))}
                {f.design_style && !DESIGN_STYLES.includes(f.design_style) && <button type="button" className="opt sm on" onClick={() => set("design_style", "")}>{f.design_style}</button>}
              </div>
            </Field>
            <Field id="elements_to_highlight" label="Elements to Highlight" hint="Product, benefits, lifestyle shots…">
              <TagInput id="elements_to_highlight" value={f.elements_to_highlight} onChange={(v) => set("elements_to_highlight", v)} placeholder="e.g. Pour shot — press Enter" />
            </Field>
            <Field id="references" label="Reference Links" error={show("references") || ""} hint="Video links are read by title only, so say what to borrow.">
              <RefsEditor value={f.references} onChange={(v) => set("references", v)} />
            </Field>
            <div className="grid2">
              <Field label="Concepts to Explore">
                <div className="options">{[1, 2, 3, 4].map((n) => (
                  <button type="button" key={n} className={`opt sm ${f.concept_count === n ? "on" : ""}`} onClick={() => set("concept_count", n)}>{n}</button>))}
                </div>
              </Field>
              <Field id="format_id" label="Script Format">
                <select id="format_id" value={f.format_id} onChange={(e) => set("format_id", e.target.value)}>
                  {options!.formats.map((x) => <option key={x.id} value={x.id}>{x.name} (v{x.version})</option>)}
                </select>
              </Field>
            </div>
          </Section>
        </div>

        <aside className="summary" aria-label="Summary">
          <div className="summary-card">
            <h2>Summary</h2>
            <dl>
              <dt>Written by</dt><dd>{ENGINE_NAME[f.engine]}</dd>
              <dt>Brand</dt><dd>{f.brand_name || (validUrl(f.product_url) ? hostOf(f.product_url) : "—")}</dd>
              <dt>Platform</dt><dd>{plat?.label}</dd>
              <dt>Format</dt><dd>{f.ad_type} · {f.duration_sec}s · {plat?.aspect}</dd>
              <dt>Hook</dt><dd style={{ textTransform: "capitalize" }}>{f.hook_type ? label(f.hook_type) : "Auto"}</dd>
            </dl>
            <ul className="checklist">
              <li className={!errors.product_url ? "ok" : ""}><span className="tick">✓</span>Product link</li>
              <li className={!errors.client_brief ? "ok" : ""}><span className="tick">✓</span>Brief / direction</li>
              <li className={f.target_audience ? "ok" : ""}><span className="tick">✓</span>Audience <em>optional</em></li>
              <li className={f.key_usps.length || f.offer || f.cta ? "ok" : ""}><span className="tick">✓</span>Messaging <em>optional</em></li>
            </ul>
            <button className="btn primary lg block" disabled={busy}>{busy && <Spinner />}{busy ? "Starting…" : cta}</button>
            <p className="hint" style={{ textAlign: "center", marginTop: 10 }}>{f.engine === "auto" ? "Takes 3–6 minutes. You can leave the page." : `Next: paste one prompt into ${ENGINE_NAME[f.engine]}.`}</p>
          </div>
        </aside>
      </div>

      <div className="mobile-cta">
        <div className="grow">{ready ? `${ENGINE_NAME[f.engine]} · ${plat?.label} · ${f.duration_sec}s` : "Add a product link and brief to continue"}</div>
        <button className="btn primary" disabled={busy}>{busy && <Spinner />}{busy ? "Starting…" : f.engine === "auto" ? "Generate" : "Prepare prompt"}</button>
      </div>
    </form>
  );
}

function Section({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="form-section">
      <h2 className="sec-title"><span className={`num ${done ? "done" : ""}`}>{done ? "✓" : n}</span>{title}</h2>
      {children}
    </section>
  );
}

function Field({ id, label: l, required, hint, error, extra, children }: {
  id?: string; label: string; required?: boolean; hint?: string; error?: string | false; extra?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="field" data-field={id}>
      <label className="label" htmlFor={id}>
        <span style={{ flex: 1 }}>{l}{required && <span className="req"> *</span>}</span>{extra}
      </label>
      {children}
      {error ? <div className="err" role="alert">{error}</div> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function RefsEditor({ value, onChange }: { value: Reference[]; onChange: (v: Reference[]) => void }) {
  const upd = (i: number, k: keyof Reference, v: string) => onChange(value.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="stack-sm">
      {value.map((r, i) => (
        <div key={i} className="row" style={{ alignItems: "stretch", flexWrap: "nowrap" }}>
          <div className="grid2" style={{ flex: 1, gap: 8 }}>
            <input type="text" value={r.value} aria-label={`Reference ${i + 1}`} onChange={(e) => upd(i, "value", e.target.value)} placeholder="Link or description" maxLength={2000} />
            <input type="text" value={r.what_to_take} aria-label={`What to take from reference ${i + 1}`} onChange={(e) => upd(i, "what_to_take", e.target.value)} placeholder="What to borrow: pacing, tone…" maxLength={500} />
          </div>
          <button type="button" className="btn ghost icon" aria-label="Remove reference" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {value.length < 8 && <div><button type="button" className="btn sm" onClick={() => onChange([...value, { kind: "note", value: "", what_to_take: "" }])}>+ Add reference</button></div>}
    </div>
  );
}
