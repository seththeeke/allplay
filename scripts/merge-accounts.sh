#!/usr/bin/env bash
# Folds a duplicate account into the primary (authn-authz.md section 6.2):
# data moves, the duplicate becomes MERGED, its Cognito user is deleted and
# its Google or Apple identities are linked to the primary's user.
# Usage: scripts/merge-accounts.sh <Test|Prod> <primaryPlayerId> <duplicatePlayerId>
# Player ids look like ACCT#<sub>; GET /v1/admin/players/duplicates lists them.
# It changes AWS resources, so it follows the CLAUDE.md deploy safety gate.
set -euo pipefail

STAGE="${1:-}"
PRIMARY="${2:-}"
DUPLICATE="${3:-}"
if [[ "$STAGE" != "Test" && "$STAGE" != "Prod" ]] || [[ -z "$PRIMARY" || -z "$DUPLICATE" ]]; then
  echo "Usage: scripts/merge-accounts.sh <Test|Prod> <primaryPlayerId> <duplicatePlayerId>" >&2
  exit 2
fi
for ID in "$PRIMARY" "$DUPLICATE"; do
  if [[ ! "$ID" =~ ^ACCT#[A-Za-z0-9-]+$ ]]; then
    echo "merge-accounts: '$ID' is not an account player id (ACCT#<sub>)." >&2
    exit 2
  fi
done

PAYLOAD=$(printf '{"operatorTask":"MERGE_ACCOUNTS","primaryPlayerId":"%s","duplicatePlayerId":"%s"}' "$PRIMARY" "$DUPLICATE")
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
aws lambda invoke --profile allplays --region us-east-1 \
  --function-name "AllPlay-AdminApi-${STAGE}" --cli-binary-format raw-in-base64-out \
  --payload "$PAYLOAD" "$OUT" >/dev/null
cat "$OUT"
echo
if ! grep -q '"statusCode":200' "$OUT"; then
  echo "merge-accounts: the merge did not complete." >&2
  exit 1
fi
