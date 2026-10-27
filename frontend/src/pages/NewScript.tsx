import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { hostOf, label, Spinner, TagInput, useToast } from "../components/ui";
import { useSession } from "../session";
import type { JobInputs, JobSummary, Reference } from "../types";

const DRAFT_KEY = "ss:new-script-draft";

const EMPTY: JobInputs = {
  product_url: "", client_brief: "", product_copy: "", product_image_urls: [], platform: "instagram_reels",
  duration_sec: 30, creative_direction: "", references: [], hook_type: null, theme: "", target_audience: "",
  tone: "", language: "English", mandatories: [], exclusions: [], brand_name: "", format_id: "house-v1", concept_count: 3,
};

const BRIEF_TEMPLATE = `Objective: (e.g. drive first purchase / launch awareness / app installs)
Audience: (who they are, what they care about)
Key message: (the one thing viewers must remember)
Tone: (e.g. witty, warm, premium)
Must include: (offers, legal lines, hashtags)
Avoid: (claims, words or visuals the brand doesn't want)
Deliverable: (platform, length, number of variants)`;

function loadDraft(): JobInputs {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") }; } catch { return EMPTY; }
}

function validUrl(u: string) {
  try { const x = new URL(u.trim()); return /^https?:$/.test(x.protocol) && x.hostname.includes("."); } catch { return false; }
}

