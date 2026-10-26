# Scriptwright

Scriptwright turns a **product link and a client brief** into a **production-ready video script**. Every script follows the same house format and is exported to Google Docs in one click.

- **Product accuracy.** Product facts come from the product page. Each fact must be quoted word for word from the page, and code checks that the quote is really there. Anything that can't be verified is flagged, never invented.
- **Many specialist stages, not one prompt.** The steps are:
  1. Product analysis
  2. Brief
  3. Accuracy check
  4. Three concepts, with a creative-director pick
  5. Timed beat sheet
  6. Script
  7. Quality review, with automatic revisions
- **Automated quality review.** It checks:
  - Visual and VO sync, and timing
  - Hook strength, story logic and dialogue
  - Product truth, fake-looking visuals and continuity
  - CTA, mandatories and exclusions
- **Consistent output.** The model fills in structured fields and code renders the document, so every Google Doc has the same layout. You can edit and version the format in the app.
- **Learns your standard.** Approved scripts, with the editor's note on why they're good, guide future scripts.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript + Vite (`frontend/`) |
| Backend | Python 3.12, FastAPI (`backend/`) |
| AI | OpenAI Responses API with strict structured outputs (models configurable) |
| Hosting | Google Cloud Run: one container serves the API and the UI, at a public HTTPS URL |
| Jobs | Cloud Tasks → authenticated callback to the service (retries, 30-minute runs) |
| Data | Firestore (jobs, formats with version history, approved library) |
| Auth | Google Sign-In; optional domain allowlist; admins; per-user daily limits |
| Docs export | Google Drive API (HTML → native Google Doc) with the user's own `drive.file` permission |
| CI/CD | GitHub Actions → keyless deploy to Cloud Run (Workload Identity Federation) |

## Quick start (local)

```bash
cp .env.example backend/.env      # set OPENAI_API_KEY, or LLM_PROVIDER=demo to try without AI
make install
make dev-api                      # terminal 1 → http://localhost:8000/api/health
make dev-web                      # terminal 2 → http://localhost:5173
```

You can also run the production image with `docker compose up --build`, which serves http://localhost:8080.

Locally, `AUTH_MODE=none` signs you in as a single admin user. In demo mode (`LLM_PROVIDER=demo`), placeholder scripts are produced so you can try the whole UI with no API key.

## Deploy to a public URL

Allow about 20 minutes the first time. See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. In short:

1. Create a Google Cloud project with billing.
2. Create a Google OAuth client.
3. Run `bash infra/setup-gcp.sh`.
4. Run `bash infra/deploy.sh`.

From then on, every push to `main` deploys automatically.

## Tests

```bash
make test        # 26 backend tests (no network or API key needed) + frontend type-check
```

## Repository map

```
backend/app/
  main.py              app, security headers, CSRF guard, SPA serving
  routes/jobs.py       create / list / view / revise / switch concept / approve / export / delete
  routes/system.py     auth, config, options, library, house format, Cloud Tasks callback
  auth.py              Google sign-in, signed session cookie, allowlists, admin, task OIDC
  worker.py            Cloud Tasks dispatch + execution
  pipeline.py          multi-stage workflow and QC/revision loop
  prompts.py           specialist role prompts + shared craft standard
  ingest/              product-page analysis (JSON-LD, Shopify, vision), references
  qc/checks.py         deterministic quality gates
  render/              HTML renderer (preview = Doc) and Google Docs export
  netsafe.py           SSRF-safe fetching of user-supplied links
  playbook.py          platform specs, hook library, cliché and fake-visual lists
  house_format.py      versioned format spec
  store.py, memory.py  Firestore/local persistence, approved-script style memory
  llm.py, llm_demo.py  OpenAI client wrapper, demo provider
frontend/src/
  pages/               New script, Script view, Scripts, House library, House format, Sign-in
  components/ui.tsx    toasts, modal, tag input, status badge
infra/                 setup-gcp.sh, deploy.sh, config.env.example
docs/                  ARCHITECTURE.md, DEPLOYMENT.md
```
