# Prototype Mocks

Status: Day 0 design, 2026-11-19.

The phase 3 web prototype runs with `dataMode` `MEMORY` (`web-app/public/config.json` and each stage's `config.json`). Every place where it stands in for a real system is listed below with the leg that replaces it. A mock is removed only by the named leg, and that leg's commit deletes its row from this table. When the table is empty, `MEMORY` mode remains only as the test harness for `web-app` unit tests and the in-memory implementations stay as the test doubles required by CLAUDE.md section 5.

Related specs: `README.md` (execution order), `game-engine.md`, `action-decision.md`, `authn-authz.md`, `data-model.md`.

## 1. Service Layer

`web-app/src/services/createServices.ts` builds only in-memory services; `dataMode` `LIVE` throws. All in-memory state lives in `MemoryStore` (`src/services/memory/memoryStore.ts`), mirrored to the browser's localStorage, so it is per browser and never reaches the server.

| Mock | Location | Real system | Replaced by |
|---|---|---|---|
| Live mode partial | `services/createServices.ts`: `LIVE` builds live games, sessions, decisions and Voice Lab services (used locally against the local server); preferences, player, stats and admin stay in memory | Live API clients for every service | WP-1 |
| State persistence in localStorage | `services/memory/memoryStore.ts` | DynamoDB tables (`data-model.md`) behind the HTTP API | WP-1 |
| Game catalog | `services/memory/memoryGameService.ts`, `test-data/games.ts` | `GET /v1/games` from the bundled rules documents (`game-engine.md` Section 13) | GE-9, GE-10, WP-1 |
| Game sessions: create, apply, undo, hint, abandon | `services/memory/memorySessionService.ts` | `/v1/sessions*` over the server engine and `GameSessions` table | GE-10, WP-1 |
| Spider rules computed in the browser | `test-data/spider/simulator.ts`, `cards.ts` | The data-driven engine running `spider-solitaire` rules.v1.json on the server (`spider-solitaire.md`). The client must never compute rules (CLAUDE.md section 5); this simulator exists only to feed the prototype | SP-1 to SP-5, WP-1 |
| Session envelope, view redaction and legal action descriptors | `test-data/spider/envelope.ts` | Server `getView` and `listLegalActions` with face-down cards redacted | GE-7, WP-1 |
| Seeded shuffles from `Math.random` | `createServices.ts` seed argument | Server-side seed per session, stored for replay (`game-engine.md`) | GE-1, GE-10 |
| Stats recorded on win or abandon | `services/memory/memoryStats.ts` | `PlayerStats` table updated by the session service, read through `GET /v1/players/me/stats` (both live since DM-3) | WP-1 |
| Preferences | `services/memory/memoryPreferencesService.ts`, now only in `MEMORY` mode and on the local server; deployed stages use the `Preferences` table through the signed API since AA-9 | `Preferences` table through `/v1/players/me/preferences` | WP-1 (local `LIVE` mode) |
| Admin tier from the email prefix `admin` | `memoryPlayerService.ts` | `ADMIN` Cognito group (`scripts/grant-admin.sh`) | AA-8, AA-9 |
| Google and Apple sign in | `memoryPlayerService.ts` `signInWithProvider` (fake `<provider>.player@example.com` account) | Cognito federation with Google and Apple | AA-3, AA-9 |
| Account deletion | `memoryPlayerService.ts` `deleteAccount` (resets to guest) | `DELETE /v1/players/me` | AA-7, WP-3 |
| Guest to account merge | `MEMORY` mode and the local mock sign-in, where signing in keeps the browser's own data; deployed stages and `local-aws-auth` redeem a merge token since AA-6 | Merge token flow (`authn-authz.md` Section 6) | DM-3 (seats and stats), WP-3 |
| Admin metrics, failures and deployments | `services/memory/memoryAdminService.ts`, `test-data/admin.ts` (deterministic sample data), in `MEMORY` mode only | `/v1/admin/*` over `MetricRollups`, the turn log and CodePipeline, live since AA-8 | WP-4 (the deployed stages' `MEMORY` mode) |
| Deployment trigger | `memoryAdminService.ts` `startDeployment` (adds a fake in-progress row) | `POST /v1/admin/deployments` starting the pipeline | AA-8, WP-4 |

## 2. Voice

| Mock | Location | Real system | Replaced by |
|---|---|---|---|
| Speech capture in the game screen | `components/ListeningPanel.tsx`: in `MEMORY` mode the player types what they would say. Locally the microphone is captured and transcribed by the local server (LD-7) | Microphone audio through `SpeechInput`: Transcribe deployed, the local server locally | AD-9, WP-2 |
| Action decider | `services/memory/memoryDecisionService.ts`, `test-data/decider.ts` (`mockDecide`, keyword rules), in `MEMORY` mode only; locally `LIVE` mode calls the real decider | `POST /v1/decisions`: Bedrock Nova Micro classify and select layers (`action-decision.md`) | AD-1 to AD-5, WP-2 |
| Turn log and failure classes | Logged by the local server only | `TURN_DECIDED` and `TURN_RESOLVED` events in the `DecisionApi` log group, with HARD, SOFT and NONE classes | AD-5, CDK-9 |
| Speech output | `voice/speechOutput.ts`: browser `speechSynthesis` | Amazon Polly audio | AD-9, WP-2 |

## 3. Configuration and Hosting

| Mock | Location | Real system | Replaced by |
|---|---|---|---|
| Local stage configuration | `web-app/public/config.json` (`LOCAL`, `MEMORY`) | Stage `config.json` written by CDK (`cdk-stacks.md` Section 6) | CDK-6 for hosting; `dataMode` `LIVE` in WP-1 |
| Deployed stages in memory mode | Stage `config.json` sets `dataMode` `MEMORY`; the health check page is the only live API call | Full live configuration (User Pool, Identity Pool, OAuth domain, vocabulary) | AA-4, WP-1 |

## 4. Legs

This document adds no legs of its own. Each row names the leg that removes it, and that leg's commit deletes the row.
