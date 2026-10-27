import { useEffect, useState } from "react";
import { api } from "../api";
import { PageSkeleton, Spinner, TagInput, useToast } from "../components/ui";
import { useSession } from "../session";
import type { FormatSpec } from "../types";

export default function FormatEditor() {
  const { user, options, config, setUser } = useSession();
  const [passcode, setPasscode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const toast = useToast();
  const [id, setId] = useState("house-v1");
  const [spec, setSpec] = useState<FormatSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = !!user?.admin;

  useEffect(() => { api.get<FormatSpec>(`/api/formats/${id}`).then(setSpec).catch((e) => toast(e.message, "error")); }, [id, toast]);
  if (!spec) return <PageSkeleton />;

  const unlock = async () => {
    setUnlocking(true);
    try { setUser(await api.post("/api/auth/admin", { passcode })); toast("Admin unlocked.", "ok"); setPasscode(""); }
    catch (e) { toast((e as Error).message, "error"); }
    finally { setUnlocking(false); }
  };

  const move = (i: number, d: number) => {
    const s = [...spec.sections]; const j = i + d;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]]; setSpec({ ...spec, sections: s });
  };
  const rule = (k: keyof FormatSpec["rules"], v: number | boolean) => setSpec({ ...spec, rules: { ...spec.rules, [k]: v } });

  const save = async () => {
    setSaving(true);
    try { setSpec(await api.put<FormatSpec>(`/api/formats/${spec.id}`, spec)); toast("Format saved as a new version.", "ok"); }
    catch (e) { toast((e as Error).message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>House format</h1>
          <p>Every script and document follows this structure. Saving creates a new version; past scripts keep theirs.</p></div>
        {options && options.formats.length > 1 && (
          <select style={{ width: 220 }} value={id} onChange={(e) => setId(e.target.value)}>
            {options.formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        )}
        {canEdit && <button className="btn primary" onClick={save} disabled={saving}>{saving && <Spinner />} Save v{spec.version + 1}</button>}
      </div>
      {!canEdit && (config.auth_mode === "anonymous" && config.admin_unlock ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Admin access</h2>
          <p className="hint">Enter the admin passcode to edit the house format. You're viewing v{spec.version}.</p>
          <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); unlock(); }}>
            <input type="password" style={{ maxWidth: 260 }} value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Admin passcode" aria-label="Admin passcode" />
            <button className="btn primary" disabled={!passcode || unlocking}>{unlocking && <Spinner />}Unlock</button>
          </form>
        </div>
      ) : <div className="banner info">Only admins can change the house format. You're viewing v{spec.version}.</div>)}
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          <h2>Document sections</h2>
          <p className="hint">Order and headings used in every Google Doc.</p>
          {spec.sections.map((s, i) => (
            <div key={s.key} className="row" style={{ marginTop: 8 }}>
              <input type="text" style={{ flex: 1 }} value={s.label} disabled={!canEdit} maxLength={80}
                     onChange={(e) => setSpec({ ...spec, sections: spec.sections.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
              {canEdit && <>
                <button className="btn ghost" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
                <button className="btn ghost" aria-label="Move down" onClick={() => move(i, 1)}>↓</button></>}
            </div>
          ))}
        </div>
        <div className="stack">
          <div className="card">
            <h2>Quality bar</h2>
            <div className="grid2">
              <div className="field"><span className="label">Minimum critic score (1–5)</span>
                <input type="number" min={1} max={5} disabled={!canEdit} value={spec.rules.min_critic_score} onChange={(e) => rule("min_critic_score", +e.target.value)} /></div>
              <div className="field"><span className="label">Max automatic revisions</span>
                <input type="number" min={0} max={5} disabled={!canEdit} value={spec.rules.max_revisions} onChange={(e) => rule("max_revisions", +e.target.value)} /></div>
              <div className="field"><span className="label">Speech pace factor</span>
                <input type="number" step={0.05} min={0.6} max={1.4} disabled={!canEdit} value={spec.rules.max_words_per_sec_factor} onChange={(e) => rule("max_words_per_sec_factor", +e.target.value)} /></div>
              <div className="field"><span className="label">Minimum scene length (s)</span>
                <input type="number" step={0.5} min={0.5} max={5} disabled={!canEdit} value={spec.rules.min_scene_sec} onChange={(e) => rule("min_scene_sec", +e.target.value)} /></div>
            </div>
            <label className="row small" style={{ marginTop: 10 }}><input type="checkbox" disabled={!canEdit} checked={spec.rules.require_cta_in_last_scene} onChange={(e) => rule("require_cta_in_last_scene", e.target.checked)} /> CTA must be in the final scene</label>
            <label className="row small"><input type="checkbox" disabled={!canEdit} checked={spec.rules.require_sync_note} onChange={(e) => rule("require_sync_note", e.target.checked)} /> Every spoken scene needs a visual/VO sync note</label>
          </div>
          <div className="card">
            <h2>Editorial rules</h2>
            <p className="hint">House preferences every writer and reviewer stage follows. Notes from approvals can be added here.</p>
            {canEdit ? <TagInput value={spec.editorial_notes} max={40} onChange={(v) => setSpec({ ...spec, editorial_notes: v })} placeholder="Add a rule and press Enter" />
              : <ul>{spec.editorial_notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        </div>
      </div>
    </>
  );
}
