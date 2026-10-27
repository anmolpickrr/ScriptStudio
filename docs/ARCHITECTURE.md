# ScriptStudio: Architecture & Editorial System

ScriptStudio turns a product link and a client brief into a production-ready video script. It exports the script as a Google Doc in one approved house format, and it raises flags instead of inventing details whenever information is missing.

## 1. Design principles

1. **Structure first, prose second.** The model writes into a typed `Script` object made of scenes, timecodes, visual, VO, dialogue, supers, SFX, characters, continuity, fact IDs and CTA. Code renders that object to the Doc. As a result, formatting is identical every time, and changing the house format is a data edit.
2. **Two sources of truth, and they never mix.** The product page owns product facts. The client brief owns intent: objective, message, tone and outcome. References only shape style. Brief claims that the page does not support become flags. They never enter the script.
3. **Every claim is traceable.** Each product fact carries a verbatim quote that code has verified against the page. Each scene lists the fact IDs it relies on. QC rejects any number or claim word that no verified fact supports.
4. **Specialists, not one prompt.** Each stage plays one role (strategist, brand-accuracy reviewer, creative director, story editor, writer, editor) with a narrow job and a typed output.
5. **Exact checks in code, judgement by the critic.** Timing, structure, grounding, continuity IDs and banned visuals are checked by deterministic code. Hook strength, story logic, sync and dialogue quality are judged by an LLM critic with a rubric.
6. **Never fail silently.** Gaps become client-facing flags at the top of the Doc. A script that doesn't clear the bar goes to `needs_review`, never to `ready`.

## 2. Roles the system encodes (the "skills")

| Role | Stage | Owns |
|---|---|---|
| Brand-accuracy specialist | `extract_product`, `reconcile` | Fact sheet with quotes, packaging, unknowns, brief-vs-page conflicts |
| Senior content strategist | `parse_brief` | Objective, key message, audience insight, CTA intent, explicit assumptions |
| Creative director | `concepts`, `choose_concept` | Three genuinely different concepts, scored, with director notes |
| Story editor | `beats` | Timed beat sheet within platform hook window and pacing |
| Senior scriptwriter | `write`, `revise` | Scene-by-scene script under the house craft standard |
| Head of content quality | `critic` + `qc/checks.py` | 8-dimension rubric + deterministic gates |

The craft standard covers hooks, show-don't-tell, visual/VO sync, spoken dialogue, the anti-cliché list, shootable visuals, `[USE ACTUAL PACK]` and fact-ID discipline. It lives in `backend/app/prompts.py:CRAFT` and is shared by the writer, critic and reviser so all three apply the same standard.

## 3. Workflow

```
product URL ─► fetch (JSON-LD, OG, Shopify .js, visible text, images)
            ─► extract facts with verbatim quotes (+ vision for packaging)
            ─► CODE verifies every quote against the page → verified / withheld
brief + inputs + references ─► creative brief (assumptions listed)
            ─► reconcile brief vs verified facts → flags (blocker/major/minor)
            ─► 3 concepts ─► CD scores & picks + notes
            ─► beat sheet (timed)
            ─► script (+ 2 approved house exemplars from style memory)
            ─► QC round: deterministic checks + critic rubric
                 pass? ─► ready     fail? ─► targeted revision ─► QC (max 3 revisions, best version kept)
            ─► render HTML ─► Drive import → native Google Doc ─► Docs API page setup
approve ─► script saved to style library (+ editor note, optionally promoted into the format spec)
```

## 4. Quality gates

| Gate | Type | What fails it |
|---|---|---|
| Structure | code | Missing visuals, non-contiguous timecodes, wrong total duration, numbering |
| Timing | code | Spoken words over budget (language WPS × scene length), unreadable supers, shots too long for platform |
| Hook | code + critic | Nothing said or shown in the platform hook window; generic hook |
| Visual–VO sync | code + critic | Speaker not in frame, no sync note, picture contradicting line |
| Continuity | code + critic | Undefined characters, missing continuity rules, wardrobe/prop drift |
| Product accuracy | code | Unknown/unverified fact IDs, numbers or claim words (clinically, 100%, vegan…) without evidence |
| Authenticity | code + critic | AI-looking visuals (auras, holograms, particles), badges/seals without a certification fact, invented pack details |
| Dialogue quality | code + critic | Ad-speak clichés, speech-length lines, unnatural phrasing |
| CTA / brief | code + critic | CTA missing from the final scene, mandatories not verbatim, exclusions present |

**Pass rule:** a script passes only when all of the following hold:
- No finding from any source is a blocker.
- No deterministic check returns a major finding.
- Every critic score is at or above `FormatRules.min_critic_score`, which defaults to 4 out of 5.

## 5. Format & memory

