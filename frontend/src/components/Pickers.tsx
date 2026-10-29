import { useState } from "react";
import { useSession } from "../session";
import type { JobInputs } from "../types";
import { label } from "./ui";

/** Every length works on every platform; anything else (6–180s) goes in Custom. */
export const LENGTHS = [10, 15, 20, 25, 30, 35, 40, 45, 60, 90];
export const CTAS = ["Shop Now", "Order Now", "Buy Now", "Learn More", "Book Now", "Sign Up", "Download Now", "Get Offer"];

export function LengthPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const preset = LENGTHS.includes(value);
  const [custom, setCustom] = useState(!preset);
  const [text, setText] = useState(preset ? "" : String(value));
  const commit = (t: string) => {
    setText(t);
    const n = Math.round(Number(t));
    if (n >= 6 && n <= 180) onChange(n);
  };
  return (
    <div className="len-pick" role="radiogroup" aria-label="Length in seconds">
      {LENGTHS.map((d) => (
        <button type="button" role="radio" aria-checked={!custom && value === d} key={d} className={!custom && value === d ? "on" : ""}
                onClick={() => { setCustom(false); onChange(d); }}>{d}s</button>))}
      {custom ? (
        <label className="len-custom on">
          <input type="number" min={6} max={180} autoFocus={preset} value={text} placeholder="—" aria-label="Custom length in seconds"
                 onChange={(e) => commit(e.target.value)} />s
        </label>
      ) : <button type="button" className="len-more" onClick={() => { setCustom(true); setText(String(value)); }}>Custom</button>}
    </div>
  );
}

/** Theme, hook, CTA and tone: the creative choices that shape a script most, asked up front. */
export function StoryFields({ f, set }: { f: JobInputs; set: <K extends keyof JobInputs>(k: K, v: JobInputs[K]) => void }) {
  const { options } = useSession();
  const hooks = options!.hook_types;
  return (
    <div className="story-fields">
      <label className="sf">
        <span>Theme / occasion</span>
        <input type="text" value={f.theme || ""} maxLength={300} placeholder="e.g. Karwa Chauth, Monsoon sale" onChange={(e) => set("theme", e.target.value)} />
      </label>
      <label className="sf">
        <span>Story hook</span>
        <select value={f.hook_type || ""} onChange={(e) => set("hook_type", e.target.value || null)} title={f.hook_type ? hooks[f.hook_type] : "We pick the strongest hook for the brief"}>
          <option value="">Auto — best for the brief</option>
          {Object.keys(hooks).map((k) => <option key={k} value={k}>{k === "pov" ? "POV" : label(k).replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
        </select>
      </label>
      <label className="sf">
        <span>CTA</span>
        <input type="text" list="cta-list" value={f.cta} maxLength={300} placeholder="e.g. Shop Now" onChange={(e) => set("cta", e.target.value)} />
        <datalist id="cta-list">{CTAS.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label className="sf">
        <span>Tone</span>
        <input type="text" value={f.tone} maxLength={300} placeholder="e.g. warm, festive, witty" onChange={(e) => set("tone", e.target.value)} />
      </label>
      {f.hook_type && <p className="sf-hint">{hooks[f.hook_type]}</p>}
    </div>
  );
}
