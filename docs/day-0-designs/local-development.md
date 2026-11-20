# Local Development

Status: Day 0 design, 2026-11-20. This spec states the constraint and the shape of the solution; its legs are refined as the work is mapped.

All Play runs end to end on a developer's machine, entirely in memory, with no AWS account, no Docker and no network access beyond the browser and localhost. The local stack is the first place every feature runs, and it exists before any DynamoDB table is built.

Related specs: `cdk-stacks.md` (deployed stacks), `game-engine.md` Section 11 (session persistence), `authn-authz.md` (identity), `action-decision.md` (voice), `prototype-mocks.md` (mocks still in the web app).

## 1. Principles

1. One command starts the whole system locally: the backend as a Node.js server and the web app from Vite.
2. The local backend runs the same Lambda handlers, controllers, services and route lists that deploy to AWS. Only the outermost adapters differ: HTTP instead of API Gateway, in-memory DAOs instead of DynamoDB, and fakes instead of Bedrock, Transcribe, Polly and Cognito.
3. Every DAO has an in-memory implementation first. It passes the same contract test suite as the DynamoDB implementation, which is built later (`game-engine.md` Section 11.1 is the first instance).
4. The API integration tests run against the local server as well as the deployed Test stage, so most integration failures surface on a laptop or in CI without AWS.
5. The AWS Emulator is not used. It cannot run Lambda, API Gateway HTTP APIs or IAM authorization and needs Docker. `cdk-stacks.md` Section 13 and leg CDK-12 are superseded by this spec.

## 2. Local Server

`backend/src/local/` holds the local server. It is never bundled into a Lambda.

1. A `node:http` server on `http://localhost:4000` serves every route in the backend route lists. The `npm run dev:server` script in `backend/` starts it.
2. Each request becomes an API Gateway HTTP API (payload 2.0) event and is passed to the same handler the route's Lambda uses. The handler's result becomes the HTTP response.
3. Services are built once per server process with in-memory DAOs, so state lasts until the server stops. A reset endpoint, available only on the local server, clears it for tests.
4. CORS allows the local web origin (`http://localhost:5173`).

## 3. Identity

Deployed stages authorize with IAM and Identity Pool credentials (`authn-authz.md`). Locally:

1. The caller's identity comes from a development header, `x-allplay-dev-caller`, with a fixed guest as the default. The local server maps it into the request context fields that `resolveCaller` reads.
2. Tier checks (`requireTier`) run unchanged. The header can select a guest, a player or an admin, so tier behavior is testable locally.
3. Only the local server reads the header. Deployed handlers ignore it, and a test asserts that.

## 4. Fakes for AWS Services

| Service | Local stand-in |
|---|---|
| DynamoDB | In-memory DAOs that share contract tests with the DynamoDB DAOs |
| Bedrock (action decider) | A deterministic fake `LlmClient` (`action-decision.md`) |
| Transcribe | Typed text from the listening panel, or the browser's speech recognition where available |
| Polly | The browser's speech synthesis |
| Cognito sign-in | A local sign-in that issues a development caller for the identity header |
| CodePipeline (admin deployments) | A fake that records requested deployments |

## 5. Web App

The web app gains `dataMode: LIVE` services (`prototype-mocks.md`, WP-1). Locally it uses `LIVE` against `http://localhost:4000/`. Its `MEMORY` mode remains the unit test harness. A local config file selects the local API URL, and `npm run dev` at the repository root starts both the server and Vite.

## 6. Local Integration Tests

The API integration suite in `backend/tests/integration/` takes its target from `API_URL`. A local run starts the server, resets its state, runs the suite and stops the server. GitHub Actions runs it on every push. The pipeline still runs the same suite against the deployed Test stage.

## 7. Legs

Mapped as the work proceeds. Each leg is one commit.

| Leg | Scope |
|---|---|
| LD-1 | Local server skeleton: event adapter, route table from the route lists, the health route, `dev:server` script and tests |
| LD-2 | Session and game routes on the local server with the in-memory session DAO |
| LD-3 | Local caller identity header and its mapping into `resolveCaller` |
| LD-4 | Web app `LIVE` services against the local server, and a root `npm run dev` |
| LD-5 | Local integration test run in GitHub Actions |
| LD-6 | Fakes for the decider, sign-in and deployments as those features land |
