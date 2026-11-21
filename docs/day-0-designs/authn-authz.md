# Authentication and Authorization

Status: Day 0 design, 2026-11-17; account linking, duplicate merge, App Store hooks and local authentication added 2026-11-21.

All Play is free and playable without an account. Every visitor gets a guest identity automatically; signing up or signing in is optional and carries the guest's games, preferences and statistics into the account. This document defines identities, roles, the Cognito configuration, API authorization, the guest merge, and the client flows.

Related specs: `data-model.md` (Player, MergeToken), `cdk-stacks.md` (provisioning), `action-decision.md` (Transcribe and Polly access).

Reference implementations: `seththeeke/nyc-311` (role-based admin routes), `seththeeke/survive-and-advance` (Google and Apple sign-in, federated account linking in the pre sign-up trigger; it can still end with duplicate users, which Section 6.2 repairs here), `seththeeke/rook` (Amplify Swift auth and Face ID on iOS).

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
| Domain | Cognito managed domain `allplay-<stage>-<suffix>` for managed login (OAuth), where `<suffix>` is a fixed random string in CDK context, so public URLs never carry the account id |
| Email sender | Cognito default email until a domain exists; Amazon SES from a verified domain afterward (added in the domain leg, `cdk-stacks.md` Section 8) |
| Deletion protection | Prod only |

Groups: `ADMIN` (precedence 1, role `AllPlay-AdminRole-<Stage>`), `PLAYER_PLUS` (precedence 5, role `AllPlay-PlayerPlusRole-<Stage>`), `PLAYER` (precedence 10, role `AllPlay-PlayerRole-<Stage>`).

App clients (no client secret, SRP and refresh token auth flows, OAuth authorization code grant with PKCE, scopes `openid email profile`; created in the app stack, `cdk-stacks.md` Section 2):

| Client | Callback and sign-out URLs |
|---|---|
| `AllPlay-Web-<Stage>` | The stage's CloudFront URL (and custom domain when configured), plus `http://localhost:5173/` in Test only |
| `AllPlay-iOS-<Stage>` | `allplay://auth/` |

### 3.1 Federated Sign-In

| Provider | Configuration |
|---|---|
| Google | `googleClientId` and `googleClientSecret` from the stage's federation secret |
| Sign in with Apple | `appleServicesId`, `appleTeamId`, `appleKeyId` and `applePrivateKeyPem` from the stage's federation secret |

The federation secret is one Secrets Manager secret per stage, `allplay/<stage>/federation` (`allplay/test/federation`, `allplay/prod/federation`), a JSON document with exactly those six fields. The stateful stack creates it with every field set to `PENDING` and retains it on deletion; the owner replaces the values in the console (`docs/runbooks/bootstrap.md` step 7), so no credential is in the repository. The stack reads each field at deploy time as a CloudFormation dynamic reference. The placeholder template never changes, because CloudFormation rewrites a secret's value when its template value changes. Attribute mapping: `email`, `email_verified`, `name`.

Both providers are offered on web and iOS. Offering Sign in with Apple alongside Google satisfies App Store guideline 4.8.

### 3.2 Lambda Triggers

| Trigger | Behavior |
|---|---|
| Pre sign-up | Federated sign-up: auto-confirm, and mark the email verified when the provider verified it. If another user with the same verified email exists and lacks this provider, link the new identity to it (`AdminLinkProviderForUser`, preferring a verified, then the oldest, user) and refuse this sign-up with the token `ALLPLAY_ACCOUNT_LINKED`: Cognito would otherwise still create a separate user for this first sign-in, which is how duplicates arise. The web and iOS clients repeat the sign-in at once on that token, and it reaches the linked user. A link that fails is logged with the `DUPLICATE_ACCOUNT` metric and the sign-up continues; the account merge (Section 6.2) repairs it. Native sign-up: if any user with that email exists, reject with `ALLPLAY_USE_SOCIAL_SIGN_IN`, which clients turn into "This email signs in with Google or Apple" |
| Post confirmation | Add the user to `PLAYER`; create the `ACCOUNT` `Player` item (`ACCT#<sub>`) with `email`, `emailKey` and `signInProviders`. Failures are logged, not thrown, so confirmation is never blocked; post authentication creates a missing account |
| Post authentication | Update `Player.lastActiveAt` and `signInProviders`. If another `ACTIVE` account `Player` has the same normalized email (`ByEmail`, `data-model.md` Section 4), record a `DUPLICATE_ACCOUNT` metric and log both `playerId`s for the duplicate merge (Section 6.2); sign-in is never blocked |
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
| `POST /v1/players/me/merge-tokens` | Guest (guest merge) or PLAYER (account linking) |
| `POST /v1/players/me/merge` | PLAYER |
| `POST /v1/players/me/sign-out` | PLAYER (records the sign-out and revokes refresh tokens, Section 12) |
| `PATCH /v1/players/me` (display name) | PLAYER |
| `DELETE /v1/players/me` | PLAYER |
| `GET /v1/admin/metrics?from=&to=` | ADMIN |
| `GET /v1/admin/decisions?day=&class=` (failure browsing via `ByDayOutcome`) | ADMIN |
| `GET /v1/admin/deployments`, `POST /v1/admin/deployments` | ADMIN |
| `GET /v1/admin/players/duplicates`, `POST /v1/admin/players/merge` | ADMIN |
| `POST /v1/apple/notifications` | None (public); the body is an Apple-signed JWT verified against Apple's keys (Section 12) |