- `FormatSpec` (`backend/app/house_format.py`) holds the section order and labels, the scene-table columns, the fonts and colours, landscape orientation, the QC thresholds and the editorial notes. It is versioned on every save, and each job records the version it used.
- **Style memory** (`backend/app/memory.py`): when a script is approved, it is stored along with the editor's "why it's good" note. New jobs receive the two most relevant approved scripts as exemplars, matched first on platform, then on hook type, theme and duration. The writer is told to match their standard without reusing their ideas. An editor note can be promoted into the format spec's editorial notes, which turns it into house policy.

## 6. Cloud architecture (GCP)

```
Browser (React SPA) ──HTTPS──► Cloud Run "scriptwright" (FastAPI + static UI)
   │  Google Sign-In (ID token → signed HttpOnly session cookie)        │
   │  Drive token (drive.file, popup) → used once for each export       ├─► Firestore: jobs, formats(+history), approved
   │                                                                    ├─► Secret Manager: OPENAI_API_KEY, SESSION_SECRET
   └─ polls /api/jobs/:id                                               ├─► Cloud Tasks queue ──OIDC──► POST /tasks/run (same service)
                                                                        ├─► OpenAI Responses API (structured outputs)
                                                                        └─► Google Drive/Docs API (as the signed-in user)
```

| Component | Service |
|---|---|
| API and UI | One Cloud Run service. It is public, and the app itself handles sign-in. |
| Pipeline runs | Cloud Tasks. Each task calls `/tasks/run`, authenticated with a Google-signed OIDC token for the runtime service account. Runs get up to 30 minutes and 2 attempts, and the job is claimed idempotently. |
| State | Firestore. The job document is updated after every stage, which is how the UI shows live progress. |
| Secrets | Secret Manager, mounted as environment variables |
| Docs | Drive API import (HTML → Google Doc) in the user's own Drive, followed by Docs API page setup |
| Models | OpenAI Responses API with strict JSON-schema outputs. There are three tiers (creative, critic, extract), each set by a `MODEL_*` environment variable. |
| CI/CD | GitHub Actions runs the tests, the frontend build and the Docker build, then deploys keylessly through Workload Identity Federation |

## 7. Security

- **Authentication:**
  - The server verifies Google ID tokens, then issues its own HMAC-signed, HttpOnly, Secure, SameSite=Lax session cookie.
  - No Google refresh tokens are stored.
  - Drive access uses short-lived tokens with the `drive.file` scope, which only reaches files the app creates.
- **Guest mode** (`AUTH_MODE=anonymous`): each browser gets a signed, random workspace ID instead of an account. Admin features unlock with `ADMIN_PASSCODE`, and per-browser plus app-wide daily caps (atomic counters in the store) bound OpenAI spend.
- **Authorization:**
  - Jobs belong to their creator. Other users get a 404.
  - Only admins can edit the format or the library.
  - Optional domain or email allowlists control who can sign in.
- **CSRF:** every state-changing `/api` request must carry the `X-Requested-With: scriptwright` header. A cross-site page can't send it without a preflight, which the app never approves.
- **SSRF:** user-supplied links must be http(s). Their resolved IPs must be public, and this is re-checked on every redirect. Responses are capped by size and time, and `*.internal`, `localhost` and metadata IPs are blocked.
- **Abuse and cost control:** each user has a daily generation limit (admins are exempt). Inputs are length-limited.
- **Headers:** CSP, `X-Frame-Options`, `nosniff`, HSTS and `Referrer-Policy` are set. API responses are sent with `no-store`.
- **Errors:** users see actionable messages; stack traces go to the logs only.
- **Container:** runs as a non-root user and has no credentials baked into the image.

## 8. Product (UX) decisions

- **The intake form follows the order of truth:** Product → Client brief → Creative → Platform. Each field says what it is the source of truth for. A fallback lets users paste product copy and add pack images when a page won't load.
- **Flags are a first-class surface** in both the app and the Doc. They are written for the client: what is missing and what to ask.
- **Transparency:**
  - the concepts explored, with director notes
  - eight quality scores and open findings
  - the verified and withheld product facts, with hover quotes
  - fact IDs in every scene
- **Iterating:**
  - **Revise with notes** re-runs the editorial review after applying the notes.
  - **Use this concept** rewrites the script from the beat sheet with a different concept.
  - A history of revisions is kept.
- **Approval is deliberate:** it captures the reason the script is good. Approving with open blocker flags requires an explicit confirmation.

## 9. Known limits & next steps

- **JavaScript-only pages:** they expose little text. The app flags this and offers a "paste product copy" fallback. Next step: render pages in a headless browser.
- **Video references:** Reels and YouTube links are read for their title and description only, so users say what to take from them. Next step: ingest transcripts and keyframes.
- **Packaging:** what the model sees in pack images is accepted for pack descriptions only, and is flagged for confirmation against the physical pack.
- **Roadmap:**
  - shared team workspaces, with jobs visible to the whole team
  - client-specific formats and brand-voice profiles
  - Google Docs comments flowing back into revisions
  - A/B hook variants
  - cost tracking per job
