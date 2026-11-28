# Productionalization

Status: Design, 2026-11-28.

This spec prepares All Play for real players: an invite-only Test stage, a cost killswitch, per-player game limits, Spider Solitaire variant tiles, latency metrics on the admin page, a larger decider model, the rest of the browser voice path, a mobile layout pass and the remaining admin functions.

Related specs: `day-0-designs/authn-authz.md` (stages, tiers, Cognito), `day-0-designs/data-model.md` (`Player`, `SystemFlag`, `MetricRollup`), `day-0-designs/cdk-stacks.md` (stacks, Lambdas, budgets), `day-0-designs/action-decision.md` (voice capture, model), `day-0-designs/spider-solitaire.md` (variants).

## 1. Principles

1. Test and Prod run the same code. Every difference between them is a stage setting in `cdk/lib/config.ts`, passed to Lambdas as environment variables and to the web app in `config.json`.
2. Cost protection fails closed. When a monitored service passes its monthly limit, play stops in both stages until an admin restarts it.
3. Limits are enforced on the server. The web app only shows what the server reports.

## 2. Stage Settings

| Setting | Test | Prod | Used by |
|---|---|---|---|
| `accessMode` | `INVITE_ONLY` | `OPEN` | Cognito, the Identity Pool, the pre sign-up trigger, the web app (Section 3) |
| `defaultGameLimit` | `UNLIMITED` | `5/DAY` | The game session service (Section 5) |
| Decider model | `us.amazon.nova-2-lite-v1:0` | `us.amazon.nova-2-lite-v1:0` | `DecisionApi` (Section 8) |

## 3. Invite-Only Test

In `INVITE_ONLY` stages nobody plays without an account, and nobody creates an account themselves.

1. The User Pool has self sign-up disabled.
2. The Identity Pool does not allow unauthenticated identities. The guest role stays defined, so the role mapping and route policies are unchanged, but no identity can assume it.
3. The pre sign-up trigger refuses every sign-up whose trigger source is not `PreSignUp_AdminCreateUser`, with the token `ALLPLAY_INVITE_ONLY`. A Google or Apple sign-in whose email matches an invited user is linked to that user as today, so an invited player may still use federated sign-in once AA-3 exists.
4. Invitations: an admin invites a player from the admin page (`POST /v1/admin/invitations` `{ "email" }`, ADMIN, served by `AllPlay-AdminApi-<Stage>`) or with `scripts/invite-player.sh <Test|Prod> <email>`, a mutating call under the CLAUDE.md deploy safety gate. Both call `AdminCreateUser` with the email verified and Cognito's invitation email carrying a temporary password, then `AdminAddUserToGroup` `PLAYER`. The route is refused with 409 `ALREADY_INVITED` when a user with that email exists. In `OPEN` stages the route also works, for creating an account on someone's behalf.
5. The custom message trigger renders the `CustomMessage_AdminCreateUser` email with the same large-type template as the other codes: "You are invited to play All Play" and the temporary password in 32 px text. The admin sends the stage's link with the invitation, because the User Pool is in the stateful stack and cannot name the app stack's CloudFront URL.
6. First sign-in: the web sign-in handles the `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` step with a single "Choose your password" screen using the password checklist, then continues as a normal sign-in. The post authentication trigger creates the missing `ACCOUNT` `Player`, as it already does for any account without one.
7. The web app reads `accessMode` from `config.json`. In `INVITE_ONLY`:
   - Amplify is configured without guest access, so no guest credentials are requested.
   - Every route except `/sign-in`, `/forgot-password`, `/privacy` and `/health` redirects a signed-out visitor to `/sign-in`, which returns them to the page they asked for after sign-in.
   - Sign up links and the sign-up page are hidden; `/sign-up` redirects to `/sign-in`. The sign-in page says "All Play Test is invite only."
8. Verification in Test uses the integration accounts (`AllPlay-IntegrationAccounts-Test`) for every write test that ran as a guest. A Test check asserts that `GetId` without a login is refused. The Playwright game smoke test signs in with a run-scoped integration account created and deleted by the smoke step. Prod keeps its read-only guest checks.
9. Locally, the `mock` setting is unchanged. The `cognito-test` setting signs in with a Test account; it no longer offers a guest.

## 4. Andon Cord

### 4.1 Monitor