`POST /v1/admin/deployments` calls `codepipeline:StartPipelineExecution` on the All Play pipeline and returns the execution id. `GET /v1/admin/deployments` lists the 20 most recent executions with their stage results. Only the admin API Lambda's role holds these CodePipeline permissions.

## 6. Guest Merge

1. While still a guest, the client calls `POST /v1/players/me/merge-tokens` and stores the returned token in `sessionStorage` (web) or memory (iOS).
2. The player signs in or signs up. Amplify switches to authenticated Identity Pool credentials.
3. The client calls `POST /v1/players/me/merge` with the token. The server hashes it, conditionally marks the `MergeToken` redeemed, and runs the merge (`data-model.md` Section 10).
4. The client reloads preferences and the current session. If step 3 fails because of a network error, the client retries on the next page load while the token is still valid (10 minutes).

A token is single-use and bound to the guest that requested it; redeeming it requires an account caller, so a guest cannot redeem a token and an account cannot forge one for another guest.

On sign-out, Amplify clears the account credentials and obtains a new guest identity. The new guest starts fresh; the account's data stays with the account.

### 6.1 Account Linking

A signed-in player can link a second sign-in method (Google, Apple, or email and password) to their account, for example after signing in once with Apple's private relay email and once with Google. Linking reuses the merge token:

1. Signed in as account A, the client calls `POST /v1/players/me/merge-tokens`, which for an account caller issues a token whose source is A.
2. The player signs in with the other method, becoming account B.
3. The client calls `POST /v1/players/me/merge` as B with the token and `{ "keep": "SOURCE" }`, so the account the player started from, A, is kept.
4. The server runs the account merge (Section 6.2) from B into A, then the client signs out and the player signs in again with either method, reaching A.

A token is single-use, expires in 10 minutes, and redeeming it requires that both A and B are accounts the caller has just proved: A by issuing the token, B by redeeming it.

### 6.2 Account Merge

The account merge folds one account (the duplicate) into another (the primary). It is used by account linking and by an admin when a duplicate is found.

1. Data moves exactly as in the guest merge (`data-model.md` Section 10): seats, then preferences the primary lacks, then stats summed, idempotently.
2. The duplicate `Player` becomes `MERGED` with `mergedInto`, and the primary gains it in `mergedAccountIds` and gains its `signInProviders`.
3. The duplicate's Cognito user is deleted (`AdminDeleteUser`). Each of its Google or Apple identities is then linked to the primary's Cognito user (`AdminLinkProviderForUser`), so the next sign-in with that provider reaches the primary. An email and password identity cannot be linked; the player uses the primary's methods afterwards.
4. Admins run it with `POST /v1/admin/players/merge` `{ "primaryPlayerId", "duplicatePlayerId" }` or `scripts/merge-accounts.sh <Test|Prod> <primary> <duplicate>` (a mutating call under the CLAUDE.md deploy safety gate). `GET /v1/admin/players/duplicates` lists `ACTIVE` accounts that share a normalized email.

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

1. Deletion is started in the app (web Account page, iOS Settings), confirmed once ("Delete your account and all your games? This cannot be undone."), and completes immediately; no support contact or waiting period.
2. For an account whose `signInProviders` include `APPLE`, the client first asks the player to sign in with Apple once more and sends the fresh authorization code in the body, `{ "appleAuthorizationCode" }`. The server exchanges it at Apple's token endpoint with the client secret signed by the Sign in with Apple key, then calls Apple's revoke endpoint (`https://appleid.apple.com/auth/revoke`) so the app is removed from the player's Apple ID. If the player cancels that step or Apple is unreachable, deletion still completes, as Apple requires, and the failure is logged.
3. Deletion is also triggered by Apple: a `consent-revoked` or `account-deleted` notification (Section 12) deletes the matching account the same way, without the revoke step.

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

## 11. Local Authentication

Locally, authentication is chosen by `ALLPLAY_AUTH` (`local-development.md` Section 2.1).

