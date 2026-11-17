# Authentication and Authorization

Status: Day 0 design, 2026-11-17.

All Play is free and playable without an account. Every visitor gets a guest identity automatically; signing up or signing in is optional and carries the guest's games, preferences and statistics into the account. This document defines identities, roles, the Cognito configuration, API authorization, the guest merge, and the client flows.

Related specs: `data-model.md` (Player, MergeToken), `cdk-stacks.md` (provisioning), `action-decision.md` (Transcribe and Polly access).

Reference implementations: `seththeeke/nyc-311` (role-based admin routes), `seththeeke/survive-and-advance` (Google and Apple sign-in, federated account linking in the pre sign-up trigger), `seththeeke/rook` (Amplify Swift auth and Face ID on iOS).

## 1. Principles

1. One credential path for everyone. Guests and signed-in players both call the API with AWS credentials from the Cognito Identity Pool, signed with SigV4 by Amplify. There is one API, one authorizer type (IAM), and one way to resolve the caller.
2. The caller's identity always comes from the request context, never from the request body.
3. Authorization is enforced twice: IAM policies on the Identity Pool roles decide which routes a role may invoke, and each controller checks the resolved role again.
4. Account functions are minimal: sign up, sign in, sign out, forgot password, delete account. Everything else is an automatically saved preference.

## 2. Tiers and Roles

| Tier | Who | How identified |
|---|---|---|
| Guest | Anyone not signed in | Identity Pool unauthenticated identity |
| `PLAYER` | Every signed-in user | User Pool group `PLAYER`, added at sign-up confirmation |
| `PLAYER_PLUS` | Selected players; permissions to be defined | User Pool group `PLAYER_PLUS` |
| `ADMIN` | The owner and selected individuals | User Pool group `ADMIN` |

Permission matrix:

| Capability | Guest | PLAYER | PLAYER_PLUS | ADMIN |
|---|---|---|---|---|
| Play games, voice decisions, preferences, stats | Yes | Yes | Yes | Yes |
| Transcribe streaming, Polly speech | Yes | Yes | Yes | Yes |
| Issue a merge token | Yes | No | No | No |
| Redeem a merge token, edit profile, delete account | No | Yes | Yes | Yes |
| `PLAYER_PLUS` features (reserved) | No | No | Yes | Yes |
| Admin metrics, deployments, admin UI tabs | No | No | No | Yes |

## 3. Cognito User Pool

One pool per stage: `AllPlay-Users-<Stage>`.

| Setting | Value |
|---|---|
| Feature plan | Essentials |
| Sign-in identifier | Email (case insensitive) |
| Self sign-up | Enabled |
| Verification | Email verification code |
| Password policy | Minimum 8 characters, at least one lowercase, one uppercase and one digit |
| MFA | Off |
| Account recovery | Email only |
| Token validity | ID and access tokens 1 hour; refresh token 90 days |
| Domain | Cognito managed domain `allplay-<stage>-<accountId>` for managed login (OAuth) |
| Email sender | Cognito default email until a domain exists; Amazon SES from a verified domain afterward (added in the domain leg, `cdk-stacks.md` Section 8) |
| Deletion protection | Prod only |

Groups: `ADMIN` (precedence 1, role `AllPlay-AdminRole-<Stage>`), `PLAYER_PLUS` (precedence 5, role `AllPlay-PlayerPlusRole-<Stage>`), `PLAYER` (precedence 10, role `AllPlay-PlayerRole-<Stage>`).

App clients (no client secret, SRP and refresh token auth flows, OAuth authorization code grant with PKCE, scopes `openid email profile`):

| Client | Callback and sign-out URLs |
|---|---|
| `AllPlay-Web-<Stage>` | The stage's CloudFront URL (and custom domain when configured), plus `http://localhost:5173/` in Test only |
| `AllPlay-iOS-<Stage>` | `allplay://auth/` |

### 3.1 Federated Sign-In

| Provider | Configuration |
|---|---|
| Google | OAuth client id in CDK context; client secret in the stage's federation secret |
| Sign in with Apple | Services ID, Team ID and Key ID in CDK context; private key in the stage's federation secret |

The federation secret is one Secrets Manager secret per stage, `allplay/<stage>/federation`, a JSON document with `googleClientSecret` and `applePrivateKeyPem`. It is created by hand once per stage (documented in the CDK leg) and never committed. Attribute mapping: `email`, `email_verified`, `name`.