Three AWS Budgets in `AllPlayPipeline`, one per service, each a monthly `COST` budget of $20 filtered on its service: `AllPlay-Polly` (`Amazon Polly`), `AllPlay-Transcribe` (`Amazon Transcribe`) and `AllPlay-Bedrock` (`Amazon Bedrock`). Each notifies on actual spend at 100%, 150% and 200%, so a cord released mid-month is pulled again if spend keeps growing. Notifications go to the SNS topic `AllPlay-Andon` and to the alert email.

Budgets data lags actual usage by up to a day, so spend can pass $20 before the cord is pulled. The per-player decision rate limits (`action-decision.md` Section 10) and game limits (Section 5) bound the spend in that window.

### 4.2 Pull

`AllPlay-AndonCord` (bundle `andon`, `backend/src/controller/alerts/`, 256 MB, 30 s, in `AllPlayPipeline`) is subscribed to `AllPlay-Andon`. For each notification, in both stages:

1. It writes the `ANDON` `SystemFlag` item (`data-model.md` Section 14) with `isAndonCordPulled = true`, the budget name in `reason` and `pulledBy = BUDGET`.
2. It puts the inline policy `AllPlay-AndonDeny` on `AllPlay-GuestRole-<Stage>`, `AllPlay-PlayerRole-<Stage>`, `AllPlay-PlayerPlusRole-<Stage>` and `AllPlay-AdminRole-<Stage>`, denying `transcribe:*` and `polly:*`. Browsers call Transcribe and Polly directly with Identity Pool credentials, so the API check alone would not stop that spend; role policy changes apply to credentials already issued.
The budget notification itself reaches the alert email, so the owner hears of every pull.

The Lambda holds `dynamodb:PutItem` on both `SystemFlags` tables and `iam:PutRolePolicy` and `iam:DeleteRolePolicy` on those eight roles, named by ARN.

### 4.3 Check

Every API bundle except `admin` and `health` checks the flag in the router after the caller is resolved and before the controller runs. When it is pulled, the request returns 500 `ANDON_CORD_PULLED`, "All Play is paused right now. Please try again later." The flag is read with `GetItem` and cached for 30 seconds per Lambda container; a failed read is logged and the request continues, so a `SystemFlags` outage never stops play. Exempt routes, which cost nothing and must keep working: `DELETE /v1/players/me`, `POST /v1/players/me/sign-out`, `POST /v1/apple/notifications`, `GET /v1/players/me`.

The web app shows a full-width "All Play is paused" banner on any `ANDON_CORD_PULLED` response and stops listening for voice.

### 4.4 Release

An admin releases or pulls the cord from the admin page: `GET /v1/admin/andon` returns the item, and `PUT /v1/admin/andon` `{ "pulled": boolean }` writes it with `pulledBy = ADMIN` and puts or deletes the stage's `AllPlay-AndonDeny` policies. Each stage is released on its own. The admin Lambda holds the same IAM actions on its own stage's four roles.

## 5. Game Limits

1. A game is counted when it starts (`POST /v1/sessions`). Resuming, moves, undo and abandon do not count.
2. A limit is `{ "count", "period" }` with `period` `DAY`, `WEEK` or `MONTH`, or `{ "unlimited": true }`; the stage setting writes them as `5/DAY` and `UNLIMITED`. Windows are UTC: the calendar day, the ISO week starting Monday, the calendar month.
3. The effective limit is the player's `gameLimit` when set, otherwise the stage's `defaultGameLimit`. Guests and accounts share the default.
4. The `Player` item holds the count for the current window (`gamesPlayed`, `data-model.md` Section 4). Starting a session first consumes one game with a conditional `UpdateItem` that resets the count when the stored window is not the current one, and otherwise requires `count < limit`. When the session write then fails, the game is given back with a second update. A refused start returns 429 `GAME_LIMIT_REACHED` with `{ "limit", "period", "resetsAt" }`, and the in-progress game, if any, stays playable.
5. `GET /v1/players/me` adds `gameAllowance`: `{ "limit": number | null, "period": "DAY" | "WEEK" | "MONTH" | null, "used", "resetsAt": string | null }` (`limit` null for unlimited). The home page and the game page show "3 of 5 games left today" when a limit applies, and the game page replaces New game with "You have played your 5 games today. Come back tomorrow." when none are left.
6. A guest merge adds the guest's count to the account's when both are in the same window.
7. Admins set a player's limit from the admin page or `scripts/set-game-limit.sh <Test|Prod> <email> <UNLIMITED|n/DAY|n/WEEK|n/MONTH|DEFAULT>` (mutating, deploy safety gate): `GET /v1/admin/players?email=` finds accounts by email through `ByEmail`, and `PUT /v1/admin/players/{playerId}/game-limit` `{ "gameLimit": limit | null }` sets or clears the override.