| Setting | Caller identity |
|---|---|
| `mock` (presets `local`, `local-aws`, `continuous-integration`) | The development header `x-allplay-dev-caller`: `guest:<id>`, `player:<id>` or `admin:<id>`, default `guest:local-guest`. The local server writes the matching IAM fields: the identity id, `amr` (`unauthenticated`, or `authenticated` with `...:CognitoSignIn:<id>`), and a `userArn` naming `AllPlay-GuestRole-Local`, `AllPlay-PlayerRole-Local` or `AllPlay-AdminRole-Local`, so `resolveCaller` and `requireTier` run unchanged |
| `cognito-test` (preset `local-aws-auth`) | Real Cognito from the Test stage. The web app signs in with Amplify against the Test User Pool and Identity Pool (the Test web client already allows `http://localhost:5173/`) and sends the ID token as `Authorization: Bearer <token>`, or for a guest its Identity Pool identity id as `x-allplay-identity-id`. The local server verifies the ID token against the Test pool's keys and writes the same IAM fields from its `sub` and `cognito:groups`; a guest identity id is accepted as given, which is safe only because the local server listens on 127.0.0.1 |

In the web app, `MEMORY` mode keeps its in-memory player service. In `LIVE` mode against the local server, the `mock` setting uses a local sign-in service: any email signs in, an email starting with `admin` signs in as an admin, Google and Apple buttons sign in as a mock federated player, and the service sends the matching development header. The `cognito-test` setting uses the Amplify service, as deployed stages do.

## 12. App Store Requirements

The iOS app (phase 8) must pass App Review. These requirements shape the account functions built now, on web and backend, so iOS adds only its screens.

| Requirement | Source | Hook |
|---|---|---|
| An app offering third-party sign-in (Google) must also offer an equivalent private option | Guideline 4.8 | Sign in with Apple on web and iOS, alongside Google and email |
| An app that supports account creation must let people start account deletion in the app | Guideline 5.1.1(v) | `DELETE /v1/players/me` from the web Account page and iOS Settings (Section 8) |
| Apps using Sign in with Apple should revoke the user's tokens when the account is deleted | Apple TN3194 | Fresh authorization code at deletion, exchange, then `auth/revoke` (Section 8) |
| Apple tells the app when a user stops using Sign in with Apple, deletes their Apple Account, or turns relay email on or off | Sign in with Apple server-to-server notifications | `POST /v1/apple/notifications`, registered as the Services ID's notification endpoint. `consent-revoked` and `account-deleted` delete the account; `email-disabled` and `email-enabled` set `Player.relayEmailEnabled` |
| Mail to `@privaterelay.appleid.com` addresses is delivered only from registered sources | Private email relay | The sending address (the Cognito default sender, then the SES domain once a domain exists) is registered as an email source in the Apple Developer account |
| Features that do not need an account must not require sign-in | Guideline 5.1.1 | Guests play every game; only linking, profile and deletion need an account |
| Sign-out must end the session on the device and stop the refresh token | Account security | `POST /v1/players/me/sign-out` records it, Amplify signs out globally (`signOut({ global: true })`, revoking the refresh token), credentials are cleared, and a new guest identity is obtained |
| A privacy policy and the App Privacy details | Guideline 5.1.1(i), App Store Connect | A `/privacy` page in the web app; App Privacy: email address and name (account, not used for tracking), gameplay data (app functionality), audio not collected (transcribed in memory and discarded) |
| Review must be able to use the app | Guideline 2.1 | No demo account is needed, because guests can play; review notes describe the voice flow |

## 13. Implementation Legs

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
| AA-11 | Local authentication: the `mock` callers for guest, player and admin, `resolveCaller` per Section 4, route tiers enforced from the route lists, and the web local sign-in sending the development caller (Section 11) |
| AA-11b | The `cognito-test` setting and the `local-aws-auth` preset (Section 11), built with AA-9 once the Test User Pool and Amplify exist |
| AA-12 | Account linking and the account merge, the duplicate list and admin merge routes, `scripts/merge-accounts.sh` (Sections 6.1 and 6.2) |
| AA-13 | App Store hooks: sign-out route, Sign in with Apple token revocation at deletion, the Apple notifications route, the privacy page (Section 12) |

Build order, by the owner's direction: AA-11 first (so every later leg runs locally), then DM-1, AA-1, AA-2, AA-3 (once the Google and Apple keys exist), AA-4, CDK-7, AA-5, AA-9, AA-7, AA-13, DM-2, AA-6, AA-12, AA-8, AA-10.

## Appendix: Implementation Progress

Status as of 2026-11-21.

| Leg | Status | Notes |
|---|---|---|
| AA-11 | Done | `resolveCaller` resolves guests and accounts with the tier of their role; the router enforces each route's `minimumTier` (403 `FORBIDDEN`); the local server writes guest, player and admin identities from `x-allplay-dev-caller`; the web app sends the mock-signed-in player as that header in local `LIVE` mode |
| DM-1 | Done | See `data-model.md` |
| AA-1 | Done | `AllPlay-Users-<Stage>` with the groups, the managed login domain `allplay-<stage>-jbus19`, the custom message trigger and its large-type templates; the web and iOS clients; the pool, web client and domain in `config.json` |
| AA-2 | Done | The three triggers behind an identity service and the account service, so trigger controllers call no DAO; the User Pool adapter in `dao/userPool/`; per-trigger permissions with no wildcards |
| Next | | AA-4 (Identity Pool, roles, role mapping, IAM route policies) and CDK-7. AA-3 waits on the Google and Apple keys |