export default function NewScript() {
  const { options } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<JobInputs>(loadDraft);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [showProductExtra, setShowProductExtra] = useState(() => !!(f.product_copy || f.product_image_urls.length));
  const [showCreative, setShowCreative] = useState(() => !!(f.hook_type || f.theme || f.creative_direction || f.references.length));
  const set = <K extends keyof JobInputs>(k: K, v: JobInputs[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); } catch { /* storage unavailable */ } }, [f]);

  const plat = options!.platforms[f.platform];
  useEffect(() => {
    if (plat && !plat.durations.includes(f.duration_sec)) set("duration_sec", plat.durations.includes(30) ? 30 : plat.durations[0]);
  }, [f.platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!validUrl(f.product_url)) e.product_url = "Paste the full product page link, starting with https://";
    if (f.client_brief.trim().length < 20) e.client_brief = "Add the client brief — at least a couple of sentences.";
    if (f.product_image_urls.some((u) => !u.startsWith("https://"))) e.product_image_urls = "Image links must start with https://";
    if (f.references.some((r) => !r.value.trim())) e.references = "Fill in or remove empty references.";
    return e;
  }, [f]);
  const show = (k: string) => (touched[k] || touched._submit) && errors[k];
  const ready = !errors.product_url && !errors.client_brief;

  const submit = async (ev?: FormEvent) => {
    ev?.preventDefault();
    setTouched((t) => ({ ...t, _submit: true }));
    if (Object.keys(errors).length) {
      const first = document.querySelector(`[data-field="${Object.keys(errors)[0]}"]`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Please complete the highlighted fields.", "error");
      return;
    }
    setBusy(true);
    try {
      const body = { ...f, product_url: f.product_url.trim(), theme: f.theme || null, brand_name: f.brand_name || null,
        references: f.references.map((r) => ({ ...r, kind: /^https?:\/\//.test(r.value.trim()) ? "url" : "note" })) };
      const job = await api.post<JobSummary>("/api/jobs", body);
      localStorage.removeItem(DRAFT_KEY);
      nav(`/scripts/${job.id}`);
    } catch (e) { toast((e as Error).message, "error"); setBusy(false); }
  };

  const hookEntries = Object.entries(options!.hook_types);
  const optionalCount = [f.hook_type, f.theme, f.creative_direction, f.references.length, f.mandatories.length, f.exclusions.length].filter(Boolean).length;

  return (
    <form onSubmit={submit} noValidate>
      <div className="page-head">
        <div className="grow">
          <h1>New script</h1>
          <p>Add a product link and the client brief. Everything else is optional.</p>
        </div>
        <button type="button" className="btn ghost" onClick={() => { setF(EMPTY); setTouched({}); }}>Reset</button>
      </div>

      <div className="compose">
        <div className="stack">
          <Section n={1} title="Product" done={!errors.product_url}
                   hint="The product page is the source of truth for every product detail, claim and pack description.">
            <div className="grid2">
              <Field id="product_url" label="Product page link" required error={show("product_url")}>
                <input id="product_url" type="url" inputMode="url" autoComplete="url" value={f.product_url}
                       className={show("product_url") ? "invalid" : ""} placeholder="https://brand.com/products/…"
                       onChange={(e) => set("product_url", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, product_url: true }))} />
              </Field>
              <Field id="brand_name" label="Brand name" optional>
                <input id="brand_name" type="text" value={f.brand_name || ""} maxLength={300} placeholder="Detected from the page if empty"
                       onChange={(e) => set("brand_name", e.target.value)} />
              </Field>
            </div>
            {!showProductExtra ? (
              <button type="button" className="toggle-link" onClick={() => setShowProductExtra(true)}>+ Page won't load, or want to add pack images?</button>
            ) : (
              <>
                <Field id="product_copy" label="Product copy" optional hint="Paste the product description if the page needs a login or loads slowly. Used alongside the page.">
                  <textarea id="product_copy" className="short" value={f.product_copy} maxLength={20000} onChange={(e) => set("product_copy", e.target.value)} />
                </Field>
                <Field id="product_image_urls" label="Pack image links" optional error={show("product_image_urls") || ""}
                       hint="Up to 4 image links (https). Lets the script describe the real pack.">
                  <TagInput id="product_image_urls" value={f.product_image_urls} onChange={(v) => set("product_image_urls", v)} max={4} placeholder="Paste an image link and press Enter" />
                </Field>
              </>
            )}
          </Section>

          <Section n={2} title="Client brief" done={!errors.client_brief} hint="Objective, key message, tone and expected outcome come from here.">
            <Field id="client_brief" label="Brief" required error={show("client_brief")}
                   extra={<span className="counter">{f.client_brief.length.toLocaleString()} / 20,000</span>}>
              <textarea id="client_brief" style={{ minHeight: 160 }} value={f.client_brief} maxLength={20000}
                        className={show("client_brief") ? "invalid" : ""}
                        placeholder="Paste the client brief: objective, audience, key message, tone, must-haves…"
                        onChange={(e) => set("client_brief", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, client_brief: true }))} />
            </Field>
            {!f.client_brief && <button type="button" className="toggle-link" onClick={() => set("client_brief", BRIEF_TEMPLATE)}>Use a brief template</button>}
            <div className="grid3">
              <Field id="target_audience" label="Audience" optional>
                <input id="target_audience" type="text" value={f.target_audience} maxLength={1000} placeholder="e.g. Women 25–34, metros" onChange={(e) => set("target_audience", e.target.value)} />
              </Field>
              <Field id="tone" label="Tone" optional>
                <input id="tone" type="text" value={f.tone} maxLength={300} placeholder="e.g. witty, warm" onChange={(e) => set("tone", e.target.value)} />
              </Field>
              <Field id="language" label="Language">
                <select id="language" value={f.language} onChange={(e) => set("language", e.target.value)}>
                  {options!.languages.map((l) => <option key={l}>{l}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section n={3} title="Platform & length" done>
            <Field label="Platform">
              <div className="options" role="radiogroup" aria-label="Platform">
                {Object.entries(options!.platforms).map(([k, p]) => (
                  <button type="button" role="radio" aria-checked={f.platform === k} key={k} className={`opt ${f.platform === k ? "on" : ""}`} onClick={() => set("platform", k)}>{p.label}</button>))}
              </div>
            </Field>
            <Field label="Duration">
              <div className="options" role="radiogroup" aria-label="Duration">
                {plat?.durations.map((d) => (
                  <button type="button" role="radio" aria-checked={f.duration_sec === d} key={d} className={`opt sm ${f.duration_sec === d ? "on" : ""}`} onClick={() => set("duration_sec", d)}>{d}s</button>))}
              </div>
              {plat && <p className="hint" style={{ marginTop: 10 }}>{plat.aspect} · hook must land within {plat.hook_window_sec}s · {plat.notes}</p>}
            </Field>
          </Section>

          <section className="card">
            <button type="button" className="step-title" style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, width: "100%" }}
                    aria-expanded={showCreative} onClick={() => setShowCreative((s) => !s)}>
              <span className="num" style={{ background: "var(--muted)" }}>4</span>
              <h2>Creative direction</h2>
              <span className="tag">{optionalCount ? `${optionalCount} set · ` : "Optional · "}{showCreative ? "Hide" : "Show"}</span>
            </button>
            <p className="hint">Leave blank and the creative-director stage picks the strongest approach.</p>
            {showCreative && (
              <>
                <Field label="Hook type" optional>
                  <div className="options">
                    <button type="button" className={`opt sm ${!f.hook_type ? "on" : ""}`} onClick={() => set("hook_type", null)}>Auto</button>
                    {hookEntries.map(([k, d]) => (
                      <button type="button" key={k} title={d} className={`opt sm ${f.hook_type === k ? "on" : ""}`} onClick={() => set("hook_type", k)}>
                        <span style={{ textTransform: k === "pov" ? "none" : "capitalize" }}>{label(k)}</span></button>
                    ))}
                  </div>
                  <div className="hook-desc">{f.hook_type ? options!.hook_types[f.hook_type] : "Each concept uses the hook type that suits it best."}</div>
                </Field>
                <div className="grid2">
                  <Field id="theme" label="Theme" optional>
                    <input id="theme" type="text" value={f.theme || ""} maxLength={300} placeholder="e.g. Monday mornings, festive gifting" onChange={(e) => set("theme", e.target.value)} />
                  </Field>
                  <Field id="creative_direction" label="Direction notes" optional>
                    <input id="creative_direction" type="text" value={f.creative_direction} maxLength={5000} placeholder="e.g. creator-led, one location, no VO" onChange={(e) => set("creative_direction", e.target.value)} />
                  </Field>
                </div>
                <div className="grid2">
                  <Field id="mandatories" label="Must include" optional hint="Exact lines, legal supers, hashtags — used verbatim.">
                    <TagInput id="mandatories" value={f.mandatories} onChange={(v) => set("mandatories", v)} placeholder="Type and press Enter" />
                  </Field>
                  <Field id="exclusions" label="Avoid" optional hint="Words, claims or visuals the client has ruled out.">
                    <TagInput id="exclusions" value={f.exclusions} onChange={(v) => set("exclusions", v)} max={30} placeholder="Type and press Enter" />
                  </Field>
                </div>
                <Field id="references" label="References" optional error={show("references") || ""} hint="Links or notes, and what to take from each. Video links are read by title only, so say what to borrow.">
                  <RefsEditor value={f.references} onChange={(v) => set("references", v)} />
                </Field>
                <div className="grid2">
                  <Field label="Concepts to explore">
                    <div className="options">{[1, 2, 3, 4].map((n) => (
                      <button type="button" key={n} className={`opt sm ${f.concept_count === n ? "on" : ""}`} onClick={() => set("concept_count", n)}>{n}</button>))}
                    </div>
                  </Field>
                  <Field id="format_id" label="Script format">
                    <select id="format_id" value={f.format_id} onChange={(e) => set("format_id", e.target.value)}>
                      {options!.formats.map((x) => <option key={x.id} value={x.id}>{x.name} (v{x.version})</option>)}
                    </select>
                  </Field>
                </div>
              </>
            )}
          </section>
        </div>

        <aside className="summary card" aria-label="Summary">
          <h2>Summary</h2>
          <dl>
            <dt>Product</dt><dd title={f.product_url}>{validUrl(f.product_url) ? hostOf(f.product_url) : "—"}</dd>
            <dt>Platform</dt><dd>{plat?.label}</dd>
            <dt>Length</dt><dd>{f.duration_sec}s · {plat?.aspect}</dd>
            <dt>Hook</dt><dd style={{ textTransform: "capitalize" }}>{f.hook_type ? label(f.hook_type) : "Auto"}</dd>
            <dt>Concepts</dt><dd>{f.concept_count}</dd>
          </dl>
          <ul className="checklist">
            <li className={!errors.product_url ? "ok" : ""}><span className="tick">✓</span>Product link</li>
            <li className={!errors.client_brief ? "ok" : ""}><span className="tick">✓</span>Client brief</li>
            <li className="ok"><span className="tick">✓</span>Platform & length</li>
          </ul>
          <button className="btn lg block" disabled={busy}>{busy && <Spinner />}{busy ? "Starting…" : "Generate script"}</button>
          <p className="hint" style={{ textAlign: "center", marginTop: 10 }}>Takes 2–5 minutes. You can leave the page.</p>
        </aside>
      </div>

      <div className="mobile-cta">
        <div className="grow">{ready ? `${plat?.label} · ${f.duration_sec}s` : "Add a product link and brief to continue"}</div>
        <button className="btn" disabled={busy}>{busy && <Spinner />}{busy ? "Starting…" : "Generate"}</button>
      </div>
    </form>
  );
}

function Section({ n, title, hint, done, children }: { n: number; title: string; hint?: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="card">
      <div className="step-title"><span className={`num ${done ? "done" : ""}`}>{done ? "✓" : n}</span><h2>{title}</h2></div>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function Field({ id, label: l, required, optional, hint, error, extra, children }: {
  id?: string; label: string; required?: boolean; optional?: boolean; hint?: string; error?: string | false;
  extra?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="field" data-field={id}>
      <label className="label" htmlFor={id}>
        <span style={{ flex: 1 }}>{l}{required && <span className="req"> *</span>}{optional && <em> · optional</em>}</span>{extra}
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
            <input type="text" value={r.what_to_take} aria-label={`What to take from reference ${i + 1}`} onChange={(e) => upd(i, "what_to_take", e.target.value)} placeholder="What to take: pacing, tone, structure…" maxLength={500} />
          </div>
          <button type="button" className="btn ghost icon" aria-label="Remove reference" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {value.length < 8 && (
        <div><button type="button" className="btn secondary" onClick={() => onChange([...value, { kind: "note", value: "", what_to_take: "" }])}>+ Add reference</button></div>
      )}
    </div>
  );
}
