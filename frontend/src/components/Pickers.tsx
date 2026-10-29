import { ReactNode, useEffect, useRef, useState } from "react";
import { useSession } from "../session";
import type { JobInputs } from "../types";
import { Icon, label, PlatformIcon } from "./ui";

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

// ---------------------------------------------------------------- spec bar: every format and story choice as one row of pills
const TONES = ["Warm", "Playful", "Witty", "Emotional", "Premium", "Festive", "Bold", "Calm"];
const OCCASIONS = ["Diwali", "Raksha Bandhan", "Karwa Chauth", "Holi", "Eid", "Christmas", "Valentine's Day", "Mother's Day", "Wedding season", "Monsoon sale"];

function Pop({ label, icon, value, empty, wide, children }: {
  label: string; icon?: ReactNode; value: string; empty?: boolean; wide?: boolean; children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off); window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="spec" ref={ref}>
      <button type="button" className={`spec-pill ${empty ? "empty" : ""} ${open ? "open" : ""}`} aria-haspopup="dialog" aria-expanded={open}
              onClick={() => setOpen((o) => !o)}>
        {icon}<span className="spec-k">{label}</span><span className="spec-v">{value}</span><Icon.down />
      </button>
      {open && <div className={`spec-pop ${wide ? "wide" : ""}`} role="dialog" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function Choice({ on, onClick, children, hint }: { on: boolean; onClick: () => void; children: ReactNode; hint?: string }) {
  return (
    <button type="button" className={`pop-opt ${on ? "on" : ""}`} onClick={onClick} title={hint}>
      <span className="grow">{children}{hint && <small>{hint}</small>}</span>{on && <Icon.check />}
    </button>
  );
}

/** Free text with quick picks: used for CTA, tone and occasion. */
function TextPick({ value, onChange, picks, placeholder, multi, close }: {
  value: string; onChange: (v: string) => void; picks: string[]; placeholder: string; multi?: boolean; close: () => void;
}) {
  const parts = value.split(",").map((x) => x.trim()).filter(Boolean);
  const has = (p: string) => (multi ? parts.some((x) => x.toLowerCase() === p.toLowerCase()) : value === p);
  const toggle = (p: string) => {
    if (!multi) { onChange(value === p ? "" : p); close(); return; }
    onChange((has(p) ? parts.filter((x) => x.toLowerCase() !== p.toLowerCase()) : [...parts, p]).join(", "));
  };
  return (
    <>
      <div className="pop-chips">{picks.map((p) => <button type="button" key={p} className={`pop-chip ${has(p) ? "on" : ""}`} onClick={() => toggle(p)}>{p}</button>)}</div>
      <input type="text" autoFocus value={value} maxLength={300} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); close(); } }} />
      {value && <button type="button" className="pop-clear" onClick={() => { onChange(""); close(); }}>Clear</button>}
    </>
  );
}

export function SpecBar({ f, set }: { f: JobInputs; set: <K extends keyof JobInputs>(k: K, v: JobInputs[K]) => void }) {
  const { options } = useSession();
  const plats = options!.platforms;
  const plat = plats[f.platform];
  const aspect = f.aspect_ratio || plat?.aspect || "9:16";
  const hooks = options!.hook_types;
  const hookName = (k: string) => (k === "pov" ? "POV" : label(k).replace(/\b\w/g, (c) => c.toUpperCase()));
  const [w, h] = aspect.split(":").map(Number);
  const [custom, setCustom] = useState(LENGTHS.includes(f.duration_sec) ? "" : String(f.duration_sec));
  return (
    <div className="spec-bar" aria-label="Format and story">
      <Pop label="" icon={<PlatformIcon p={plat?.label || ""} size={14} />} value={SHORT[plat?.label || ""] || plat?.label || "Platform"}>
        {(close) => Object.entries(plats).map(([k, p]) => (
          <Choice key={k} on={f.platform === k} hint={`${p.aspect} · ${p.durations.join(", ")}s`} onClick={() => { set("platform", k); close(); }}>
            <span className="pop-ic"><PlatformIcon p={p.label} size={14} /></span>{p.label}</Choice>))}
      </Pop>
      <Pop label="" icon={<Icon.clock />} value={`${f.duration_sec}s`}>
        {(close) => (<>
          <div className="pop-grid">{LENGTHS.map((d) => (
            <button type="button" key={d} className={`pop-chip ${f.duration_sec === d ? "on" : ""}`} onClick={() => { set("duration_sec", d); setCustom(""); close(); }}>{d}s</button>))}</div>
          <label className="pop-row">Custom
            <input type="number" min={6} max={180} value={custom} placeholder="6–180" onChange={(e) => {
              setCustom(e.target.value); const n = Math.round(Number(e.target.value)); if (n >= 6 && n <= 180) set("duration_sec", n);
            }} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), close())} /> seconds</label>
        </>)}
      </Pop>
      <Pop label="" icon={<i className="ratio" style={{ aspectRatio: `${w} / ${h}`, [w >= h ? "width" : "height"]: 13 }} />} value={aspect}>
        {(close) => SIZES.map((r) => {
          const [a, b] = r.split(":").map(Number);
          return (
            <Choice key={r} on={aspect === r} hint={r === plat?.aspect ? "Platform default" : undefined} onClick={() => { set("aspect_ratio", r === plat?.aspect ? null : r); close(); }}>
              <span className="pop-ic"><i className="ratio" style={{ aspectRatio: `${a} / ${b}`, [a >= b ? "width" : "height"]: 14 }} /></span>{r}</Choice>);
        })}
      </Pop>
      <span className="spec-sep" aria-hidden="true" />
      <Pop label="Hook" value={f.hook_type ? hookName(f.hook_type) : "Auto"} wide>
        {(close) => (<div className="pop-scroll">
          <Choice on={!f.hook_type} hint="We pick the strongest hook for the brief" onClick={() => { set("hook_type", null); close(); }}>Auto (best fit)</Choice>
          {Object.keys(hooks).map((k) => <Choice key={k} on={f.hook_type === k} hint={hooks[k]} onClick={() => { set("hook_type", k); close(); }}>{hookName(k)}</Choice>)}
        </div>)}
      </Pop>
      <Pop label="CTA" value={f.cta || "Add"} empty={!f.cta} wide>
        {(close) => <TextPick value={f.cta} onChange={(v) => set("cta", v)} picks={CTAS} placeholder="Or type your own, e.g. Shop the drop" close={close} />}
      </Pop>
      <Pop label="Tone" value={f.tone || "Add"} empty={!f.tone} wide>
        {(close) => <TextPick multi value={f.tone} onChange={(v) => set("tone", v)} picks={TONES} placeholder="Or describe it, e.g. dry humour, warm" close={close} />}
      </Pop>
      <Pop label="Occasion" value={f.theme || "Add"} empty={!f.theme} wide>
        {(close) => <TextPick value={f.theme || ""} onChange={(v) => set("theme", v)} picks={OCCASIONS} placeholder="Or type a theme or occasion" close={close} />}
      </Pop>
    </div>
  );
}
