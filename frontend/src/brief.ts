import { api } from "./api";
import type { JobInputs } from "./types";

// The New-script form keeps an autosaved draft; the home page writes into it too (quick start, brief import).
export const DRAFT_KEY = "ss:new-script-draft:v2";

export const EMPTY: JobInputs = {
  product_url: "", client_brief: "", product_copy: "", product_image_urls: [], platform: "instagram_reels",
  duration_sec: 30, creative_direction: "", references: [], hook_type: null, theme: "", target_audience: "",
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
