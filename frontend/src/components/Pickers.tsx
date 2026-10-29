import { useState } from "react";
import { useSession } from "../session";
import type { JobInputs } from "../types";
import { label, PlatformIcon } from "./ui";

const SHORT: Record<string, string> = {
  "Instagram Reels": "Reels", "TikTok": "TikTok", "YouTube Shorts": "Shorts", "YouTube (in-stream)": "YouTube",
  "Meta Feed (FB/IG)": "Meta feed", "TV / CTV": "TV / CTV",
};
export const SIZES = ["9:16", "4:5", "1:1", "16:9"];

/** Where the ad runs, as one toggle row with each platform's icon. */
export function PlatformPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { options } = useSession();
  return (
    <div className="seg-toggle" role="radiogroup" aria-label="Platform">
      {Object.entries(options!.platforms).map(([k, p]) => (
        <button type="button" role="radio" aria-checked={value === k} key={k} title={p.label} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          <PlatformIcon p={p.label} size={14} />{SHORT[p.label] || p.label}</button>))}
    </div>
  );
}

/** Frame size: the platform's own by default, or any common ratio. Each option shows its shape. */
export function SizePicker({ value, platformAspect, onChange }: { value: string | null; platformAspect: string; onChange: (v: string | null) => void }) {
  const cur = value || platformAspect;
  return (
    <div className="seg-toggle sizes" role="radiogroup" aria-label="Frame size">
      {SIZES.map((r) => {
        const [w, h] = r.split(":").map(Number);
        return (
          <button type="button" role="radio" aria-checked={cur === r} key={r} className={cur === r ? "on" : ""}
                  title={r === platformAspect ? `${r} (platform default)` : r} onClick={() => onChange(r === platformAspect ? null : r)}>
            <i className="ratio" style={{ aspectRatio: `${w} / ${h}`, [w >= h ? "width" : "height"]: 14 }} />{r}
            {r === platformAspect && <span className="def">default</span>}
          </button>
        );
      })}
    </div>
  );
}

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
    <div className="seg-toggle len-pick" role="radiogroup" aria-label="Length in seconds">
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
          <option value="">Auto (best fit)</option>
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
