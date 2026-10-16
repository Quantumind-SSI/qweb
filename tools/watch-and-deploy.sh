#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-.}"
cd "$REPO_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/manual-deploy.sh"

# Ensure git repo
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Not a git repo"; exit 1; }

LAST_COMMIT=$(git rev-parse HEAD)

echo "[watch] Watching $REPO_DIR for pushes..."

while true; do
  sleep 5
  CURRENT_COMMIT=$(git rev-parse HEAD)
  if [ "$CURRENT_COMMIT" != "$LAST_COMMIT" ]; then
    echo "[watch] New commit detected: $LAST_COMMIT -> $CURRENT_COMMIT"
    git log -1 --oneline "$LAST_COMMIT..$CURRENT_COMMIT"
    # Optional: fetch remote to ensure it's a push
    # git fetch --quiet origin
    # Check if commit is reachable from origin/main?
    # For simplicity, deploy on any local HEAD change
    bash "$DEPLOY_SCRIPT" "$REPO_DIR" || echo "[watch] Deploy failed, continuing..."
    LAST_COMMIT="$CURRENT_COMMIT"
  fi
done
