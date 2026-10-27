# Deployment guide (free, no card)

ScriptStudio runs entirely on free plans:

| What | Service | Free limits |
|---|---|---|
| AI model | Google Gemini API (Google AI Studio) | About 10 requests a minute and a few hundred a day, which is roughly **20 scripts a day**. Google may use free-tier inputs to improve its products, so avoid confidential client material. |
| Server | Render free web service | Sleeps after 15 minutes without visitors, and the next visit takes about a minute. The *Keep alive* workflow can prevent this. |
| Database | Neon free Postgres | 0.5 GB, which holds thousands of scripts |
| Code and checks | GitHub (public repo) | Free |

Your ChatGPT Plus or Claude Pro subscriptions can't power the app: those are chat subscriptions, and apps need a separate "API" account. Gemini's free API key covers that.

---

## Step 1 — Free AI key from Google (about 2 minutes)

1. Open **https://aistudio.google.com/apikey** and sign in with any Google account.
2. If asked, accept the terms.
3. Click **Create API key**. If it asks for a project, pick the suggested one or create a new one.
4. Click **Copy**. Keep it in a private note for a few minutes. It starts with `AIza`.

No card is needed. If Google ever asks for billing details, stop: the free tier doesn't need them.

## Step 2 — Free database from Neon (about 3 minutes)

1. Open **https://neon.tech** and click **Sign up**. *Continue with Google* or *GitHub* is easiest.
2. Create a project:
   - **Name:** `scriptstudio`
   - **Postgres version:** leave the default.
   - **Region:** pick **AWS Asia Pacific (Singapore)**.
   - Click **Create project**.
3. On the project dashboard, click **Connect**. You'll see a **Connection string** starting with `postgresql://`.
4. Click **Copy snippet**, or the copy icon, and keep it in your private note.

## Step 3 — Put the app online with Render (about 3 minutes, then a 5–10 minute build)

1. Open **https://render.com/deploy?repo=https://github.com/anmolpickrr/ScriptStudio**
2. Click **Sign in with GitHub** and approve.
3. On the **Blueprint** page, fill the three boxes:
   - **GEMINI_API_KEY**: paste the key from Step 1.
   - **DATABASE_URL**: paste the connection string from Step 2.
   - **ADMIN_PASSCODE**: type any password you'll remember. It unlocks editing the house format in the app.
4. Make sure the plan says **Free**, then click **Apply**.
5. Open the **scriptstudio** service. Wait until the status at the top says **Live**.
6. Copy the URL under the service name, like `https://scriptstudio-xxxx.onrender.com`.

## Step 4 — Check it

Open the URL. You should see **New script**. Paste any product page link and a short brief, click **Generate script**, and wait 3–6 minutes. Free-tier requests are spaced out to stay within Google's limits, so it's slower than paid models.

Optionally, run the automatic end-to-end check: in GitHub, go to **Actions → Smoke test (live URL) → Run workflow** and paste the URL.

## Optional — keep it awake

In GitHub, go to **Settings → Secrets and variables → Actions → Variables → New repository variable**:
- **Name:** `KEEPALIVE_URL`
- **Value:** your app URL

A free GitHub workflow then pings the app every 10 minutes during the day, so visitors don't wait for it to wake up. One always-on app fits within Render's 750 free hours a month.

---

## Settings you can change later (Render → scriptstudio → Environment)

| Setting | Default | Meaning |
|---|---|---|
| `DAILY_JOB_LIMIT` | 5 | Scripts + revisions per browser per day |
| `GLOBAL_DAILY_LIMIT` | 20 | Scripts + revisions for the whole app per day (keeps you inside Gemini's free quota) |
| `MODEL_CREATIVE`, `MODEL_CRITIC`, `MODEL_EXTRACT` | `gemini-2.5-flash`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` | Change these if Google renames its free models |
| `LLM_PROVIDER` | `gemini` | `openai` (paid, set `OPENAI_API_KEY`), `groq` (free tier, set `GROQ_API_KEY`), `openrouter`, `compat` |
| `AUTH_MODE` | `anonymous` | `google` requires Google sign-in (needs `GOOGLE_CLIENT_ID`; see the Google Docs section) |

## Optional — direct "Export to Google Docs" (free)

Without this, users download **Word (.docx)**. Opening that file from Google Drive turns it into a Google Doc with the same layout.

For one-click export straight into Google Docs, you need a free Google OAuth client:
1. In **console.cloud.google.com → APIs & Services → OAuth consent screen**:
   - Choose **External**.
   - Add the scope `…/auth/drive.file`.
   - Click **Publish app**.
2. Go to **Credentials → Create credentials → OAuth client ID → Web application**.
   - Add your app URL under **Authorized JavaScript origins**.
   - Copy the **Client ID**.
3. In Render, add `GOOGLE_CLIENT_ID` with that value.

## Paid alternative: Google Cloud Run

`infra/setup-gcp.sh` and `infra/deploy.sh` deploy to Cloud Run with Firestore and Cloud Tasks. These need a billing account, though small usage often stays inside Google's free quotas. See the comments in those scripts.

## Troubleshooting

| What you see | What to do |
|---|---|
| "usage limit was reached" | The free AI quota for the minute or day is used up. Wait a few minutes, or until tomorrow. |
| "rejected our credentials" | `GEMINI_API_KEY` is wrong. Create a new key in AI Studio and update it in Render → Environment. |
| "configured AI model isn't available" | Google renamed its models. Set `MODEL_*` to current free models listed in AI Studio. |
| Site takes about a minute to open | It was asleep (free plan). Turn on *Keep alive* above. |
| Render status "Failed" | Open **Logs**. If it mentions `DATABASE_URL`, re-copy the Neon connection string. |
| Product page can't be read | Some shops block automated access. Use *Page won't load?* in the form to paste the product copy. |
