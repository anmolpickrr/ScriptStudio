# ScriptStudio — deployment acceptance

What "done" means for this release, how each point is checked, and what ships.

Live app: https://anmolpickrr.github.io/ScriptStudio/ · Server: https://scriptstudio.onrender.com ·
Code: https://github.com/anmolpickrr/ScriptStudio

## 1. Acceptance criteria

Each criterion is checked automatically (backend tests run on every push; the live check runs against the deployed
server) or by hand in a browser. A release is accepted when every line below passes.

### Understanding the input

| # | Criterion | How it's checked |
|---|---|---|
| A1 | A script can be started from a product link plus a brief written as rough notes (fragments, bullets, mixed language). The brief stage reads intent and lists every assumption it made. | Brief instructions; live check "Generate a script" |
| A2 | Product links are accepted as pasted (with or without `https://`, spaces, quotes). | Test `test_links_are_accepted_as_people_paste_them`; manual |
| A3 | Pages built with JavaScript still yield product data (embedded JSON, microdata, Shopify and WooCommerce product data). | Tests `test_javascript_store…`, `test_woocommerce…` |
| A4 | When a site blocks automated visitors, the user gets a clear reason and a one-click "Paste product details" route. Site protections are never bypassed. | Tests `test_bot_check_is_reported_honestly…`, `test_unreadable_page…` |
| A5 | References, mandatories, exclusions, offer, CTA, tone, occasion, hook, style, platform, length and frame size reach the writer. | Prompt inputs; manual |

### The script

| # | Criterion | How it's checked |
|---|---|---|
| B1 | Every product claim points to a fact quoted from the product page; unverified claims are flagged, never written. | Test suite (product truth checks); live check facts count |
| B2 | Each character has age range, appearance (natural skin texture for real people), personality, expressions, wardrobe and voice/accent. | Production check; live check `production.cast_complete` |
| B3 | The script states its visual style (realistic UGC, live action, 2D/3D animation, cartoon…), look and texture, voice direction, a pronunciation guide where names are tricky, music direction and sound design. | Production check; live check `production.*` |
| B4 | Every scene has camera direction, a shot-by-shot breakdown that adds up to the scene length, visual, performance, VO/dialogue with delivery notes, on-screen text, music, sound effects and transition. | Production check (`shots add up`, `no sound direction`, `no delivery note`); live check `scenes_with_shots`, `scenes_with_sound` |
| B5 | Picture, words and sound are in sync: what is said is what is seen, words fit the scene length, the CTA lands in the last scene. | Sync, timing and CTA checks; editorial review |
| B6 | The writing sounds human: no stock ad phrases, no dashes in spoken lines, no emojis unless asked. | Voice check (`test_voice_check_flags_dashes_and_stock_phrases`) |
| B7 | Gaps found by the checks feed the revision round, and the best version is kept. | Tests `test_failing_script_is_revised`, `test_stuck_script…` |
| B8 | The same rules apply whichever writer is chosen: ScriptStudio, Claude or ChatGPT. | Shared instructions; live check relay flow |

### Refining a client's script

| # | Criterion | How it's checked |
|---|---|---|
| C1 | "Refine a client's script" accepts a pasted draft in any form; notes for the edit are optional. | Validation test; manual |
| C2 | Lines that work are kept word for word; only what needs fixing changes, and missing production detail is filled in. | Refine instructions; live check "Refine a client's script" |
| C3 | Every edit is recorded with scene, part, before, after and why. Edited lines are highlighted (EDITED) in the document, Word and Google Docs, with the full list at the end, and listed in the Changes tab. | Test `test_refine_mode_keeps_the_client_script_and_highlights_edits`; live check "refine preview lists the changes" |
| C4 | Later revisions never lose the record of changes. | `_keep_changes` in the pipeline and chat revisions; manual |

### Working on the script

| # | Criterion | How it's checked |
|---|---|---|
| D1 | A writer can edit any line, shot, performance, VO, dialogue (with delivery), on-screen text, music, sound effects and transition directly; the edit is saved as typed, the checks run again, and History records it. | Test `test_writer_can_edit_the_script_by_hand`; manual |
| D2 | "Revise" takes plain notes and returns a revised version that goes through the checks again. | Tests; manual |
| D3 | Export to Word, HTML and Google Docs in the house script-sheet format with file naming Brand_Product_Platform_Duration_Date_vN. | Tests `test_docx…`; live check exports |
| D4 | Approve adds a script to the house library; Library offers Open and Write similar. | Tests; manual |

### Experience and design

| # | Criterion | How it's checked |
|---|---|---|
| E1 | One screen starts a script: product link, brief (or client script), a single row of pills for format and story, writer, Write/Refine button. Everything else sits behind "More details". | Manual (desktop and phone) |
| E2 | The design uses the FASTRR palette, shapes and visual language from the Creative Ops Tracker, with ScriptStudio's own layout: clapperboard slate navigation, index-card mode choice, film-strip desk summary, taped script cards, a clipped script page. | Manual |
| E3 | Day and Night themes follow sunrise and sunset in India; a manual switch holds until the light changes; no flash on load. | Manual |
| E4 | Works on phones (390px wide): no sideways scrolling, bottom tab bar, popups readable. | Manual / screenshot check |
| E5 | No words, labels, icons or symbols in the interface refer to AI. (The script-sheet disclaimer keeps the house wording until it is changed in the format.) | Code search; manual |
| E6 | ChatGPT works without a plugin (copy, paste, reply picked up automatically); Claude works through the connector; the desktop ChatGPT plugin works with "Copy request". | Live check relay flow; manual |

### Operations

| # | Criterion | How it's checked |
|---|---|---|
| F1 | Every push to `main` runs the tests and deploys the website (GitHub Pages) and the server (Render). | GitHub Actions: CI, Website, Deploy to Render |
| F2 | The live check passes against the deployed server: site and bundle, connectors, generation, exports, refine, chat relay. | Workflow "Smoke test (live URL)" |
| F3 | Free tiers only: Render free web service, Neon free Postgres, Gemini free tier. Nothing requires payment. | Configuration |
| F4 | Secrets live only in Render's environment settings, never in the repository. | Code search |

## 2. Deliverables

1. **Web app** on GitHub Pages: Studio (write or refine), Scripts, Library, Format, script page with editor,
   Revise, Changes, Quality, Flags, Concepts, Facts and History.
2. **API server** on Render: product reading, the writing pipeline, refine mode, checks, exports and the
   Claude/ChatGPT connector (`/mcp`, `/connect/*`).
3. **Script document** in the house sheet format (Word, HTML, Google Docs), including cast, look and sound,
   shot breakdowns and change highlights.
4. **Automated tests** (`backend/tests`) and the **live check** workflow (`.github/workflows/smoke.yml`).
5. **Documentation**: `docs/DEPLOYMENT.md` (setup and connectors) and this file.

## 3. Open items that need an owner's decision

- **Web research before writing** (category, competitor ads, audience language) through Gemini's Google Search
  grounding. Uses the existing free key, with its own daily allowance. Not switched on until approved.
- **Disclaimer wording** on the script sheet mentions AI generation; it is the house format's text and can be
  changed under Format.
