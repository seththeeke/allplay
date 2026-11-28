#!/usr/bin/env bash
# Invites a player to a stage (productionalization.md section 3): creates a
# User Pool user with a verified email, which Cognito emails a temporary
# password, and adds it to PLAYER. Usage: scripts/invite-player.sh <Test|Prod> <email>
# It changes AWS resources, so it follows the CLAUDE.md deploy safety gate.
set -euo pipefail

STAGE="${1:-}"
EMAIL="$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')"
if [[ "$STAGE" != "Test" && "$STAGE" != "Prod" ]] || [[ -z "$EMAIL" ]]; then
  echo "Usage: scripts/invite-player.sh <Test|Prod> <email>" >&2
  exit 2
fi
if [[ ! "$EMAIL" =~ ^[^[:space:]\"]+@[^[:space:]\"]+$ ]]; then
  echo "invite-player: '$EMAIL' is not an email address." >&2
  exit 2
fi

REGION="us-east-1"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --profile allplays --region "$REGION" \
  --query "UserPools[?Name=='AllPlay-Users-${STAGE}'].Id | [0]" --output text)
if [[ -z "$POOL_ID" || "$POOL_ID" == "None" ]]; then
  echo "invite-player: no AllPlay-Users-${STAGE} user pool." >&2
  exit 1
fi

EXISTING=$(aws cognito-idp list-users --user-pool-id "$POOL_ID" --profile allplays --region "$REGION" \
  --filter "email = \"${EMAIL}\"" --query "Users[].Username" --output text)
if [[ -n "$EXISTING" && "$EXISTING" != "None" ]]; then
  echo "invite-player: ${EMAIL} already has a ${STAGE} account." >&2
  exit 1
fi

USERNAME=$(aws cognito-idp admin-create-user --profile allplays --region "$REGION" \
  --user-pool-id "$POOL_ID" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL --query "User.Username" --output text)
aws cognito-idp admin-add-user-to-group --profile allplays --region "$REGION" \
  --user-pool-id "$POOL_ID" --username "$USERNAME" --group-name PLAYER
echo "invite-player: invited ${EMAIL} to ${STAGE}. Send them the stage's link."
