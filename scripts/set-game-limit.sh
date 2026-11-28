#!/usr/bin/env bash
# Sets an account's game limit in a stage (productionalization.md section 5).
# Usage: scripts/set-game-limit.sh <Test|Prod> <email> <UNLIMITED|n/DAY|n/WEEK|n/MONTH|DEFAULT>
# DEFAULT clears the account's own limit, back to the stage's default.
# It changes AWS resources, so it follows the CLAUDE.md deploy safety gate.
set -euo pipefail

STAGE="${1:-}"
EMAIL="$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')"
LIMIT="${3:-}"
if [[ "$STAGE" != "Test" && "$STAGE" != "Prod" ]] || [[ -z "$EMAIL" || -z "$LIMIT" ]]; then
  echo "Usage: scripts/set-game-limit.sh <Test|Prod> <email> <UNLIMITED|n/DAY|n/WEEK|n/MONTH|DEFAULT>" >&2
  exit 2
fi
if [[ ! "$EMAIL" =~ ^[^[:space:]\"]+@[^[:space:]\"]+$ ]]; then
  echo "set-game-limit: '$EMAIL' is not an email address." >&2
  exit 2
fi
if [[ "$LIMIT" == "UNLIMITED" ]]; then
  VALUE='{"M":{"unlimited":{"BOOL":true}}}'
elif [[ "$LIMIT" =~ ^([0-9]+)/(DAY|WEEK|MONTH)$ ]]; then
  VALUE="{\"M\":{\"count\":{\"N\":\"${BASH_REMATCH[1]}\"},\"period\":{\"S\":\"${BASH_REMATCH[2]}\"}}}"
elif [[ "$LIMIT" != "DEFAULT" ]]; then
  echo "set-game-limit: '$LIMIT' is not UNLIMITED, n/DAY, n/WEEK, n/MONTH or DEFAULT." >&2
  exit 2
fi

REGION="us-east-1"
TABLE="AllPlay-Players-${STAGE}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
PLAYER_IDS=$(aws dynamodb query --profile allplays --region "$REGION" --table-name "$TABLE" \
  --index-name ByEmail --key-condition-expression "emailKey = :e" \
  --filter-expression "#s = :active" --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values "{\":e\":{\"S\":\"${EMAIL}\"},\":active\":{\"S\":\"ACTIVE\"}}" \
  --query "Items[].playerId.S" --output text)
if [[ -z "$PLAYER_IDS" || "$PLAYER_IDS" == "None" ]]; then
  echo "set-game-limit: no active ${STAGE} account has that email." >&2
  exit 1
fi

for PLAYER_ID in $PLAYER_IDS; do
  KEY="{\"playerId\":{\"S\":\"${PLAYER_ID}\"}}"
  if [[ "$LIMIT" == "DEFAULT" ]]; then
    aws dynamodb update-item --profile allplays --region "$REGION" --table-name "$TABLE" --key "$KEY" \
      --update-expression "REMOVE gameLimit SET updatedAt = :at" \
      --expression-attribute-values "{\":at\":{\"S\":\"${NOW}\"}}"
  else
    aws dynamodb update-item --profile allplays --region "$REGION" --table-name "$TABLE" --key "$KEY" \
      --update-expression "SET gameLimit = :limit, updatedAt = :at" \
      --expression-attribute-values "{\":limit\":${VALUE},\":at\":{\"S\":\"${NOW}\"}}"
  fi
  echo "set-game-limit: ${PLAYER_ID} in ${STAGE} now has limit ${LIMIT}."
done
