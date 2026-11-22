# Prototype Mocks

Status: Day 0 design, 2026-11-19.

The phase 3 web prototype runs with `dataMode` `MEMORY` (`web-app/public/config.json` and each stage's `config.json`). Every place where it stands in for a real system is listed below with the leg that replaces it. A mock is removed only by the named leg, and that leg's commit deletes its row from this table. When the table is empty, `MEMORY` mode remains only as the test harness for `web-app` unit tests and the in-memory implementations stay as the test doubles required by CLAUDE.md section 5.

Related specs: `README.md` (execution order), `game-engine.md`, `action-decision.md`, `authn-authz.md`, `data-model.md`.

## 1. Service Layer

Since WP-1, deployed stages and local `LIVE` mode call the API for games, sessions, decisions, stats and preferences: signed by Amplify on deployed stages, through the local server locally. `MEMORY` mode keeps every service in `MemoryStore` (`src/services/memory/memoryStore.ts`) as the unit test harness. The rows below are what still stands in for a real system.

| Mock | Location | Real system | Replaced by |
|---|---|---|---|
| Google and Apple sign in | `memoryPlayerService.ts` `signInWithProvider` (fake `<provider>.player@example.com` account) | Cognito federation with Google and Apple | AA-3, AA-9 |
| Account deletion | `memoryPlayerService.ts` `deleteAccount` (resets to guest) | `DELETE /v1/players/me` | AA-7, WP-3 |
| Guest to account merge | `MEMORY` mode and the local mock sign-in, where signing in keeps the browser's own data; deployed stages and `local-aws-auth` redeem a merge token since AA-6 | Merge token flow (`authn-authz.md` Section 6) | DM-3 (seats and stats), WP-3 |
| Admin metrics, failures and deployments | `services/memory/memoryAdminService.ts`, `test-data/admin.ts` (deterministic sample data), in `MEMORY` mode only | `/v1/admin/*` over `MetricRollups`, the turn log and CodePipeline, live on deployed stages since AA-8 | WP-4 |
| Deployment trigger | `memoryAdminService.ts` `startDeployment` (adds a fake in-progress row) | `POST /v1/admin/deployments` starting the pipeline | AA-8, WP-4 |

## 2. Voice

| Mock | Location | Real system | Replaced by |
|---|---|---|---|
| Speech capture in the game screen | `components/ListeningPanel.tsx`: in `MEMORY` mode the player types what they would say. Locally the microphone is captured and transcribed by the local server (LD-7) | Microphone audio through `SpeechInput`: Transcribe deployed, the local server locally | AD-9, WP-2 |
| Speech output | `voice/speechOutput.ts`: browser `speechSynthesis` | Amazon Polly audio | AD-9, WP-2 |

## 3. Configuration and Hosting

Nothing here is mocked. CDK writes each stage's `config.json` with `dataMode` `LIVE` (`cdk-stacks.md` Section 6), and `web-app/public/config.json` points local `LIVE` mode at the local server.

## 4. Legs

This document adds no legs of its own. Each row names the leg that removes it, and that leg's commit deletes the row.
