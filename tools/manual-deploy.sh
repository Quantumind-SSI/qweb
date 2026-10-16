#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-.}"
cd "$REPO_DIR"

# Deployment token from env or Azure CLI
DEPLOY_TOKEN="${SWA_DEPLOY_TOKEN:-}"
if [ -z "$DEPLOY_TOKEN" ]; then
  # Try to fetch from Azure
  if command -v az >/dev/null 2>&1; then
    SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-45bc20c4-efcb-4bd4-9c70-ee1dcf271880}"
    RG="rg-oluwaferanmi-9431"
    APP="swa-quantumindssi"
    az account set --subscription "$SUBSCRIPTION_ID" >/dev/null
    DEPLOY_TOKEN=$(az staticwebapp secrets list -n "$APP" -g "$RG" --query properties.apiKey -o tsv)
  fi
fi

if [ -z "$DEPLOY_TOKEN" ]; then
  echo "SWA_DEPLOY_TOKEN not set and could not fetch from Azure" >&2
  exit 1
fi

export SWA_CLI_DEPLOYMENT_TOKEN="$DEPLOY_TOKEN"

echo "[manual-deploy] Deploying $(pwd) to production..."

npx @azure/static-web-apps-cli@latest deploy . \
  --env production \
  --deployment-token "$DEPLOY_TOKEN" \
  --api-location api \
  --app-location . \
  --api-language node \
  --api-version 20

echo "[manual-deploy] Done."
