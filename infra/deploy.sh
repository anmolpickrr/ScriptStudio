#!/usr/bin/env bash
# Build and deploy to Cloud Run.
#   Manual:          bash infra/deploy.sh                (builds with Cloud Build)
#   GitHub Actions:  IMAGE=<already-pushed-image> bash infra/deploy.sh
# Settings come from infra/config.env if present, otherwise from the environment.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[[ -f infra/config.env ]] && source infra/config.env
: "${PROJECT_ID:?}" "${REGION:?}" "${SERVICE:?}"
# With a Google OAuth client, people sign in with Google; without one, the link is open and each browser
# gets a private guest workspace (protected by the daily limits below).
AUTH_MODE="${AUTH_MODE:-$([[ -n "${GOOGLE_CLIENT_ID:-}" ]] && echo google || echo anonymous)}"

RUN_SA="${SERVICE}-run@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"

if [[ -z "${IMAGE:-}" ]]; then
  IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE}/app:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
  gcloud builds submit --project "$PROJECT_ID" --region "$REGION" --tag "$IMAGE" .
fi

# ^@^ switches gcloud's list delimiter so comma-separated values survive intact.
ENV_VARS="^@^APP_ENV=production@PUBLIC_BASE_URL=${URL}@LLM_PROVIDER=${LLM_PROVIDER:-openai}\
@AUTH_MODE=${AUTH_MODE}@GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}@ADMIN_EMAILS=${ADMIN_EMAILS:-}\
@ALLOWED_EMAIL_DOMAINS=${ALLOWED_EMAIL_DOMAINS:-}@ALLOWED_EMAILS=${ALLOWED_EMAILS:-}\
@DAILY_JOB_LIMIT=${DAILY_JOB_LIMIT:-15}@GLOBAL_DAILY_LIMIT=${GLOBAL_DAILY_LIMIT:-200}@MODEL_CREATIVE=${MODEL_CREATIVE:-gpt-5}@MODEL_CRITIC=${MODEL_CRITIC:-gpt-5}\
@MODEL_EXTRACT=${MODEL_EXTRACT:-gpt-5-mini}@REASONING_EFFORT=${REASONING_EFFORT:-medium}\
@STORE_BACKEND=firestore@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}\
@CLOUD_TASKS_QUEUE=projects/${PROJECT_ID}/locations/${REGION}/queues/${SERVICE}-jobs@TASKS_SERVICE_ACCOUNT=${RUN_SA}"

SECRETS="OPENAI_API_KEY=openai-api-key:latest,SESSION_SECRET=session-secret:latest"
gcloud secrets describe admin-passcode --project "$PROJECT_ID" >/dev/null 2>&1 && \
  SECRETS="${SECRETS},ADMIN_PASSCODE=admin-passcode:latest"

gcloud run deploy "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --image "$IMAGE" \
  --service-account "$RUN_SA" --allow-unauthenticated \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "$SECRETS" \
  --cpu 1 --memory 1Gi --concurrency 20 --timeout 1800 --min-instances 0 --max-instances 10

echo
echo "Live at: $URL"
curl -fsS "$URL/api/health" >/dev/null && echo "Health check passed."
