import { KeyboardEvent, MouseEvent, useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { saveDraft } from "../brief";
import { deleteDraft, deleteJobLater, Draft, getDraft, inputsOf, renameDraft, restoreDraft, saveNamedDraft } from "../drafts";
import type { Job, JobSummary } from "../types";
import { hostOf, Icon, Menu, PlatformIcon, Poster, StatusBadge, timeAgo, useToast } from "./ui";

/** Hide-now, delete-later with an Undo toast; returns the hidden ids and the delete function. */
export function useJobDelete() {
  const toast = useToast();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const remove = useCallback((ids: string[], label?: string) => {
    setHidden((h) => new Set([...h, ...ids]));
    const undos = ids.map((id) => deleteJobLater(id).undo);
    toast(label || (ids.length > 1 ? `${ids.length} scripts deleted` : "Script deleted"), "info", {
      label: "Undo",
      onClick: () => { undos.forEach((u) => u()); setHidden((h) => { const n = new Set(h); ids.forEach((i) => n.delete(i)); return n; }); },
    });
  }, [toast]);
  return { hidden, remove };
}

/** Actions shared by every script card and the script page. */
export function useJobActions() {
  const nav = useNavigate();
  const toast = useToast();
  const full = async (id: string) => api.get<Job>(`/api/jobs/${id}`);
  return {
    /** Opens the full form prefilled with this script's inputs; generating makes a fresh script. */
    editAsNew: async (id: string) => {
      try { saveDraft(inputsOf(await full(id))); nav("/new", { state: { from: id } }); }
      catch (e) { toast((e as Error).message, "error"); }
    },
    /** Files a copy of the inputs as a saved draft. */
    duplicate: async (id: string) => {
      try {
        const j = await full(id);
        const did = saveNamedDraft(inputsOf(j), undefined, `Copy of ${j.script?.title || hostOf(j.inputs.product_url)}`);
        toast("Duplicated to your drafts.", "ok", { label: "Open", onClick: () => openDraft(nav, did) });
      } catch (e) { toast((e as Error).message, "error"); }
    },
  };
}

export function openDraft(nav: ReturnType<typeof useNavigate>, id: string) {
  const d = getDraft(id);
  if (d) { saveDraft(d.inputs); nav("/new", { state: { draftId: d.id } }); }
}

const stop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

export function JobCard({ job, variant = "reel", onDelete, selectable, selected, onSelect, delay = 0 }: {
  job: JobSummary; variant?: "reel" | "tile"; onDelete: (id: string) => void;
  selectable?: boolean; selected?: boolean; onSelect?: (id: string) => void; delay?: number;
}) {
  const nav = useNavigate();
  const acts = useJobActions();
  const who = job.brand || hostOf(job.product_url);
  const open = () => (selectable ? onSelect?.(job.id) : nav(`/scripts/${job.id}`));
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
  return (
    <div className={`jcard jc-${variant} card-click ${selected ? "selected" : ""} st-${job.status}`} role="link" tabIndex={0}
         onClick={open} onKeyDown={onKey} style={{ animationDelay: `${delay}ms` }} aria-label={`Open ${job.title || "script"}`}>
      <span className="jcard-poster">
        <Poster brand={who} platform={job.platform} seconds={job.duration_sec} height={variant === "reel" ? 104 : 84} />
        {selectable && <span className={`check ${selected ? "on" : ""}`} aria-hidden="true"><Icon.check /></span>}
      </span>
      <div className="jcard-body">
        <div className="jcard-top">
          <StatusBadge status={job.status} />
          <span className="card-tools" onClick={stop}>
            <Menu trigger={(toggle) => <button className="icon-btn" aria-label="Script actions" title="Actions" onClick={toggle}><Icon.more /></button>}>
              {(close) => (<>
                <button onClick={() => { close(); nav(`/scripts/${job.id}`); }}>Open<small>Script, quality review and exports</small></button>
                <button onClick={() => { close(); acts.editAsNew(job.id); }}>Edit &amp; regenerate<small>Change the brief and write a new version</small></button>
                <button onClick={() => { close(); acts.duplicate(job.id); }}>Duplicate as draft<small>Keep a copy of the inputs to reuse</small></button>
                <button className="danger" onClick={() => { close(); onDelete(job.id); }}>Delete<small>You can undo for a few seconds</small></button>
              </>)}
            </Menu>
          </span>
        </div>
        <Link to={`/scripts/${job.id}`} className="card-title" onClick={(e) => { e.stopPropagation(); if (selectable) { e.preventDefault(); open(); } }}>
          <b>{job.title || "Untitled (in progress)"}</b>
        </Link>
        <span className="jcard-meta"><PlatformIcon p={job.platform} size={13} /> {job.platform} · {job.duration_sec}s</span>
        <span className="jcard-foot"><span className="jcard-brand">{who}</span><span>{timeAgo(job.updated_at)}</span></span>
      </div>
    </div>
  );
}

export function DraftCard({ draft, variant = "reel", delay = 0 }: { draft: Draft; variant?: "reel" | "tile"; delay?: number }) {
  const nav = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(draft.name);
  const host = draft.inputs.product_url ? hostOf(draft.inputs.product_url) : "No product link yet";
  const save = () => { renameDraft(draft.id, name.trim()); setEditing(false); };
  const del = () => { deleteDraft(draft.id); toast("Draft deleted", "info", { label: "Undo", onClick: () => restoreDraft(draft) }); };
  return (
    <div className={`jcard jc-${variant} draft-card card-click`} role="link" tabIndex={0} style={{ animationDelay: `${delay}ms` }}
         onClick={() => !editing && openDraft(nav, draft.id)} onKeyDown={(e) => { if (!editing && e.key === "Enter") openDraft(nav, draft.id); }}>
      <span className="jcard-poster"><span className="poster paper" style={{ height: variant === "reel" ? 104 : 84 }} aria-hidden="true"><i /><i /><i /><i /></span></span>
      <div className="jcard-body">
        <div className="jcard-top">
          <span className="badge draft"><Icon.edit /> Draft</span>
          <span className="card-tools" onClick={stop}>
            <Menu trigger={(toggle) => <button className="icon-btn" aria-label="Draft actions" title="Actions" onClick={toggle}><Icon.more /></button>}>
              {(close) => (<>
                <button onClick={() => { close(); openDraft(nav, draft.id); }}>Continue editing<small>Opens the brief form</small></button>
                <button onClick={() => { close(); setEditing(true); }}>Rename</button>
                <button onClick={() => { close(); saveNamedDraft(draft.inputs, undefined, `Copy of ${draft.name}`); toast("Draft duplicated.", "ok"); }}>Duplicate</button>
                <button className="danger" onClick={() => { close(); del(); }}>Delete<small>You can undo for a few seconds</small></button>
              </>)}
            </Menu>
          </span>
        </div>
        {editing ? (
          <form className="rename" onClick={stop} onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input autoFocus type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={save}
                   onKeyDown={(e) => e.key === "Escape" && (setName(draft.name), setEditing(false))} aria-label="Draft name" />
          </form>
        ) : <b className="card-title-text">{draft.name}</b>}
        <span className="jcard-meta"><PlatformIcon p={draft.inputs.platform} size={13} /> {host}</span>
        <span className="jcard-foot"><span className="draft-continue">Continue <Icon.arrow /></span><span>saved {timeAgo(draft.updated_at)}</span></span>
      </div>
    </div>
  );
}
