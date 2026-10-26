#!/usr/bin/env bash
# One-time Google Cloud setup. Run from the repo root in Cloud Shell (or anywhere gcloud is logged in):
#   cp infra/config.env.example infra/config.env && edit it && bash infra/setup-gcp.sh
# Safe to re-run: every step checks before creating.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source infra/config.env
: "${PROJECT_ID:?}" "${REGION:?}" "${SERVICE:?}"

RUN_SA="${SERVICE}-run@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="${SERVICE}-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

say "Enabling APIs (takes a minute the first time)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com cloudtasks.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com drive.googleapis.com docs.googleapis.com

say "Runtime service account: $RUN_SA"
gcloud iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${SERVICE}-run" --display-name "Scriptwright runtime"
for role in roles/datastore.user roles/cloudtasks.enqueuer roles/secretmanager.secretAccessor roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUN_SA" --role "$role" --condition=None >/dev/null
done
# Cloud Tasks mints OIDC tokens as this account when calling back into the service.
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member "serviceAccount:$RUN_SA" \
  --role roles/iam.serviceAccountUser >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --member "serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator >/dev/null 2>&1 || true

# Cloud Build (used by infra/deploy.sh for manual deploys) runs as the default compute account on new projects.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/cloudbuild.builds.builder --condition=None >/dev/null 2>&1 || true

say "Firestore (Native mode)"
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || \
  gcloud firestore databases create --location="$REGION" --type=firestore-native

say "Artifact Registry repository"
gcloud artifacts repositories describe "$SERVICE" --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$SERVICE" --repository-format docker --location "$REGION"

say "Cloud Tasks queue"
gcloud tasks queues describe "${SERVICE}-jobs" --location "$REGION" >/dev/null 2>&1 || \
  gcloud tasks queues create "${SERVICE}-jobs" --location "$REGION" \
    --max-concurrent-dispatches 10 --max-attempts 2 --min-backoff 30s

say "Secrets"
if ! gcloud secrets describe openai-api-key >/dev/null 2>&1; then
  read -rsp "Paste your OpenAI API key (input hidden): " KEY; echo
  printf %s "$KEY" | gcloud secrets create openai-api-key --data-file=- --replication-policy automatic
fi
if ! gcloud secrets describe session-secret >/dev/null 2>&1; then
  python3 -c "import secrets;print(secrets.token_hex(32),end='')" | \
    gcloud secrets create session-secret --data-file=- --replication-policy automatic
fi

if [[ -n "${GITHUB_REPO:-}" ]]; then
  say "Keyless deploys from GitHub ($GITHUB_REPO) via Workload Identity Federation"
  gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "${SERVICE}-deploy" --display-name "Scriptwright GitHub deployer"
  for role in roles/run.admin roles/artifactregistry.writer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" --role "$role" --condition=None >/dev/null
  done
  gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member "serviceAccount:$DEPLOY_SA" \
    --role roles/iam.serviceAccountUser >/dev/null
  gcloud iam workload-identity-pools describe github --location global >/dev/null 2>&1 || \
    gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions"
  gcloud iam workload-identity-pools providers describe github --location global --workload-identity-pool github >/dev/null 2>&1 || \
    gcloud iam workload-identity-pools providers create-oidc github --location global --workload-identity-pool github \
      --issuer-uri "https://token.actions.githubusercontent.com" \
      --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
      --attribute-condition "assertion.repository=='${GITHUB_REPO}'"
  gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
    --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}" >/dev/null
  WIF="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github"
fi

say "Done. Your app URL will be:  https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
echo "  1. Add that URL as an Authorized JavaScript origin on your OAuth client (docs/DEPLOYMENT.md, step 3)."
echo "  2. Deploy:  bash infra/deploy.sh"
if [[ -n "${WIF:-}" ]]; then
  echo "  3. For auto-deploys, add these GitHub repository *variables* (Settings → Secrets and variables → Actions → Variables):"
  echo "       GCP_WIF_PROVIDER = $WIF"
  echo "       GCP_DEPLOY_SA    = $DEPLOY_SA"
  echo "     plus every non-secret setting from infra/config.env (PROJECT_ID, REGION, SERVICE, GOOGLE_CLIENT_ID, ADMIN_EMAILS, ...)."
fi
