# ScriptStudio

**Open the app:** https://anmolpickrr.github.io/ScriptStudio/ (the API runs on Render at https://scriptstudio.onrender.com)

ScriptStudio turns a **product link and a client brief** into a **production-ready video script**. Every script follows the same house format, and you can open it in Google Docs or Word.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/anmolpickrr/ScriptStudio)

- **Product accuracy.** Product facts come from the product page. Each fact is quoted word for word from the page, and code checks that the quote is really there. Anything that can't be verified is flagged for the client, never invented.
- **Many specialist stages, not one prompt:**
  1. Product analysis
  2. Brief
  3. Accuracy check
  4. Three concepts, with a creative-director pick
  5. Timed beat sheet
  6. Script
  7. Quality review, with automatic revisions
- **Automated quality review:**
  - Visual and VO sync, and timing
  - Hook strength, story logic and dialogue
  - Product truth, fake-looking visuals and continuity
  - CTA, mandatories and exclusions
- **Consistent output.** The model fills in structured fields and code renders the document, so every script has the same layout. You can edit and version the format in the app.
- **Choose who writes it.** Use the free built-in AI (Google Gemini), or your own **ChatGPT** or **Claude** plan through a guided copy-and-paste step. Either way, the reply is fact-checked, quality-checked and formatted the same way.
- **Learns your standard.** Approved scripts, with the editor's note on why they're good, guide future scripts.

## What you can do in the app

| | |
|---|---|
| **New script** | Product link + brief (required). Platform and length, plus optional creative direction: hook type, theme, references, must-include and avoid. |
| **Live progress** | Step-by-step pipeline status with elapsed time. You can leave the page while it works. |
| **Script view** | Doc-identical preview (responsive on phones), quality scores and findings, client flags, the concepts explored, and verified product facts. |
| **Iterate** | *Revise with notes*, *Use this concept*, and *Try again* on failures. Revision history is kept. |
| **Export** | Word (.docx), which opens in Google Docs, Word or Pages. Direct Google Docs export when Google sign-in is configured. HTML. |
| **House standard** | Approve scripts into the house library. Edit the house format (sections, quality bar, editorial rules) as an admin. |

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript + Vite (`frontend/`) |
| Backend | Python 3.12, FastAPI (`backend/`), served from the same container as the UI |
| AI | **Google Gemini free tier** by default (no card); also OpenAI, Groq, OpenRouter or any OpenAI-compatible API — structured, schema-validated outputs |
| Access | **Guest mode** (open link, private workspace per browser, daily caps) or **Google sign-in** (domain allowlists, admins) |
| Hosting | **Render free plan** + **Neon free Postgres** (one click, $0), or Google Cloud Run + Firestore |
| CI/CD | GitHub Actions: tests, type-check, container end-to-end test, deploys, and a live-URL smoke test |

## Run locally

```bash
cp .env.example backend/.env      # set GEMINI_API_KEY (free), or LLM_PROVIDER=demo to try it without AI
make install
make dev-api                      # terminal 1 → API on :8000
make dev-web                      # terminal 2 → open http://localhost:5173
```

Or run the production image with `docker compose up --build`, which serves http://localhost:8080.

## Deploy

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

The **Deploy to Render** button above sets everything up on free plans: Render (server), Neon (database) and Google Gemini (AI). No card is needed, and it costs $0. You paste two free keys, and you get a public `https://…onrender.com` link. Every push to `main` then redeploys. The website itself is also published to GitHub Pages by `pages.yml`; it calls the Render API, which allows that address through `CORS_ORIGINS`.

## Tests

```bash
make test        # backend unit + API tests (no network or API key needed) + frontend type-check
```

CI also builds the production container, runs it with a data disk against a real product page, and checks the exports and restart recovery. After deploying, run **Actions → Smoke test (live URL)** with your URL. It generates a real script on the live site and verifies the exports.

## Repository map

```
backend/app/
  main.py              app, security headers, CSRF guard, SPA serving, startup job recovery
  routes/jobs.py       create / list / view / revise / switch concept / retry / approve / export / delete
  routes/system.py     config, auth (Google, guest, admin passcode), options, library, house format, task callback
  auth.py              sessions, guest workspaces, allowlists, admin, Cloud Tasks OIDC
  worker.py            Cloud Tasks dispatch or bounded in-process runner
  pipeline.py          multi-stage workflow and QC/revision loop
  prompts.py           specialist role prompts + shared craft standard
  ingest/              product-page analysis (JSON-LD, Shopify, vision), references
  qc/checks.py         deterministic quality gates
  render/              HTML (preview + Google Docs), Word (.docx), Google Docs export
  netsafe.py           SSRF-safe fetching of user-supplied links
  store.py, memory.py  local disk / Firestore persistence, usage caps, approved-script style memory
frontend/src/          pages (New script, Script view, My scripts, Library, Format), UI kit, API client
infra/                 entrypoint, Render blueprint (../render.yaml), Google Cloud setup + deploy scripts
.github/workflows/     ci.yml, pages.yml (website on GitHub Pages), deploy.yml (Cloud Run), smoke.yml (live URL check)
```
