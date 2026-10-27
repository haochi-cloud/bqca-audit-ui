#!/usr/bin/env bash
# Deploys the BQCA Conversation Audit UI to Cloud Run behind IAP.
#
# Configuration is read from environment variables, optionally loaded from
# ./deploy.env (copy deploy.env.example). Re-running is safe (idempotent).
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1091
[[ -f deploy.env ]] && set -a && source deploy.env && set +a

: "${PROJECT_ID:?Set PROJECT_ID (Cloud Run + BigQuery job project)}"
: "${DATASET:?Set DATASET (dataset holding the ADK agent-analytics tables)}"
: "${IAP_MEMBERS:?Set IAP_MEMBERS, e.g. group:bqca-admins@example.com,user:alice@example.com}"
DATA_PROJECT_ID="${DATA_PROJECT_ID:-$PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-bqca-audit-ui}"
SA_NAME="${SA_NAME:-bqca-audit-ui}"
SLOW_MS="${SLOW_MS:-15000}"
HIGH_TOKENS="${HIGH_TOKENS:-100000}"
MAX_BYTES_BILLED="${MAX_BYTES_BILLED:-21474836480}"
TABLE_LABEL="${TABLE_LABEL-adk_schema_version}"

log() { printf '\n==> %s\n' "$*"; }
for bin in gcloud bq python3; do
  command -v "$bin" >/dev/null || { echo "Missing required tool: $bin" >&2; exit 1; }
done
gcloud auth print-access-token >/dev/null 2>&1 || { echo "Run 'gcloud auth login' first." >&2; exit 1; }

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
IAP_AGENT="service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com"

log "Checking dataset ${DATA_PROJECT_ID}:${DATASET}"
BQ_LOCATION="$(bq show --format=json "${DATA_PROJECT_ID}:${DATASET}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["location"])')"
echo "    location: ${BQ_LOCATION}"

log "Enabling required APIs in ${PROJECT_ID}"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  iap.googleapis.com bigquery.googleapis.com --project "$PROJECT_ID"

log "Runtime service account: ${SA_EMAIL}"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT_ID" \
    --display-name "BQCA audit UI (read-only BigQuery)"
  sleep 10  # IAM propagation
fi

log "Least-privilege BigQuery access"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --condition=None --quiet \
  --member "serviceAccount:${SA_EMAIL}" --role roles/bigquery.jobUser >/dev/null
# Dataset-scoped grant via DCL (works without the dataset-IAM allowlist).
bq query --quiet --use_legacy_sql=false --project_id="$PROJECT_ID" --location="$BQ_LOCATION" \
  "GRANT \`roles/bigquery.dataViewer\` ON SCHEMA \`${DATA_PROJECT_ID}.${DATASET}\` TO \"serviceAccount:${SA_EMAIL}\"" >/dev/null

log "Building & deploying ${SERVICE} to Cloud Run (${REGION}) with IAP"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --source . \
  --service-account "$SA_EMAIL" \
  --no-allow-unauthenticated \
  --iap \
  --cpu 1 --memory 1Gi --concurrency 40 --min-instances 0 --max-instances 3 --timeout 300 \
  --set-env-vars "PROJECT_ID=${PROJECT_ID},DATA_PROJECT_ID=${DATA_PROJECT_ID},DATASET=${DATASET},BQ_LOCATION=${BQ_LOCATION},SLOW_MS=${SLOW_MS},HIGH_TOKENS=${HIGH_TOKENS},MAX_BYTES_BILLED=${MAX_BYTES_BILLED},TABLE_LABEL=${TABLE_LABEL}" \
  --labels "app=bqca-audit-ui" \
  --quiet

log "Allowing only the IAP service agent to invoke Cloud Run"
gcloud run services add-iam-policy-binding "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --member "serviceAccount:${IAP_AGENT}" --role roles/run.invoker >/dev/null

log "Granting IAP access"
IFS=',' read -ra MEMBERS <<< "$IAP_MEMBERS"
for m in "${MEMBERS[@]}"; do
  m="$(echo "$m" | xargs)"
  [[ -z "$m" ]] && continue
  gcloud iap web add-iam-policy-binding --project "$PROJECT_ID" \
    --resource-type=cloud-run --service="$SERVICE" --region="$REGION" \
    --member="$m" --role=roles/iap.httpsResourceAccessor --condition=None >/dev/null
  echo "    granted $m"
done

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
log "Deployed: ${URL}"