## 6. Spider Solitaire Variant Tiles

1. Each core game may have a tiles file next to its rules, `backend/src/game-catalog/<gameId>/tiles.json`, listing the home tiles that start it: `[{ "path", "name", "description", "options" }]`. Released rules documents are never edited, so tiles live outside them. A game without the file gets one tile from its rules document.
2. Spider Solitaire tiles: `/spider` "Spider Solitaire", one suit; `/spider/two-suits` "Spider Solitaire: Two Suits"; `/spider/four-suits` "Spider Solitaire: Four Suits". Each uses the Microsoft deal. Descriptions: "The easiest game: all spades.", "Spades and hearts. Runs must match suit.", "All four suits. The hardest game."
3. The catalog validates each tile's options against the rules document at load, so a bad tile fails the build, not a game.
4. `GameCatalogEntry` gains `tiles`. The home page shows one tile per entry, in file order. A tile path opens the game page with the tile's options.
5. The game page resumes the in-progress game when its options match the tile. When a game with other options is in progress, the page asks "You have a game of <name> in progress." (the name of the tile with those options, else the game's name and option labels) with two large buttons: "Continue that game", which plays it on this page, and "Start <tile name>", which starts the tile's game and ends the other as today. With no game in progress, the tile's game starts. New game on the game page starts the current tile's options; a new game asked for by voice with other options moves to the tile that has them.
6. Statistics already separate variants by `variantKey`.

## 7. Latency Metrics

### 7.1 Measurements

| Histogram | Measured by | From | To |
|---|---|---|---|
| `clientLatency` (exists) | Client | End of speech | Proposal or result shown |
| `serverLatency` (exists) | `DecisionApi` | Request received | Response sent |
| `llmLatency` | `DecisionApi` | Each model call sent | Its response; one sample per call |
| `transcribeLatency` | Client | End of speech | Final transcript received |
| `pollyLatency` | Client | Synthesis request sent | Audio ready to play; cache hits are not samples |
| `moveLatency` | `GameApi` | Request received | Response sent, for `POST /v1/sessions/{id}/actions` and undo |

All use the existing bucket bounds (`data-model.md` Section 11) and get p50 and p95 from the rollup job.

### 7.2 Client Reporting

The web app batches its `transcribeLatency` and `pollyLatency` samples and sends them every 30 seconds while samples are waiting, and when the page is hidden, to `POST /v1/telemetry/latency` `{ "samples": [{ "kind": "TRANSCRIBE" | "POLLY", "ms" }] }` (GUEST, decisions bundle). The route accepts at most 50 samples per request, each 0 to 60,000 ms, and adds them to the day's histograms. It answers 200 `{ "recorded": <count> }`.

### 7.3 Admin Page

A "Latency" section shows, for each histogram, today's p50 and p95 as tiles and a 30 day p50 and p95 line chart, with a data table alternative for screen readers.

## 8. Decider Model

Both stages use Amazon Nova 2 Lite through the US cross-region profile `us.amazon.nova-2-lite-v1:0`, for both layers, with reasoning off. The account's quota is 200 requests per minute, about 100 voice turns per minute.

On-demand prices in us-east-1 (AWS Pricing API, 2026-11-28), for a turn of about 3,700 input and 100 output tokens:

| Model | Input per 1K tokens | Output per 1K tokens | Per 1,000 turns |
|---|---|---|---|
| Nova Micro (before) | $0.000035 | $0.00014 | $0.14 |
| Nova 2 Lite | $0.00033 | $0.00275 | $1.50 |

The change is checked with `npm run eval:decider -- --stage Test` (316 cases, about $0.50) before it ships.

## 9. Voice Path Completion

The open parts of AD-9 (`action-decision.md` Section 3):

1. Turn-based listening streams to Transcribe while the player speaks, using the conversational listener's live stream, instead of sending the clip after capture.
2. Partial transcripts appear in the listening banner as they arrive.
3. Listening ends after `listenTimeoutMs` of silence following a final segment, on Space, or at the 10 second cap.
4. Custom vocabulary: `backend/src/game-catalog/vocabulary.json`, an import-free JSON list of phrases, holds the union of every core game's vocabulary (Spider's in `spider-solitaire.md` Section 3) and the application command words. A unit test checks that it holds those words once each, in a form Transcribe accepts. `cdk/` reads it from disk at synth (`cdk-stacks.md` Section 5) to create `allplay-vocabulary-<stage>` with the `TranscribeVocabulary` custom resource. `config.json` carries `vocabularyName`. When Transcribe refuses the vocabulary (still `PENDING`, or failed), the client retries the stream once without it.

