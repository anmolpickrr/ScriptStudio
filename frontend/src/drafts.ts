import { api } from "./api";
import { EMPTY, validUrl } from "./brief";
import type { Job, JobInputs } from "./types";

// Saved drafts live in this browser (like the guest workspace). The form's working copy is the autosaved draft in
// brief.ts; "Save draft" files a named copy here that you can continue, rename or delete later.
const KEY = "ss:drafts:v1";
export interface Draft { id: string; name: string; inputs: JobInputs; updated_at: string }

function read(): Draft[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function write(ds: Draft[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ds)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event("ss:drafts"));
}
export const listDrafts = () => read().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
export const getDraft = (id: string) => read().find((d) => d.id === id) || null;

export function draftName(f: JobInputs): string {
  let host = "";
  try { host = validUrl(f.product_url) ? new URL(f.product_url).hostname.replace(/^www\./, "") : ""; } catch { /* ignore */ }
  const who = f.brand_name || host;
  const brief = f.client_brief.trim().split(/\s+/).slice(0, 6).join(" ");
  return [who, brief].filter(Boolean).join(" — ").slice(0, 80) || "Untitled draft";
}

export function hasContent(f: JobInputs): boolean {
  return !!(f.product_url.trim() || f.client_brief.trim().length > 3);
}

/** Saves (or updates, when id is given) a named draft; returns its id. */
export function saveNamedDraft(f: JobInputs, id?: string, name?: string): string {
  const ds = read();
  const now = new Date().toISOString();
  const existing = id ? ds.find((d) => d.id === id) : undefined;
  if (existing) {
    existing.inputs = f; existing.updated_at = now; if (name) existing.name = name;
    write(ds); return existing.id;
  }
  const d: Draft = { id: Math.random().toString(36).slice(2, 10), name: name || draftName(f), inputs: f, updated_at: now };
  write([d, ...ds].slice(0, 50));
  return d.id;
}
export const renameDraft = (id: string, name: string) => write(read().map((d) => (d.id === id ? { ...d, name: name.slice(0, 80) || d.name } : d)));
export const deleteDraft = (id: string) => write(read().filter((d) => d.id !== id));
export const restoreDraft = (d: Draft) => write([d, ...read().filter((x) => x.id !== d.id)]);

/** A script's inputs, ready to edit as a new draft (for "Edit & regenerate" and "Duplicate"). */
export function inputsOf(job: Pick<Job, "inputs">): JobInputs {
  return { ...EMPTY, ...job.inputs };
}

// ---------------------------------------------------------------- delete with undo
const pending = new Map<string, number>();
/** Hides a script now and deletes it after a few seconds unless undone (flushed if the page closes). */
export function deleteJobLater(id: string, ms = 6000): { undo: () => void } {
  const t = window.setTimeout(() => { pending.delete(id); api.del(`/api/jobs/${id}`).catch(() => {}); }, ms);
  pending.set(id, t);
  return { undo: () => { clearTimeout(t); pending.delete(id); } };
}
export const isPendingDelete = (id: string) => pending.has(id);
window.addEventListener("pagehide", () => {
  pending.forEach((t, id) => { clearTimeout(t); api.del(`/api/jobs/${id}`, true).catch(() => {}); });
  pending.clear();
});
