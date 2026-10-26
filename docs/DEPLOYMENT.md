# Deployment guide

The app runs as **one Cloud Run service**. The same container serves the API and the web UI, so you get a single public HTTPS URL like `https://scriptwright-123456789.asia-south1.run.app`.

Background generation goes through **Cloud Tasks**, and data lives in **Firestore**. Secrets are kept in **Secret Manager**.

Anyone can open the URL. To use the app, they sign in with Google, and you control who is allowed in (step 6).

## What you need

- A Google Cloud project with billing enabled.
- An OpenAI API key with access to the models you configure.
- Your repository on GitHub, for automatic deploys.

Run the commands in **Google Cloud Shell**, which comes with `gcloud` already logged in. Any machine where you've run `gcloud auth login` also works.

## Step 1 — Get the code into Cloud Shell

```bash
git clone https://github.com/<you>/<repo>.git && cd <repo>
```

## Step 2 — Fill in the settings

```bash
cp infra/config.env.example infra/config.env
nano infra/config.env      # PROJECT_ID, REGION, GITHUB_REPO, ADMIN_EMAILS (GOOGLE_CLIENT_ID comes in step 3)
```

## Step 3 — Create the Google sign-in client

In the Google Cloud Console, open **APIs & Services → OAuth consent screen**. The newer console calls this **Google Auth Platform → Branding / Audience**.

1. Set up the consent screen:
   - **User type:** choose **External** so anyone with a Google account can use the app. Choose **Internal** if everyone is in your Google Workspace.
   - **App name:** Scriptwright. Add your support email.
   - **Scopes:** add `.../auth/drive.file`. This is a non-sensitive scope, so Google doesn't need to review the app.
   - **Publishing status:** click **Publish app** so it's "In production". While the app is in "Testing", only the test users you list can sign in.
2. Go to **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized JavaScript origins:**
     - `https://<SERVICE>-<PROJECT_NUMBER>.<REGION>.run.app`. Step 4 prints this exact URL, so you can come back and add it afterwards.
     - `http://localhost:5173` and `http://localhost:8080`, for local development.
   - You don't need any redirect URIs.
3. Copy the **Client ID** into `GOOGLE_CLIENT_ID` in `infra/config.env`.

## Step 4 — One-time cloud setup

```bash
bash infra/setup-gcp.sh
```

The script does the following:
- Enables the required APIs.
- Creates the runtime and deployer service accounts.
- Creates Firestore, the Artifact Registry repository and the Cloud Tasks queue.
- Asks for your **OpenAI key** and stores it in Secret Manager, along with a generated session secret.
- Sets up keyless GitHub deploys.

At the end it prints your **app URL** and the **GitHub variables** for step 7. Add the URL to the OAuth client's origins (step 3).

## Step 5 — First deploy

```bash
bash infra/deploy.sh
```

This builds the image with Cloud Build, deploys it and runs a health check. Open the printed URL, sign in, and generate a script.

## Step 6 — Control who can use it

These settings go in `infra/config.env` (or the GitHub variables). Redeploy after changing them.

| Setting | Effect |
|---|---|
| `ALLOWED_EMAIL_DOMAINS=youragency.com,client.com` | Only these domains can sign in |
| `ALLOWED_EMAILS=freelancer@gmail.com` | Allows individual extra addresses |
| *(both empty)* | Any Google account can sign in |
| `ADMIN_EMAILS=you@youragency.com` | Can edit the house format and library, and has no daily limit |
| `DAILY_JOB_LIMIT=15` | Generations + revisions per user per day (protects your OpenAI budget) |

## Step 7 — Automatic deploys from GitHub

In GitHub, open **Settings → Secrets and variables → Actions → Variables** and add these repository variables:

| Variable | Value |
|---|---|
| `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA` | printed by `setup-gcp.sh` |
| `PROJECT_ID`, `REGION`, `SERVICE` | same as `infra/config.env` |
| `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS`, `ALLOWED_EMAILS`, `DAILY_JOB_LIMIT` | same as `infra/config.env` |
| `MODEL_CREATIVE`, `MODEL_CRITIC`, `MODEL_EXTRACT`, `REASONING_EFFORT` | optional |

From then on, every push to `main` runs CI (tests, frontend build and Docker build). If CI passes, the change deploys. No keys are stored in GitHub; the deploy authenticates through Workload Identity Federation.

## Operating it

- **Logs:** Cloud Console → Cloud Run → `scriptwright` → Logs. Each pipeline stage is logged with its model and duration.
- **Config check:** while signed in as an admin, open `/api/admin/status`. It lists missing settings, such as an absent API key.
- **Change models:** set the `MODEL_*` variables and redeploy. Any model on your OpenAI account that supports structured outputs works.
- **Rotate the OpenAI key:** run `printf %s "$NEW_KEY" | gcloud secrets versions add openai-api-key --data-file=-`, then redeploy.
- **Costs:** Cloud Run scales to zero, so you pay only while it's in use. Firestore and Tasks cost almost nothing at agency scale. OpenAI cost depends on your models; one script is about 8–14 model calls.
- **Custom domain:** Cloud Run → Manage custom domains, or put a load balancer in front. Add the new origin to the OAuth client.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Google button says "origin not allowed" | The app URL is missing from the OAuth client's **Authorized JavaScript origins**. Changes take a few minutes to apply. |
| "doesn't have access to this workspace" | Add the user's email or domain to `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`. |
| Sign-in only works for some people | The OAuth consent screen is still in **Testing**. Publish it. |
| Jobs stay "Queued" | Check the Cloud Tasks queue in the console and the Cloud Run logs for `/tasks/run`. Make sure `infra/setup-gcp.sh` finished; it grants the token permissions. |
| "AI service rejected our credentials" | The `openai-api-key` secret is wrong, or the account has no credit. |
| "configured AI model isn't available" | Your OpenAI account can't use that model. Change `MODEL_*`. |
| Export popup closes immediately | Allow pop-ups for the site; the Drive permission prompt is a Google popup. |
| `gcloud builds submit` permission error | Re-run `infra/setup-gcp.sh`, or deploy through GitHub Actions instead (it builds on GitHub). |