## 10. Mobile Layout

The game is long and the board is wide, so the phone layout keeps the whole tableau on screen and leans on voice.

1. Below 640 px wide, the ten columns share the full width with no horizontal scroll. Cards show a large rank and suit index only, and face-down cards overlap more tightly. Column numbers stay at least 24 px.
2. Tap targets are at least 44 by 44 CSS px (WCAG 2.2 target size, enhanced). A tapped card's legal destinations are highlighted, and the column numbers become tap targets for the destination.
3. The talk button is fixed at the bottom of the screen, at least 64 px tall, with Undo, Hint and New game beside it.
4. Landscape shows the board beside the voice controls. Portrait stacks them.
5. Zoom levels above 1.5 on a phone scale text and controls but not the board width, so the board never overflows.
6. A Playwright check at 390 by 844 and 844 by 390 runs axe and checks that no element overflows the viewport.

## 11. Admin Functions

The admin page holds, in order: the andon cord (Section 4.4), metrics, latency (Section 7.3), turn failures, deployments, invitations (Section 3), game limits (Section 5), and duplicate accounts. The admin rows of `day-0-designs/prototype-mocks.md` are removed: every admin function is live on deployed stages and in local `LIVE` mode, and in-memory only in `MEMORY` mode.

## 12. Settings Persistence

Every `APP` preference shown in Settings is saved by `PATCH /v1/players/me/preferences/APP` and returned by `GET /v1/players/me/preferences`. A unit test walks every field of `AppPreferencesSchema` through the controller and the DynamoDB DAO, and an integration test in Test patches every field and reads it back as an account.

## 13. Implementation Legs

Each leg is one commit.

