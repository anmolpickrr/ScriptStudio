import { api } from "./api";
import type { JobInputs } from "./types";

// The New-script form keeps an autosaved draft; the home page writes into it too (quick start, brief import).
export const DRAFT_KEY = "ss:new-script-draft:v2";

export const EMPTY: JobInputs = {
  product_url: "", client_brief: "", product_copy: "", product_image_urls: [], platform: "instagram_reels",
  duration_sec: 30, aspect_ratio: null, creative_direction: "", references: [], hook_type: null, theme: "", target_audience: "",
  tone: "", language: "English", mandatories: [], exclusions: [], brand_name: "", format_id: "house-v1", concept_count: 3,
  engine: "auto", logo_url: "", brand_guidelines_url: "", asset_links: [], ad_type: "Video", headline_ideas: [],
  key_usps: [], offer: "", cta: "", design_style: "", elements_to_highlight: [], subtitles: true, image_source: "Web",
};

export function loadDraft(): JobInputs {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") }; } catch { return EMPTY; }
}

export function saveDraft(f: JobInputs) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); } catch { /* storage unavailable */ }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
}

export function validUrl(u: string) {
  try { const x = new URL(u.trim()); return /^https?:$/.test(x.protocol) && x.hostname.includes("."); } catch { return false; }
}

/** Reads a .docx brief (e.g. the Creative Brief template downloaded from Google Docs) into form fields. */
export async function importBriefFile(file: File): Promise<{ fields: Partial<JobInputs>; recognised: string[] }> {
  if (file.size > 5_000_000) throw new Error("That file is larger than 5 MB.");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return api.post("/api/brief/import", { filename: file.name, data_base64: btoa(bin) });
}

/** If the free-text brief is thin, build one from the structured fields so the writer has everything. */
export function composeBrief(f: JobInputs): string {
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


const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i;

/** The request body for POST /api/jobs. */
export function buildJobBody(f: JobInputs) {
  const images = f.asset_links.filter((u) => IMAGE_RE.test(u));
  return {
    ...f, product_url: f.product_url.trim(), client_brief: composeBrief(f), theme: f.theme || null, aspect_ratio: f.aspect_ratio || null, brand_name: f.brand_name || null,
    product_image_urls: Array.from(new Set([...f.product_image_urls, ...images])).filter((u) => u.startsWith("https://")).slice(0, 4),
    references: f.references.map((r) => ({ ...r, kind: /^https?:\/\//.test(r.value.trim()) ? "url" : "note" })),
  };
}
