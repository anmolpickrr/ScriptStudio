import { useState } from "react";
import { api } from "../api";
import type { Job, SceneT } from "../types";
import { Icon, Modal, Spinner, useToast } from "./ui";

const FIELDS: { key: keyof SceneT; label: string; long?: boolean; hint: string }[] = [
  { key: "shot", label: "Camera", hint: "Framing, angle, movement" },
  { key: "visual", label: "Visual", long: true, hint: "What we see happen" },
  { key: "performance", label: "Performance", hint: "Expressions, gestures, energy" },
  { key: "vo", label: "Voiceover", long: true, hint: "Leave empty if none" },
  { key: "on_screen_text", label: "On-screen text", hint: "Supers and captions" },
  { key: "music", label: "Music", hint: "The cue for this scene" },
  { key: "sfx", label: "Sound effects", hint: "What we hear" },
  { key: "transition", label: "Transition", hint: "Into the next scene" },
];

/** Edit the script directly: the words go in as typed, then the automatic checks run again. */
export default function ScriptEditor({ job, onClose, onSaved }: { job: Job; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const s = job.script!;
  const people = s.characters || [];
  const [title, setTitle] = useState(s.title);
  const [scenes, setScenes] = useState<SceneT[]>(() => s.scenes.map((sc) => ({ ...sc, dialogue: (sc.dialogue || []).map((d) => ({ ...d })) })));
  const [busy, setBusy] = useState(false);
  const set = (n: number, patch: Partial<SceneT>) => setScenes((all) => all.map((sc) => (sc.number === n ? { ...sc, ...patch } : sc)));
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

  const save = async () => {
    setBusy(true);
    const orig = Object.fromEntries(s.scenes.map((sc) => [sc.number, sc]));
    const changed = scenes.filter((sc) => JSON.stringify(sc) !== JSON.stringify({ ...orig[sc.number], dialogue: orig[sc.number].dialogue || [] }));
    try {
      await api.post(`/api/jobs/${job.id}/edit`, {
        title: title !== s.title ? title : undefined,
        scenes: changed.map(({ number, label, shot, visual, performance, vo, on_screen_text, music, sfx, transition, dialogue }) =>
          ({ number, label, shot, visual, performance, vo, on_screen_text, music, sfx, transition, dialogue })),
      });
      toast(changed.length || title !== s.title ? "Saved. The checks have run again." : "No changes to save.", "ok");
      onSaved(); onClose();
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  return (
    <Modal wide title="Edit script" onClose={onClose} actions={<>
      <span className="muted small grow">Your words are saved exactly as typed. Timing, product claims and the CTA are checked again.</span>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>{busy && <Spinner />} Save changes</button></>}>
      <div className="field"><label className="label" htmlFor="ed-title">Title</label>
        <input id="ed-title" type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></div>
      <nav className="ed-jump" aria-label="Scenes">
        {scenes.map((sc) => <a key={sc.number} href={`#ed-scene-${sc.number}`}>{String(sc.number).padStart(2, "0")}</a>)}
      </nav>
      <div className="ed-scenes">
        {scenes.map((sc) => (
          <section key={sc.number} id={`ed-scene-${sc.number}`} className="ed-scene">
            <header>
              <span className="ed-n">{String(sc.number).padStart(2, "0")}</span>
              <input type="text" aria-label={`Scene ${sc.number} label`} value={sc.label} maxLength={120} placeholder="Scene label"
                     onChange={(e) => set(sc.number, { label: e.target.value })} />
              <span className="muted small nowrap">{fmt(sc.start_sec)}–{fmt(sc.end_sec)}</span>
            </header>
            <div className="ed-grid">
              {FIELDS.map((f) => (
                <label key={f.key} className={`ed-f ${f.long ? "long" : ""}`}>
                  <span>{f.label} <em>{f.hint}</em></span>
                  {f.long
                    ? <textarea rows={2} value={(sc[f.key] as string) || ""} onChange={(e) => set(sc.number, { [f.key]: e.target.value })} />
                    : <input type="text" value={(sc[f.key] as string) || ""} onChange={(e) => set(sc.number, { [f.key]: e.target.value })} />}
                </label>
              ))}
              <div className="ed-f long">
                <span>Dialogue <em>On-camera lines, with how they're said</em></span>
                {(sc.dialogue || []).map((d, i) => (
                  <div key={i} className="ed-line">
                    <select value={d.character_id} aria-label="Speaker" onChange={(e) => set(sc.number, { dialogue: sc.dialogue!.map((x, j) => (j === i ? { ...x, character_id: e.target.value } : x)) })}>
                      {[...people, ...(people.some((p) => p.id === d.character_id) ? [] : [{ id: d.character_id, name: d.character_id }])].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="text" value={d.line} placeholder="Line" aria-label="Line" onChange={(e) => set(sc.number, { dialogue: sc.dialogue!.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)) })} />
                    <input type="text" value={d.delivery} placeholder="Delivery" aria-label="Delivery" onChange={(e) => set(sc.number, { dialogue: sc.dialogue!.map((x, j) => (j === i ? { ...x, delivery: e.target.value } : x)) })} />
                    <button type="button" className="icon-btn" aria-label="Remove line" onClick={() => set(sc.number, { dialogue: sc.dialogue!.filter((_, j) => j !== i) })}><Icon.trash /></button>
                  </div>
                ))}
                {people.length > 0 && (
                  <button type="button" className="tool-btn" onClick={() => set(sc.number, { dialogue: [...(sc.dialogue || []), { character_id: people[0].id, line: "", delivery: "" }] })}>
                    <Icon.plus /> Add a line</button>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