| Leg | Scope |
|---|---|
| PZ-1 | This spec and the matching changes to the day-0 specs |
| PZ-2 | Andon cord: `SystemFlag` model, DAOs, table, router check, admin routes and panel, the web paused banner, budgets, topic and `AllPlay-AndonCord` |
| PZ-3 | Done, not deployed | `STAGE_SETTINGS` in `cdk/lib/config.ts`. Test's User Pool takes admin-created users only, its Identity Pool has no guests, and its pre sign-up trigger refuses with `ALLPLAY_INVITE_ONLY`; `config.json` carries `accessMode`. `POST /v1/admin/invitations` and the admin page's Invite a player panel, `scripts/invite-player.sh`, the invitation email, and the Choose your password step. In `INVITE_ONLY` the web app requests no guest credentials and gates every page but sign-in, forgot password, privacy and health. Test's integration tests play as run-scoped accounts (`tests/integration/callers.ts`), assert that `GetId` without a login is refused, and skip the guest merge; the smoke step signs in with an account from `tests/integration/smokeAccount.ts`. The local `local-aws-auth` preset copies Test's `accessMode` |
| PZ-4 | Done, not deployed | `Player.gameLimit` and `Player.gamesPlayed`; `PlayerDao.countGame` counts with one conditional write per window (a new window restarts at 1, a racing start is retried once) and creates a missing player from a seed; the session service counts before ending the game in progress and gives the game back when the session write fails. `DEFAULT_GAME_LIMIT` (Test `UNLIMITED`, Prod `5/DAY`) on the game, player and admin Lambdas; locally `ALLPLAY_DEFAULT_GAME_LIMIT`, unlimited when unset. `gameAllowance` on `GET /v1/players/me`; the limit wording is shared from `models/api/player.ts`. `GET /v1/admin/players?email=`, `PUT /v1/admin/players/{playerId}/game-limit`, the Game limits panel and `scripts/set-game-limit.sh`. The guest merge adds counts of the same window once |
| PZ-5 | Done, not deployed | `game-catalog/spider-solitaire/tiles.json` with `/spider`, `/spider/two-suits` and `/spider/four-suits`; the catalog checks each tile by dealing it at load and adds `tiles` to every `GET /v1/games` entry. The home page shows one tile per entry; the game page resumes a matching game, asks before replacing one with other options, and a voice new game with other options moves to its tile. Session queries no longer retry a 4xx answer |
| PZ-6 | Done, not deployed | `llmLatency`, `transcribeLatency`, `pollyLatency` and `moveLatency` histograms on `MetricRollups`; a day written before them gets them empty on its first add. One `llmLatency` sample per model call; `moveLatency` timed by the game controller for moves and undo; `POST /v1/telemetry/latency` answers `{ recorded }`. The browser measures Transcribe from the end of speech (conversational) or the end of capture (turn-based) to the final text, and Polly on cache misses, and reports through `services/latencyReporter.ts`. The rollup writes p50 and p95 of every histogram; the admin metrics route computes them from the histograms for a day without stored percentiles, so today shows too. The admin page's Latency section has a tile and, but for the round trip already charted, a chart for each. The admin rows of `prototype-mocks.md` are removed |
| PZ-7 | Done | Every `APP` setting already saved and read back; no field needed a fix. `tests/controller/web-api/players/settingsPersistence.test.ts` saves each field on its own through the controller and checks the DynamoDB update names every field; `tests/integration/settings.integration.test.ts` round-trips them all in Test. `voiceId` is saved but has no Settings control; `appHelpSeen` is saved but unused |
| PZ-8 | Partial, not deployed | Turn-based listening streams to Transcribe while the player speaks (`startTranscribeTurn`), shows the text heard so far in the listening banner, and ends after `listenTimeoutMs` of silence following a final segment. The clip and live paths retry once without the vocabulary when Transcribe refuses it. `backend/src/game-catalog/vocabulary.json` and its test exist. Open: the `TranscribeVocabulary` custom resource and `config.json` `vocabularyName`. CDK's `AwsCustomResource` provider is a CDK-managed Lambda that cdk-nag flags (`AwsSolutions-L1`, `AwsSolutions-IAM4`), and acknowledging those findings needs the owner's yes (CLAUDE.md section 3) |
| PZ-3 | Invite-only Test: stage settings, Cognito and Identity Pool settings, pre sign-up refusal, invitation email, new password sign-in step, web gating, invitation route, panel and script, Test verification on accounts |
| PZ-4 | Game limits: `Player` attributes, consume and give back, 429, `gameAllowance`, merge, admin routes, panel and script, web messages |
| PZ-5 | Spider variant tiles: tiles file, catalog, home tiles, tile routes, the in-progress choice |
| PZ-6 | Latency metrics: histograms, telemetry route, client reporting, move and model latency, rollup percentiles, admin section; the admin rows of `prototype-mocks.md` removed |
| PZ-7 | Settings persistence tests, and fixes for any field that does not round-trip |
| PZ-8 | Voice path completion: live turn-based stream, partials, silence end, vocabulary file and custom resource |
| PZ-9 | Mobile layout pass and its Playwright checks |
| PZ-10 | Nova 2 Lite: model id, grants, evaluation run, spec notes |

## Appendix: Implementation Progress

Status as of 2026-11-28.

| Leg | Status | Notes |
|---|---|---|
| PZ-1 | Done | |
| PZ-2 | Done, not deployed | `AllPlay-SystemFlags-<Stage>`; the router returns 500 `ANDON_CORD_PULLED` for every play route of the game, decision and player bundles (the flag cached 30 s per container, 0 locally); `GET` and `PUT /v1/admin/andon` with the admin page's Andon cord panel; the web banner and an idle game page while paused. In `AllPlayPipeline`: `AllPlay-Polly`, `AllPlay-Transcribe` and `AllPlay-Bedrock` at $20 with notifications at 100, 150 and 200% to `AllPlay-Andon` and the alert email (a notification takes one SNS subscriber), and `AllPlay-AndonCord`. The DAO contract is not run against Test, since it writes the live flag |
