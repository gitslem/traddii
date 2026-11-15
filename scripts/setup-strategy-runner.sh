#!/usr/bin/env bash
#
# One-time setup for the scheduled strategy runner and push alerts.
# Creates, and stores as GitHub Actions secrets of the repository:
#   FIREBASE_RUNNER_KEY    key of a service account that can only read and write Firestore
#   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VITE_VAPID_PUBLIC_KEY   Web Push keys
# Keys are written to a private temporary folder, piped to `gh secret set`
# and deleted; nothing is printed.
#
# Needs: gcloud signed in as an owner of the Firebase project, gh signed in
# with access to the repository, and `npm install` run in this folder.
#
# Usage: scripts/setup-strategy-runner.sh [project-id] [owner/repo]
set -euo pipefail

PROJECT="${1:-traddii}"
REPO="${2:-gitslem/traddii}"
SA_NAME="strategy-runner"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

cd "$(dirname "$0")/.."

echo "Project: ${PROJECT}   Repository: ${REPO}"
gcloud projects describe "$PROJECT" --format="value(projectId)" >/dev/null \
  || { echo "gcloud cannot see project ${PROJECT}. Run: gcloud auth login (with the project owner's account)"; exit 1; }
gh repo view "$REPO" >/dev/null || { echo "gh cannot see ${REPO}. Run: gh auth login"; exit 1; }

TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# 1. Service account with Firestore access only
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
    --display-name "Traddii strategy runner (GitHub Actions)"
fi
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:${SA_EMAIL}" --role "roles/datastore.user" --condition=None >/dev/null
gcloud iam service-accounts keys create "$TMP/key.json" --iam-account "$SA_EMAIL" --project "$PROJECT" >/dev/null
gh secret set FIREBASE_RUNNER_KEY --repo "$REPO" < "$TMP/key.json"
echo "Stored FIREBASE_RUNNER_KEY."

# 2. Web Push keys, created once (new keys would cut off every existing subscription)
if gh secret list --repo "$REPO" | grep -q '^VAPID_PRIVATE_KEY'; then
  echo "Web Push keys already exist; kept them."
else
  node -e "const k=require('web-push').generateVAPIDKeys();const fs=require('fs');fs.writeFileSync(process.argv[1],k.publicKey);fs.writeFileSync(process.argv[2],k.privateKey)" "$TMP/pub" "$TMP/priv"
  gh secret set VAPID_PRIVATE_KEY --repo "$REPO" < "$TMP/priv"
  gh secret set VAPID_PUBLIC_KEY --repo "$REPO" < "$TMP/pub"
  gh secret set VITE_VAPID_PUBLIC_KEY --repo "$REPO" < "$TMP/pub"
  echo "Stored the Web Push keys."
fi

echo
echo "Done. Next:"
echo "  1. Deploy the site again (push to main) so it picks up VITE_VAPID_PUBLIC_KEY."
echo "  2. Run the runner once by hand: gh workflow run strategy-runner.yml --repo ${REPO}"
echo "  3. Check it: gh run list --workflow strategy-runner.yml --repo ${REPO}"