Both providers are offered on web and iOS. Offering Sign in with Apple alongside Google satisfies App Store guideline 4.8.

### 3.2 Lambda Triggers

| Trigger | Behavior |
|---|---|
| Pre sign-up | Federated sign-up: if a user with the same verified email exists, link the new provider identity to that user (`AdminLinkProviderForUser`) so one person has one account; otherwise auto-confirm and mark the email verified. Native sign-up: if a federated-only user with that email exists, reject with a stable message token (`ALLPLAY_USE_SOCIAL_SIGN_IN`) that clients turn into "This email signs in with Google or Apple" |
| Post confirmation | Add the user to `PLAYER`; create the `ACCOUNT` `Player` item (`ACCT#<sub>`) with `email` and `signInProviders` |
| Post authentication | Update `Player.lastActiveAt` and `signInProviders` |
| Custom message | Render the HTML email templates for sign-up code, resend code, forgot password code and attribute verification from `backend/src/controller/cognito/templates/` (large type, plain layout, the code in 32 px text) |

## 4. Identity Pool and API Authorization

One identity pool per stage: `AllPlay_Identities_<Stage>`, unauthenticated identities allowed, classic (basic) flow disabled, with the web and iOS app clients as providers.

Roles:

| Role | Assumed by | Grants |
|---|---|---|
| `AllPlay-GuestRole-<Stage>` | Unauthenticated identities | `execute-api:Invoke` on guest routes; `transcribe:StartStreamTranscriptionWebSocket`; `polly:SynthesizeSpeech` |
| `AllPlay-PlayerRole-<Stage>` | Authenticated identities (default and `PLAYER` group) | Guest grants except the merge token route, plus account routes |
| `AllPlay-PlayerPlusRole-<Stage>` | `PLAYER_PLUS` group | Same as `PLAYER` plus reserved routes |
| `AllPlay-AdminRole-<Stage>` | `ADMIN` group | Same as `PLAYER` plus `/v1/admin/*` |

Role mapping: token-based (`cognito:preferred_role`, which Cognito sets from the highest-precedence group), with ambiguous tokens resolved to the authenticated role. Every role's trust policy is limited to this stage's identity pool and the matching `amr` value.

Every route on the HTTP API uses `AWS_IAM` authorization. Each controller resolves the caller from `requestContext.authorizer.iam`:

1. `cognitoIdentity.identityPoolId` must equal the stage's pool; otherwise 403.
2. If `cognitoIdentity.amr` contains `unauthenticated`, the caller is `GUEST#<identityId>`.
3. If it contains `authenticated`, the `amr` entry ending in `:CognitoSignIn:<sub>` gives the caller `ACCT#<sub>`.
4. The caller's role is the role name in `userArn` (`assumed-role/<roleName>/...`), mapped to `GUEST`, `PLAYER`, `PLAYER_PLUS` or `ADMIN`.

This resolution is one shared function, `resolveCaller`, unit tested with recorded request contexts and covered by integration tests for each tier. Controllers declare a minimum tier (`requireTier("ADMIN")`), checked after IAM has already allowed the route.

On a guest's first request (and at most once per hour after that), the controller layer upserts the guest `Player` item and its `lastActiveAt`.

## 5. Routes by Tier

| Route | Minimum tier |
|---|---|
| `GET /v1/games`, `GET /v1/games/{gameId}` | Guest |
| `/v1/sessions/*` (`game-engine.md` Section 11) | Guest |
| `POST /v1/decisions`, `POST /v1/decisions/{id}/resolution` | Guest |
| `GET /v1/players/me` | Guest |
| `GET /v1/players/me/preferences`, `PATCH /v1/players/me/preferences/{scope}` | Guest |
| `GET /v1/players/me/stats` | Guest |
| `POST /v1/players/me/merge-tokens` | Guest only |
| `POST /v1/players/me/merge` | PLAYER |
| `PATCH /v1/players/me` (display name) | PLAYER |
| `DELETE /v1/players/me` | PLAYER |
| `GET /v1/admin/metrics?from=&to=` | ADMIN |
| `GET /v1/admin/decisions?day=&class=` (failure browsing via `ByDayOutcome`) | ADMIN |
| `GET /v1/admin/deployments`, `POST /v1/admin/deployments` | ADMIN |

