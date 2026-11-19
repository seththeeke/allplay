# Prototype Mocks

Status: Day 0 design, 2026-11-19.

The phase 3 web prototype runs with `dataMode` `MEMORY` (`web-app/public/config.json` and each stage's `config.json`). Every place where it stands in for a real system is listed below with the leg that replaces it. A mock is removed only by the named leg, and that leg's commit deletes its row from this table. When the table is empty, `MEMORY` mode remains only as the test harness for `web-app` unit tests and the in-memory implementations stay as the test doubles required by CLAUDE.md section 5.

Related specs: `README.md` (execution order), `game-engine.md`, `action-decision.md`, `authn-authz.md`, `data-model.md`.

## 1. Service Layer

`web-app/src/services/createServices.ts` builds only in-memory services; `dataMode` `LIVE` throws. All in-memory state lives in `MemoryStore` (`src/services/memory/memoryStore.ts`), mirrored to the browser's localStorage, so it is per browser and never reaches the server.

| Mock | Location | Real system | Replaced by |
|---|---|---|---|
| Live mode refused | `services/createServices.ts` | Live API clients selected by `dataMode` `LIVE` | WP-1 |
| State persistence in localStorage | `services/memory/memoryStore.ts` | DynamoDB tables (`data-model.md`) behind the HTTP API | WP-1 |
| Game catalog | `services/memory/memoryGameService.ts`, `test-data/games.ts` | `GET /v1/games` from the bundled rules documents (`game-engine.md` Section 13) | GE-9, GE-10, WP-1 |
| Game sessions: create, apply, undo, hint, abandon | `services/memory/memorySessionService.ts` | `/v1/sessions*` over the server engine and `GameSessions` table | GE-10, WP-1 |
| Spider rules computed in the browser | `test-data/spider/simulator.ts`, `cards.ts` | The data-driven engine running `spider-solitaire` rules.v1.json on the server (`spider-solitaire.md`). The client must never compute rules (CLAUDE.md section 5); this simulator exists only to feed the prototype | SP-1 to SP-5, WP-1 |
| Session envelope, view redaction and legal action descriptors | `test-data/spider/envelope.ts` | Server `getView` and `listLegalActions` with face-down cards redacted | GE-7, WP-1 |
| Seeded shuffles from `Math.random` | `createServices.ts` seed argument | Server-side seed per session, stored for replay (`game-engine.md`) | GE-1, GE-10 |
| Stats recorded on win or abandon | `services/memory/memoryStats.ts` | `PlayerStats` table updated by the session service | DM-3, GE-10, WP-1 |
| Preferences | `services/memory/memoryPreferencesService.ts` | `Preferences` table through `/v1/players/me/preferences` | DM-1, AA-5, WP-1 |
| Player identity | `services/memory/memoryPlayerService.ts` (fixed `GUEST#local-prototype`) | Identity Pool guest identity, `resolveCaller` (`authn-authz.md`) | AA-4, AA-5, WP-1 |
| Sign in, sign up, confirmation codes, password reset | `memoryPlayerService.ts`: any email signs in, any six digit code is accepted | Cognito User Pool through Amplify JS | AA-1, AA-2, AA-9 |
| Admin tier from the email prefix `admin` | `memoryPlayerService.ts` | `ADMIN` Cognito group (`scripts/grant-admin.sh`) | AA-8, AA-9 |
| Google and Apple sign in | `memoryPlayerService.ts` `signInWithProvider` (fake `<provider>.player@example.com` account) | Cognito federation with Google and Apple | AA-3, AA-9 |
| Account deletion | `memoryPlayerService.ts` `deleteAccount` (resets to guest) | `DELETE /v1/players/me` | AA-7, WP-3 |
| Guest to account merge | Not modeled; signing in replaces the guest | Merge token flow (`authn-authz.md`) | DM-2, AA-6, WP-3 |
| Admin metrics, failures and deployments | `services/memory/memoryAdminService.ts`, `test-data/admin.ts` (deterministic sample data) | `/v1/admin/*` over `MetricRollups`, `Decisions` and CodePipeline | DM-5, AA-8, WP-4 |
| Deployment trigger | `memoryAdminService.ts` `startDeployment` (adds a fake in-progress row) | `POST /v1/admin/deployments` starting the pipeline | AA-8, WP-4 |

## 2. Voice

| Mock | Location | Real system | Replaced by |
|---|---|---|---|
| Speech capture | `components/ListeningPanel.tsx`: the player types what they would say | Microphone audio streamed to Amazon Transcribe with the stage's custom vocabulary | AD-9, WP-2 |
| Action decider | `services/memory/memoryDecisionService.ts`, `test-data/decider.ts` (`mockDecide`, keyword rules) | `POST /v1/decisions`: Bedrock Nova Micro classify and select layers (`action-decision.md`) | AD-1 to AD-5, WP-2 |
| Decision records and failure classes | Not recorded | `Decisions` table with HARD, SOFT, NONE and PENDING classes | DM-4, AD-5 |
| Speech output | `voice/speechOutput.ts`: browser `speechSynthesis` | Amazon Polly audio | AD-9, WP-2 |

## 3. Configuration and Hosting

| Mock | Location | Real system | Replaced by |
|---|---|---|---|
| Local stage configuration | `web-app/public/config.json` (`LOCAL`, `MEMORY`) | Stage `config.json` written by CDK (`cdk-stacks.md` Section 6) | CDK-6 for hosting; `dataMode` `LIVE` in WP-1 |
| Deployed stages in memory mode | Stage `config.json` sets `dataMode` `MEMORY`; the health check page is the only live API call | Full live configuration (User Pool, Identity Pool, OAuth domain, vocabulary) | AA-4, WP-1 |

## 4. Legs

This document adds no legs of its own. Each row names the leg that removes it, and that leg's commit deletes the row.
