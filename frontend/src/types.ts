export type Severity = "blocker" | "major" | "minor" | "info";
export type JobStatus = "queued" | "running" | "ready" | "needs_review" | "failed" | "approved" | "awaiting_input";
export type Engine = "auto" | "chatgpt" | "claude";

export interface User { email: string; name: string; picture?: string; admin: boolean; guest?: boolean; elevated?: boolean }

export interface AppConfig {
  auth_mode: "google" | "anonymous" | "none";
  google_client_id: string;
  demo_mode: boolean;
  user: User | null;
  daily_job_limit: number;
  admin_unlock: boolean;
  drive_export: boolean;
}

export interface PlatformSpec {
  label: string; aspect: string; durations: number[]; hook_window_sec: number; notes: string; cta_style: string;
}

export interface Options {
  platforms: Record<string, PlatformSpec>;
  hook_types: Record<string, string>;
  languages: string[];
  formats: { id: string; name: string; version: number }[];
}

export interface Reference { kind: "url" | "note"; value: string; what_to_take: string }

export interface JobInputs {
  product_url: string; client_brief: string; product_copy: string; product_image_urls: string[];
  platform: string; duration_sec: number; creative_direction: string; references: Reference[];
  hook_type: string | null; theme: string | null; target_audience: string; tone: string; language: string;
  mandatories: string[]; exclusions: string[]; brand_name: string | null; format_id: string; concept_count: number;
  engine: Engine;
  logo_url: string; brand_guidelines_url: string; asset_links: string[]; ad_type: string; headline_ideas: string[];
  key_usps: string[]; offer: string; cta: string; design_style: string; elements_to_highlight: string[];
  subtitles: boolean; image_source: string;
}

export interface Flag { severity: Severity; area: string; message: string; suggestion: string }
export interface StageEvent { stage: string; status: "started" | "done" | "failed"; at: string; detail: string }
export interface Concept {
  title: string; logline: string; hook_type: string; hook_visual: string; hook_line: string; story_arc: string;
  product_role: string; ending_button: string; why_it_works: string; risks: string;
}
export interface ConceptDecision {
  scores: { index: number; hook: number; brief_fit: number; originality: number; producibility: number; product_truth: number; rationale: string }[];
  chosen_index: number; director_notes: string;
}
export interface QCFinding { check: string; severity: Severity; scene: number | null; message: string; fix: string }
export interface QCReport { iteration: number; findings: QCFinding[]; scores: Record<string, number>; passed: boolean; summary: string }
export interface ProductFact {
  id: string; category: string; statement: string; verified: boolean; note: string;
  evidence: { source: string; quote: string };
}
export interface Revision { at: string; by: string; kind: "feedback" | "concept"; detail: string }

export interface Job {
  id: string; owner: string; inputs: JobInputs; status: JobStatus; created_at: string; updated_at: string;
  events: StageEvent[]; flags: Flag[];
  dossier: { url: string; name: string; brand: string; facts: ProductFact[]; packaging_description: string; image_urls: string[] } | null;
  concepts: Concept[]; concept_decision: ConceptDecision | null;
  script: { title: string; logline: string; scenes: { number: number; label: string; start_sec: number; end_sec: number; visual: string }[] } | null;
  qc_history: QCReport[]; doc_url: string | null; format_version: string; revisions: Revision[]; error: string;
  relay: { kind: "full" | "revise"; round: number; prompt: string; created_at: string; last_error: string; code: string; submitted_via: string } | null;
}

export interface JobSummary {
  id: string; status: JobStatus; created_at: string; updated_at: string; title: string; product_url: string;
  brand: string; platform: string; duration_sec: number; passed: boolean; owner: string;
}

export interface LibraryItem {
  job_id: string; title: string; logline: string; platform: string; duration_sec: number; hook_type: string;
  approved_by: string; approved_at: string; editor_notes: string;
}

export interface FormatSpec {
  id: string; version: number; name: string;
  sections: { key: string; label: string; required: boolean }[];
  scene_columns: string[];
  style: Record<string, string | number | boolean>;
  rules: { max_words_per_sec_factor: number; min_scene_sec: number; require_sync_note: boolean;
           require_cta_in_last_scene: boolean; min_critic_score: number; max_revisions: number };
  editorial_notes: string[];
}
