import { useState } from "react";
import { API_BASE } from "../api";
import { Icon, Modal, useToast } from "./ui";

const GPT_KEY = "ss:gpt-url";
export const apiOrigin = () => API_BASE || window.location.origin;
export const claudeConnectorUrl = () => `${apiOrigin()}/mcp`;
export const gptSchemaUrl = () => `${apiOrigin()}/connect/openapi.json`;
export function getGptUrl(): string { try { return localStorage.getItem(GPT_KEY) || ""; } catch { return ""; } }
function setGptUrl(u: string) { try { if (u) localStorage.setItem(GPT_KEY, u); else localStorage.removeItem(GPT_KEY); } catch { /* storage unavailable */ } }

export const GPT_INSTRUCTIONS = `You write production-ready video ad scripts for ScriptStudio.
When the user gives you a code that starts with SS-, call getScriptJob with that code and follow the returned instructions exactly.
Then call submitScript with the same code and the complete JSON object as "script". Do not paste the JSON into the chat.
If submitScript reports problems, fix exactly those and submit again.
When it succeeds, reply with the script title and the open_in_scriptstudio link.
Never invent product facts: use only the product source in the job.`;

function Copy({ text, label }: { text: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <div className="copy-field">
      <code title={text}>{label || text}</code>
      <button type="button" className="btn sm" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }
        catch { toast("Couldn't copy. Select the text and press Ctrl/⌘ + C.", "error"); }
      }}>{done ? <><Icon.check /> Copied</> : <><Icon.copy /> Copy</>}</button>
    </div>
  );
}

/** One-time setup: add ScriptStudio to Claude (custom connector) or ChatGPT (custom GPT with an Action). */
export default function ConnectSetup({ initial = "claude", onClose, onSaved }: {
  initial?: "claude" | "chatgpt"; onClose: () => void; onSaved?: () => void;
}) {
  const [tab, setTab] = useState(initial);
  const [gpt, setGpt] = useState(getGptUrl());
  const toast = useToast();
  const gptOk = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\/\S+/.test(gpt.trim());
  return (
    <Modal title="Connect your own Claude or ChatGPT" onClose={onClose} actions={
      <button className="btn primary" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ marginTop: 0 }}>One-time setup, about 2 minutes. Afterwards ScriptStudio sends each job to your chat with one click — no copy-paste — and the finished script comes back here by itself. It uses your plan, at no extra cost.</p>
      <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
        <button role="tab" aria-selected={tab === "claude"} className={tab === "claude" ? "on" : ""} onClick={() => setTab("claude")}><span className="dotlogo claude xs" /> Claude</button>
        <button role="tab" aria-selected={tab === "chatgpt"} className={tab === "chatgpt" ? "on" : ""} onClick={() => setTab("chatgpt")}><span className="dotlogo gpt xs" /> ChatGPT</button>
      </div>
      {tab === "claude" ? (
        <ol className="setup-steps">
          <li>Open <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer">claude.ai → Settings → Connectors <Icon.ext /></a></li>
          <li>Click <b>Add</b> → <b>Add custom connector</b>. Name it <b>ScriptStudio</b> and paste this URL:
            <Copy text={claudeConnectorUrl()} /></li>
          <li>Under <b>Authentication</b> choose <b>No sign-in</b>, leave Request headers empty, and click <b>Add</b>.</li>
          <li>In a chat, make sure ScriptStudio is switched on in the tools menu. The first time, Claude asks to allow ScriptStudio's tools — choose <b>Always allow</b>.</li>
        </ol>
      ) : (
        <>
          <ol className="setup-steps">
            <li>Open <a href="https://chatgpt.com/gpts/editor" target="_blank" rel="noopener noreferrer">chatgpt.com → Explore GPTs → Create <Icon.ext /></a> and switch to <b>Configure</b>.</li>
            <li>Name it <b>ScriptStudio</b>, and paste this into <b>Instructions</b>:<Copy text={GPT_INSTRUCTIONS} label="ScriptStudio GPT instructions" /></li>
            <li>Under <b>Actions</b> click <b>Create new action</b> → <b>Import from URL</b>, paste this, then click Import:
              <Copy text={gptSchemaUrl()} /></li>
            <li>Leave Authentication as <b>None</b>. Click <b>Create</b>, choose <b>Only me</b> (or <b>Anyone with the link</b> to share with your team), then copy the GPT's link.</li>
            <li>Paste the GPT link here:
              <div className="row" style={{ marginTop: 8, flexWrap: "nowrap" }}>
                <input type="url" value={gpt} placeholder="https://chatgpt.com/…" onChange={(e) => setGpt(e.target.value)} aria-label="Your ScriptStudio plugin or GPT link" />
                <button type="button" className="btn primary" disabled={!gptOk && !!gpt} onClick={() => {
                  setGptUrl(gpt.trim()); toast(gpt.trim() ? "ChatGPT connected in this browser." : "ChatGPT link removed.", "ok"); onSaved?.();
                }}>Save</button>
              </div>
              {gpt && !gptOk && <div className="err">That doesn't look like a ChatGPT link (it starts with https://chatgpt.com/).</div>}
            </li>
          </ol>
        </>
      )}
    </Modal>
  );
}
