# Deployment guide

There are two supported hosts. Both run the same Docker image, which serves the web app and the API from a single public HTTPS URL.

| | **Render** (recommended to start) | **Google Cloud Run** |
|---|---|---|
| Setup time | ~5 minutes, all in the browser | ~20 minutes, in Cloud Shell |
| You need | A Render account and an OpenAI API key | A Google Cloud project with billing, and an OpenAI key |
| Cost | Starter instance + 1 GB disk (about $7–8/month) + OpenAI | Pay per use, scales to zero + OpenAI |
| Storage / jobs | Persistent disk, in-process job runner | Firestore and Cloud Tasks |
| Auto-deploy | Every push to `main` | Every push to `main` (GitHub Actions) |

## Option A — Render (one click)

1. Click **[Deploy to Render](https://render.com/deploy?repo=https://github.com/anmolpickrr/ScriptStudio)** and sign in. Signing in with GitHub is easiest.
2. Render reads `render.yaml` and asks for two values:
   - **OPENAI_API_KEY**: your OpenAI key, which must have access to the models listed in `render.yaml`.
   - **ADMIN_PASSCODE**: any passphrase. Enter it on the *House format* page to edit the format.
3. Click **Apply**. The first build takes about 5 minutes. Your URL looks like `https://scriptstudio-xxxx.onrender.com`.
4. Open the URL. You should see the **New script** page. Generate a script to confirm it works.
5. **Verify end to end** (optional): in GitHub, go to **Actions → Smoke test (live URL) → Run workflow** and paste the URL. It loads the page, generates a real script from a real product page, and checks the Word and HTML exports.

### Who can use it

By default (`AUTH_MODE=anonymous`), anyone with the link can use the app. Each browser gets its own private workspace, and nobody sees anyone else's scripts. Two limits protect your OpenAI budget:

| Setting (Render → Environment) | Default | Meaning |
|---|---|---|
| `DAILY_JOB_LIMIT` | 10 | Generations + revisions per browser per day |
| `GLOBAL_DAILY_LIMIT` | 100 | Generations + revisions for the whole app per day |

To require **Google sign-in** instead:
1. Set `AUTH_MODE=google` and `GOOGLE_CLIENT_ID` (see "Google sign-in" below).
2. Optionally set `ALLOWED_EMAIL_DOMAINS` (e.g. `pickrr.com`) and `ADMIN_EMAILS`.

## Option B — Google Cloud Run

Run these in **Google Cloud Shell**:

```bash
git clone https://github.com/anmolpickrr/ScriptStudio.git && cd ScriptStudio
cp infra/config.env.example infra/config.env && nano infra/config.env   # PROJECT_ID, REGION, GITHUB_REPO
bash infra/setup-gcp.sh     # APIs, Firestore, queue, service accounts; asks for OpenAI key + admin passcode
bash infra/deploy.sh        # builds, deploys, prints the live URL and health-checks it
```

Leave `GOOGLE_CLIENT_ID` empty for guest mode (an open link), or set it for Google sign-in.

For automatic deploys, add the GitHub repository variables that `setup-gcp.sh` prints. Go to **Settings → Secrets and variables → Actions → Variables** and add `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `PROJECT_ID`, `REGION` and the rest of `config.env`. No keys are stored in GitHub; the deploy uses Workload Identity Federation.

## Google sign-in and direct Google Docs export (optional, either host)

Without this, users export **Word (.docx)**. Upload that file to Google Drive, or use *File → Open* in Google Docs, and it becomes a Doc with the same headings and tables.

With it, users also get **Export → Google Docs**, which creates a native Doc in their own Drive in one click.

1. In the Google Cloud Console, open **APIs & Services → OAuth consent screen**:
   - Choose **External**.
   - Add the scope `…/auth/drive.file`. It is non-sensitive, so Google doesn't need to review the app.
   - Click **Publish app**.
2. Go to **Credentials → Create credentials → OAuth client ID → Web application**:
   - Under **Authorized JavaScript origins**, add your app URL.
   - Copy the **Client ID**.
3. Set `GOOGLE_CLIENT_ID` on your host.
   - Keep `AUTH_MODE=anonymous` to get Docs export without requiring sign-in.
   - Set `AUTH_MODE=google` to require sign-in.

## Operating it

- **Health:** `GET /api/health`. While unlocked as admin, `/api/admin/status` lists configuration problems, such as a missing API key.
- **Models:** set `MODEL_CREATIVE`, `MODEL_CRITIC` and `MODEL_EXTRACT` to any OpenAI models your account can use with structured outputs.
- **Restarts:** if the server restarts mid-generation, new scripts restart automatically. Revisions that were interrupted keep the previous version and show a notice.
- **Logs:** the Render dashboard's **Logs** tab, or Cloud Run → Logs. Each pipeline stage logs its model and duration.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The AI service rejected our credentials" | `OPENAI_API_KEY` is wrong, or the OpenAI account has no credit |
| "configured AI model isn't available" | Change the `MODEL_*` variables to models your account can use |
| "reached today's generation capacity" | Raise `GLOBAL_DAILY_LIMIT` |
| Product page can't be read | Some sites block automated access. Use *Page won't load?* in the form to paste the product copy. |
| Google button says "origin not allowed" | Add the exact app URL to the OAuth client's Authorized JavaScript origins |
| Render build fails on the disk step | Disks need a paid instance type. Keep `plan: starter`. |
