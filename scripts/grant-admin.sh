#!/usr/bin/env bash
# Adds an existing All Play account to the ADMIN group of a stage's User Pool
# (authn-authz.md section 9). Usage: scripts/grant-admin.sh <Test|Prod> <email>
# It changes AWS resources, so it follows the CLAUDE.md deploy safety gate.
# The account takes the admin role at its next sign-in.
set -euo pipefail

STAGE="${1:-}"
EMAIL="${2:-}"
if [[ "$STAGE" != "Test" && "$STAGE" != "Prod" ]] || [[ -z "$EMAIL" ]]; then
  echo "Usage: scripts/grant-admin.sh <Test|Prod> <email>" >&2
  exit 2
fi
if [[ ! "$EMAIL" =~ ^[^[:space:]\"]+@[^[:space:]\"]+$ ]]; then
  echo "grant-admin: '$EMAIL' is not an email address." >&2
  exit 2
fi

REGION="us-east-1"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --profile allplays --region "$REGION" \
  --query "UserPools[?Name=='AllPlay-Users-${STAGE}'].Id | [0]" --output text)
if [[ -z "$POOL_ID" || "$POOL_ID" == "None" ]]; then
  echo "grant-admin: no AllPlay-Users-${STAGE} user pool." >&2
  exit 1
fi

USERNAMES=$(aws cognito-idp list-users --user-pool-id "$POOL_ID" --profile allplays --region "$REGION" \
  --filter "email = \"${EMAIL}\"" --query "Users[].Username" --output text)
if [[ -z "$USERNAMES" || "$USERNAMES" == "None" ]]; then
  echo "grant-admin: no ${STAGE} account signs in with that email. Sign up first." >&2
  exit 1
fi

for USERNAME in $USERNAMES; do
  aws cognito-idp admin-add-user-to-group --profile allplays --region "$REGION" \
    --user-pool-id "$POOL_ID" --username "$USERNAME" --group-name ADMIN
  echo "grant-admin: ${USERNAME} is now in ${STAGE} ADMIN."
done
echo "Sign out and back in to pick up the admin role."
