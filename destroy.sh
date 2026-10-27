#!/usr/bin/env bash
# Removes everything deploy.sh created: the Cloud Run service, the runtime
# service account and its BigQuery grants. The logs dataset is NOT touched.
# Container images in Artifact Registry ("cloud-run-source-deploy") are kept.
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1091
[[ -f deploy.env ]] && set -a && source deploy.env && set +a

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${DATASET:?Set DATASET}"
DATA_PROJECT_ID="${DATA_PROJECT_ID:-$PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-bqca-audit-ui}"
SA_NAME="${SA_NAME:-bqca-audit-ui}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

cat <<EOF
This will delete:
  - Cloud Run service   ${SERVICE} (${PROJECT_ID}, ${REGION})
  - BigQuery grants     dataViewer on ${DATA_PROJECT_ID}.${DATASET}, jobUser on ${PROJECT_ID}
  - Service account     ${SA_EMAIL}
EOF
if [[ "${FORCE:-}" != "1" ]]; then
  read -r -p "Type the service name to confirm: " ans
  [[ "$ans" == "$SERVICE" ]] || { echo "Aborted."; exit 1; }
fi

gcloud run services delete "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --quiet || true

BQ_LOCATION="$(bq show --format=json "${DATA_PROJECT_ID}:${DATASET}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["location"])')"
bq query --quiet --use_legacy_sql=false --project_id="$PROJECT_ID" --location="$BQ_LOCATION" \
  "REVOKE \`roles/bigquery.dataViewer\` ON SCHEMA \`${DATA_PROJECT_ID}.${DATASET}\` FROM \"serviceAccount:${SA_EMAIL}\"" >/dev/null || true
gcloud projects remove-iam-policy-binding "$PROJECT_ID" --condition=None --quiet \
  --member "serviceAccount:${SA_EMAIL}" --role roles/bigquery.jobUser >/dev/null || true
gcloud iam service-accounts delete "$SA_EMAIL" --project "$PROJECT_ID" --quiet || true

echo "Done."