`POST /v1/admin/deployments` calls `codepipeline:StartPipelineExecution` on the All Play pipeline and returns the execution id. `GET /v1/admin/deployments` lists the 20 most recent executions with their stage results. Only the admin API Lambda's role holds these CodePipeline permissions.

## 6. Guest Merge

1. While still a guest, the client calls `POST /v1/players/me/merge-tokens` and stores the returned token in `sessionStorage` (web) or memory (iOS).
2. The player signs in or signs up. Amplify switches to authenticated Identity Pool credentials.
3. The client calls `POST /v1/players/me/merge` with the token. The server hashes it, conditionally marks the `MergeToken` redeemed, and runs the merge (`data-model.md` Section 10).
4. The client reloads preferences and the current session. If step 3 fails because of a network error, the client retries on the next page load while the token is still valid (10 minutes).

A token is single-use and bound to the guest that requested it; redeeming it requires an account caller, so a guest cannot redeem a token and an account cannot forge one for another guest.

On sign-out, Amplify clears the account credentials and obtains a new guest identity. The new guest starts fresh; the account's data stays with the account.

## 7. Clients

### 7.1 Web

- Amplify JS v6 (`aws-amplify`) for Auth (`signUp`, `confirmSignUp`, `signIn`, `signInWithRedirect` for Google and Apple, `resetPassword`, `confirmResetPassword`, `signOut`) and for SigV4-signed REST calls with Identity Pool credentials.
- Account screens are one simple flow: email and password fields, a "Continue with Google" and a "Continue with Apple" button, a code entry screen, and a forgot password link. All fields and buttons use the oversized defaults of the web app.
- Admin tabs and the `/admin` route render only when the ID token's `cognito:groups` contains `ADMIN`. Nothing in the public UI links to `/admin`. A non-admin who visits `/admin` sees the standard not-found page.

### 7.2 iOS

- Amplify Swift Auth with the iOS app client; Google and Apple through the managed login web flow.
- Tokens are stored in the Keychain by Amplify.
- Optional Face ID unlock (preference, off by default): when on, the app requires Face ID before showing a signed-in session after launch, following the pattern in `rook`.
- Account deletion is available in Settings, as App Store guideline 5.1.1(v) requires, and calls `DELETE /v1/players/me`.

## 8. Account Deletion

`DELETE /v1/players/me` deletes the account's data (`data-model.md` Section 14) and then the Cognito user (`AdminDeleteUser`). The client then signs out and receives a new guest identity.

## 9. Admin Provisioning

Admins are added by hand with `scripts/grant-admin.sh <Test|Prod> <email>`, which calls `AdminAddUserToGroup`. It is a mutating AWS call and follows the CLAUDE.md deploy safety gate. There is no admin self-service.

## 10. Testing

1. Unit tests: every trigger, `resolveCaller` against recorded contexts for each tier, `requireTier`, merge token issue and redemption, and the email templates.
2. Integration tests against the Test stage:
   - A guest obtains Identity Pool credentials (`GetId`, `GetCredentialsForIdentity`) and calls a guest route.
   - A guest is denied (403) on `POST /v1/players/me/merge` and every admin route.
   - A test account created by the test setup (`AdminCreateUser` with a permanent password, deleted in teardown) signs in with SRP, calls account routes, and is denied on admin routes.
   - A test admin account calls `GET /v1/admin/metrics`.
   - The full merge flow moves a guest's in-progress session to the account.

## 11. Implementation Legs

Built in execution phase 4 (Authentication). Each leg is one commit.

| Leg | Scope |
|---|---|
| AA-1 | User Pool, groups, app clients, managed login domain; custom message trigger and templates |
| AA-2 | Pre sign-up, post confirmation and post authentication triggers with unit tests |
| AA-3 | Google and Apple identity providers and the federation secret; manual setup steps documented in `docs/runbooks/federation-setup.md` |
| AA-4 | Identity Pool, the four roles, role mapping, and IAM route policies |
| AA-5 | `resolveCaller`, `requireTier`, guest upsert; `GET /v1/players/me`, preferences and stats routes |
| AA-6 | Merge token issue and redemption routes and the merge service |
| AA-7 | Account deletion route |
| AA-8 | Admin routes for metrics, decisions and deployments; `scripts/grant-admin.sh` |
| AA-9 | Web auth screens, Amplify configuration, admin tab gating and `/admin` route guard |
| AA-10 | Integration tests for every tier (Section 10) |
