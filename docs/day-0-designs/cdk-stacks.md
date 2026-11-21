# CDK Stacks and Codebase

Status: Day 0 design, 2026-11-17.

This document defines the AWS infrastructure (CDK stacks, constructs, pipeline, cost controls and telemetry) and the codebase layout and tooling that enforce separation of concerns.

Related specs: `data-model.md`, `game-engine.md`, `action-decision.md`, `authn-authz.md`.

## 1. Principles

1. All infrastructure is TypeScript CDK in `cdk/`. Nothing is created by hand except the items listed in Section 10.
2. One AWS account, region `us-east-1`. Test and Prod are two deployments of the same stage class, and every named resource carries the stage suffix: `AllPlay-<Name>-<Stage>`.
3. Serverless only. No resource has an hourly charge: no NAT gateways, VPCs, provisioned concurrency, provisioned DynamoDB capacity, or always-on compute.
4. Every resource type is wrapped in an All Play construct that applies project defaults, and stacks instantiate those constructs rather than raw CDK classes.

## 2. Stacks

| Stack | Instances | Contents |
|---|---|---|
| `AllPlayPipeline` | One | CodePipeline, CodeBuild projects, GitHub connection reference, daily schedule, budget, alert topic |
| `AllPlayStateful-<Stage>` | Test, Prod | DynamoDB tables, the federation secret, Cognito User Pool (groups, domain, identity providers, triggers) |
| `AllPlayApp-<Stage>` | Test, Prod | HTTP API and its Lambdas, the User Pool app clients and the Identity Pool with its four roles (the web client's URLs name this stack's CloudFront origin, so they cannot live in the stateful stack without a dependency cycle; the Identity Pool is retained on deletion so guest identities survive), metrics rollup job and schedule, web hosting (S3, CloudFront), stage `config.json`, Transcribe vocabulary, IAM route policies attached to the Identity Pool roles, alarms |

The stateful and app split protects player data and identities from application changes: the stateful stack has termination protection in Prod, retains its resources on deletion, and changes rarely. The app stack can be replaced freely. The app stack depends on the stateful stack and receives its resources as constructor props; the stateful stack never references the app stack. Policies that grant the Identity Pool roles access to API routes are `iam.Policy` resources created in the app stack and attached to those roles, which keeps the dependency one-way.

Cognito trigger Lambdas live in the stateful stack because the User Pool references them.

## 3. Constructs

`cdk/lib/constructs/`:

| Construct | Defaults it applies |
|---|---|
| `AllPlayTable` | On-demand billing, stage-suffixed name, `RemovalPolicy.RETAIN`, PITR and deletion protection in Prod, optional TTL attribute, GSIs from props |
| `AllPlayFunction` | `NodejsFunction`, Node.js 22.x, arm64, esbuild minify with source maps, explicit log group with 14 day retention, stage-suffixed name, structured JSON logging, `STAGE` env var, no X-Ray |
| `AllPlayApi` | HTTP API, `AWS_IAM` on every route, CORS for the stage's web origins, JSON access logs (14 days), default route throttling 20 requests per second with burst 40 |
| `ApiBundle` | One Lambda per bundle with its routes built from the bundle's route list file (Section 5) |
| `UserPool`, `IdentityPool` | Per `authn-authz.md` Sections 3 and 4 |
| `WebHosting` | Private S3 bucket, CloudFront with origin access control, SPA routing function, security headers, `config.json` deployment |
| `TranscribeVocabulary` | Custom resource that creates, updates and deletes the stage's Transcribe custom vocabulary |
| `ScheduledJob` | EventBridge Scheduler schedule targeting an `AllPlayFunction` with retries and a dead-letter queue |
| `AllPlayAlarm` | CloudWatch alarm wired to the alert topic |

## 4. Lambdas

| Lambda | Trigger | Memory (MB) | Timeout |
|---|---|---|---|
| `AllPlay-GameApi-<Stage>` | API: `/v1/games*`, `/v1/sessions*` | 1024 | 10 s |
| `AllPlay-DecisionApi-<Stage>` | API: `/v1/decisions*` | 1024 | 10 s |
| `AllPlay-PlayerApi-<Stage>` | API: `/v1/players*` | 512 | 10 s |
| `AllPlay-AdminApi-<Stage>` | API: `/v1/admin*` | 512 | 10 s |
| `AllPlay-HealthApi-<Stage>` | API: `GET /v1/health` | 256 | 5 s |
| `AllPlay-MetricsRollup-<Stage>` | Scheduler, daily 00:15 UTC | 512 | 5 min |
| `AllPlay-CognitoPreSignUp-<Stage>` | User Pool | 256 | 5 s |
| `AllPlay-CognitoPostConfirmation-<Stage>` | User Pool | 256 | 5 s |
| `AllPlay-CognitoPostAuthentication-<Stage>` | User Pool | 256 | 5 s |
| `AllPlay-CognitoCustomMessage-<Stage>` | User Pool | 256 | 5 s |

Each Lambda role is granted only the specific table ARNs (and index ARNs), Bedrock model ARNs, and API calls its bundle uses. A new route on an existing bundle adds a route and a controller, never a Lambda; a new bundle is a design decision recorded in a doc.

## 5. API

`AllPlay-Api-<Stage>` is one HTTP API. Each bundle has an import-free route list at `backend/src/controller/web-api/<bundle>/<bundle>Routes.ts` (method, path, minimum tier). `cdk/` imports these files to create routes; it is the only sanctioned import from `cdk/` into `backend/`, legal because those files import nothing. The same lists generate the IAM route policies for each Identity Pool role from each route's minimum tier, so route authorization is defined in one place.

`POST /v1/decisions` has its own throttling: 50 requests per second, burst 100.

`GET /v1/health` is the only route without `AWS_IAM`. It is served by the dedicated `HealthApi` Lambda (bundle `health`), reads no data, and returns `200` with `{ "status": "OK", "stage": "<Stage>" }`. The API is reached at its default `execute-api` URL until a domain exists (Section 8), and the stage's `config.json` carries that URL as `apiUrl`. The web app's `/health` page calls the route and shows the result.

## 6. Web Hosting

1. One `web-app` build serves both stages. Stage-specific values (region, User Pool id, app client id, Identity Pool id, API URL, OAuth domain, vocabulary name) are written by CDK to `/config.json` in each stage's bucket, and the app loads it at startup.
2. A CloudFront Function rewrites any request path without a file extension to `/index.html`, so direct links like `/spider` and `/admin` load the app.
3. `index.html` and `config.json` are served with `Cache-Control: no-cache`; hashed assets with a one year immutable cache.
4. A response headers policy sets a Content Security Policy that allows only the stage's API, Cognito, Transcribe streaming and Polly endpoints, plus HSTS, `X-Content-Type-Options` and `Referrer-Policy`.
5. Price class 100.

## 7. Pipeline

`AllPlayPipeline` uses CDK Pipelines (`pipelines.CodePipeline`, pipeline type V2) and self-mutates.

| Step | Behavior |
|---|---|
| Source | GitHub repository `seththeeke/allplay`, branch `main`, through an AWS CodeConnections connection whose ARN is read at deploy time from the SSM parameter `/allplay/github-connection-arn`, so the public repository holds no account identifiers. Pushes do not trigger the pipeline |
| Triggers | EventBridge Scheduler daily at 10:00 UTC, and `POST /v1/admin/deployments` from either stage |
| Synth | `npm ci` in each package; lint everywhere; unit tests with coverage gates in `backend/`, `web-app/` and `cdk/`; `web-app` build; `cdk synth` with cdk-nag checks |
| Self-mutate | Updates the pipeline from the synthesized template |
| Deploy Test | `AllPlayStateful-Test`, then `AllPlayApp-Test` |
| Test verification | A CodeBuild step (`CodeBuildStep`) with `INTEGRATION_SCOPE=stage`: API integration tests against Test (`backend` `npm run test:integration` with the stage's API URL), including tests that write data. Its role holds only the stage's `verifyGrants`: each construct that integration tests exercise adds the grants they need there, such as a table's read and write. Test accounts (`authn-authz.md` Section 10) are managed through `AllPlay-IntegrationAccounts-Test`, a role in `AllPlayStateful-Test` only, holding `AdminCreateUser`, `AdminSetUserPassword`, `AdminAddUserToGroup` and `AdminDeleteUser` on that pool; the verification role may assume it by name, so its policy needs no wildcard and no reference into the stage. Tests that write tag their data with the run id (`itest-<build id>`) and remove it after the file's tests. Then a smoke test of the Test CloudFront URL, and Playwright browser smoke tests from CDK-10 |
| Deploy Prod | Runs only when Test verification passes: `AllPlayStateful-Prod`, then `AllPlayApp-Prod` |
| Prod verification | The same step with `INTEGRATION_SCOPE=readonly`, so tests that write are skipped: load the site and `GET /v1/health`; from AA-4 also obtain guest credentials and `GET /v1/games` |

CodeBuild uses the small ARM Linux image with npm caching. A failed run sends a notification to the alert topic.

GitHub Actions runs lint and unit tests on every pull request and every push to `main` (no AWS access). Branch protection on `main` requires that check.

## 8. Domain (Deferred)

The stages serve from their default CloudFront and API Gateway URLs until a domain is registered. The stage class accepts an optional `domain` prop; when set, it adds a Route 53 hosted zone lookup, an ACM certificate, CloudFront aliases (`<domain>` for Prod, `test.<domain>` for Test), an API custom domain (`api.<domain>`, `api.test.<domain>`), app client callback URLs, and an SES domain identity that becomes the Cognito email sender. No other construct changes.

## 9. Cost Controls and Telemetry

Target: fixed infrastructure cost under $25 per month, excluding usage-driven Bedrock and Transcribe.

Budget: an AWS Budgets monthly cost budget of $25 (defined in `AllPlayPipeline`) notifies the alert email at 80% actual, 100% actual and 100% forecasted spend.

Telemetry kept:

| Signal | Where | Cost driver |
|---|---|---|
| Business metrics (players, active players, turn failures, latency, LLM tokens, games) | `MetricRollups` table, /admin page (`data-model.md` Section 12) | DynamoDB writes, negligible |
| Lambda logs | CloudWatch Logs, structured JSON, 14 day retention, `INFO` level in Prod | Log ingestion |
| API access logs | CloudWatch Logs, 14 day retention | Log ingestion |
| Default AWS metrics | Lambda, API Gateway, DynamoDB, CloudFront | Free |
| Alarms (Section 9.1) | CloudWatch, five per stage | $0.10 per alarm per month |

Telemetry not used: X-Ray tracing, CloudWatch dashboards, custom CloudWatch metrics (Embedded Metric Format or `PutMetricData`), CloudWatch RUM, Synthetics canaries, CloudTrail data events, and client-side error collection. Each can be added later behind a design note; none is needed to run the product at day 0 scale.

### 9.1 Alarms

Per stage, notifying the alert topic `AllPlay-Alerts` (defined in `AllPlayPipeline`, with an email subscription to the address in `ALERT_EMAIL` in that stack):

1. `DecisionApi` errors at least 5 in 5 minutes.
2. `GameApi` errors at least 5 in 5 minutes.
3. API Gateway 5xx responses at least 10 in 5 minutes.
4. `MetricsRollup` errors at least 1 in 1 day, or its dead-letter queue is not empty.
5. Bedrock throttling: `DecisionApi` log metric filter on `BEDROCK_THROTTLED` at least 5 in 5 minutes.

### 9.2 Estimated Fixed Monthly Cost

| Item | Estimate |
|---|---|
| Secrets Manager (federation secret per stage, integration test secret) | $1.20 |
| CloudWatch alarms (10) | $1.00 |
| Pipeline (V2 action minutes, about 25 minutes per day) and CodeBuild (ARM small) | $4.50 |
| CloudWatch Logs ingestion and storage at low traffic | $1.00 |
| DynamoDB, S3, CloudFront, API Gateway, Lambda, Cognito at day 0 traffic | Free tier or under $1.00 |
| Route 53 hosted zone (after the domain exists) | $0.50 |
| Total | About $9 |

## 10. Manual Prerequisites

Done once by hand, documented in `docs/runbooks/bootstrap.md`:

1. `cdk bootstrap` of the account and region.
2. A CodeConnections connection to GitHub, authorized in the console; its ARN is stored in the SSM parameter `/allplay/github-connection-arn`.
3. Confirming the `AllPlay-Alerts` email subscription from the inbox after the first pipeline deploy.
4. The federation secret per stage (`authn-authz.md` Section 3.1) and the Google and Apple developer configuration.
5. The integration test secret `allplay/test/integration`.
6. The first `cdk deploy AllPlayPipeline`; afterward the pipeline deploys itself.

Every mutating command follows the CLAUDE.md deploy safety gate.

## 11. Codebase Layout

```
allplay/
  CLAUDE.md
  package.json              root scripts only: lint, test, coverage rollup, docs check
  .github/workflows/ci.yml
  .githooks/                pre-commit lint of changed packages
  docs/
  scripts/                  grant-admin.sh, check-docs.mjs, rollup-coverage.mjs
  backend/                  npm package: Lambda code
  web-app/                  npm package: React app
  cdk/                      npm package: infrastructure
  ios/                      Xcode project: Swift app
```

Each of `backend/`, `web-app/` and `cdk/` is an independent npm package with its own lockfile. There are no npm workspaces.

### 11.1 backend/

```
backend/src/
  controller/
    web-api/<bundle>/       router, route list, one controller per route
    web-api/shared/         response helpers, resolveCaller, requireTier
    cognito/                trigger controllers and email templates
    scheduled/              metrics rollup job controller
  service/                  logical services: gameSession, decision, player, merge, metrics, admin
  dao/<entity>/             one folder per data-model.md entity, names matching exactly
  models/                   one file per type: TypeScript type plus zod schema; models/api/ for request and response contracts
  game-engine/              game-engine.md Section 16
  game-catalog/             bundled rules documents
  logger.ts
backend/tests/              mirrors src/
backend/tests/integration/  API integration tests run against a deployed stage
```

Layering: a controller parses its trigger payload with zod first, then calls services; services call DAOs and other services; DAOs call DynamoDB. Controllers never call DAOs, and nothing outside `dao/` imports the DynamoDB client.

### 11.2 web-app/

React with Vite, React Router, TanStack Query, Tailwind CSS, Amplify JS v6.

```
web-app/src/
  routes/          route table and one guard per tier (guest, account, admin)
  pages/           top-level pages: Home, Game, Stats, Settings, Help, Admin, Auth
  components/      reusable components, each under 200 lines
  hooks/           data hooks on TanStack Query; components call hooks, never services
  services/        API clients, each with a live and an in-memory implementation
  voice/           Transcribe capture, Polly playback, key handling
  themes/          one stylesheet per theme, tokens on :root
  models/          re-exports of backend/src/models/api through the @allplay/api-models alias
  config.ts        loads /config.json
web-app/tests/     mirrors src/, plus smoke/ for Playwright
web-app/test-data/ data for the in-memory mode
```

The API contract models are defined once in `backend/src/models/api/` and imported by `web-app` through the `@allplay/api-models` path alias. Files in `models/api/` import only `zod`, which a lint rule enforces. The in-memory mode (`VITE_DATA_MODE=memory`) replaces every service with its in-memory implementation and powers the execution phase 3 prototype.

### 11.3 cdk/

```
cdk/
  bin/app.ts             app entry: the pipeline stack, which holds the Test and Prod stages
                         (deploy one by hand as AllPlayPipeline/<Stage>/*)
  lib/stage.ts           AllPlayStage (stateful and app stacks for one stage)
  lib/stacks/            AllPlayPipeline, AllPlayStateful, AllPlayApp
  lib/constructs/        Section 3
  lib/nag.ts             acknowledgment helper for findings on CDK-generated resources
  tests/                 mirrors lib/; fine-grained assertions, no snapshots
```

### 11.4 ios/

Xcode project `AllPlay`, SwiftUI, Amplify Swift, a Swift package `AllPlayKit` for models, API client and view models (unit tested with XCTest), and SwiftLint. API contract fixtures exported from backend tests are decoded in iOS tests to keep the Swift models in step with `models/api/`.

## 12. Tooling and Enforcement

CLAUDE.md states the rules; linters and checks enforce them.

| Rule | Enforcement |
|---|---|
| TypeScript strict, `noUncheckedIndexedAccess`, no `any` | `tsconfig` plus `@typescript-eslint/no-explicit-any` as an error |
| Block comments only, prose at most 500 characters | Custom `local/comment-format` rule (from nyc-311) in every package |
| Game engine isolation | `no-restricted-imports` and a custom boundary rule (`game-engine.md` Section 16) |
| Controller to service to DAO layering | `no-restricted-imports` by folder |
| `models/api/` imports only zod | `no-restricted-imports` |
| Web components under 200 lines | `max-lines` on `components/**` |
| Components use hooks, not services | `no-restricted-imports` |
| Accessibility | `eslint-plugin-jsx-a11y` (recommended, as errors) plus axe checks in Playwright smoke tests |
| Formatting | Prettier |
| Coverage of 95% or more (lines, branches, functions, statements) | Vitest v8 thresholds in `backend/`, `web-app/`, `cdk/`; the build fails below them |
| CDK security defaults | cdk-nag `AwsSolutions` pack in synth, each suppression with a written reason |
| No emojis in docs or code | `scripts/check-docs.mjs` over `docs/`, `*.md` and source files, run by `npm run lint` |
| Swift style | SwiftLint in the Xcode build |

Shared ESLint rules (the `local/comment-format` rule and the boundary rule) live once in `scripts/eslint/localRules.cjs` and are loaded by each package's `eslint.config.js`. Each package's tests include lint-rule tests that run ESLint on small fixture snippets, so a weakened rule fails the build.

## 13. Local Emulator Testing

Superseded on 2026-11-20 by `local-development.md`: the AWS Emulator is not used, and local testing runs the whole stack in memory. The text below is kept for the record.

The AWS Emulator (`github.com/aws/aws-emulator`, launched 2026-11-11) runs AWS APIs locally at `https://127.0.0.1:9297` with no AWS account. On macOS it runs in Docker from an image built with the project's documented Dockerfile. State lives in memory and is lost when the emulator stops; IAM policies are not evaluated.

All Play uses the emulator for the parts of the backend whose AWS behavior it reproduces, and keeps everything else on fakes in unit tests and on the Test stage in integration tests.

| Use the emulator for | Use fakes or the Test stage for |
|---|---|
| DAO and service tests against DynamoDB: tables, GSIs, conditional writes, `ADD` counters, queries | Lambda execution, API Gateway HTTP API routes and `AWS_IAM` authorization |
| Merge, rate limit and metrics rollup logic end to end against DynamoDB | IAM and Identity Pool role policies (the emulator does not evaluate policies) |
| Cognito User Pool sign-up, sign-in and group APIs called directly (no triggers) | Cognito Lambda triggers, managed login, Google and Apple federation, email |
| Identity Pool guest identities and credential vending | Transcribe streaming, Polly audio, Bedrock inference (fake `LlmClient`) |
| Secrets Manager reads | CloudFormation and `cdk deploy`, CloudFront, CodePipeline, CodeBuild, Budgets, alarms |

Tooling:

1. `scripts/emulator/Dockerfile` and `scripts/emulator/run.sh` build and start the emulator with telemetry off, bound to `127.0.0.1:9297`.
2. `backend/tests/emulator/` holds emulator tests, run with `npm run test:emulator`. They create the tables they need from the same table definitions the CDK uses, and are excluded from the unit test run and its coverage gate.
3. The emulator test setup exports the SDK settings the emulator documents (`AWS_ENDPOINT_URL`, `NODE_EXTRA_CA_CERTS`, the emulator's credentials and config files) and constructs clients with `disableHostPrefix: true`.
4. Emulator tests run locally. The pipeline's integration tests always run against the real Test stage.

## 14. Implementation Legs

| Leg | Execution phase | Scope |
|---|---|---|
| CDK-1 | 2. Rule and build setup | Root `package.json`, `.githooks`, `scripts/check-docs.mjs`, Prettier, GitHub Actions CI |
| CDK-2 | 2. Rule and build setup | `backend/` package: tsconfig, ESLint with all custom rules, Vitest with coverage thresholds, folder skeleton |
| CDK-3 | 2. Rule and build setup | `web-app/` package: Vite, React, Tailwind, ESLint, Vitest, Playwright, folder skeleton |
| CDK-4 | 2. Rule and build setup | `cdk/` package: app entry, stage, empty stacks, base constructs, cdk-nag, tests |
| CDK-5 | 3a. Pipeline walking skeleton | `AllPlayPipeline`: source, synth, self-mutate, Test and Prod stages, schedule, budget, alert topic; bootstrap runbook |
| CDK-6 | 3a. Pipeline walking skeleton | `WebHosting` construct; the pipeline deploys the in-memory prototype to Test and Prod |
| SK-1 to SK-3 | 3a. Pipeline walking skeleton | `AllPlayFunction` and `AllPlayApi` constructs with the public health route and its Lambda, integration and smoke tests in the pipeline, a recorded green run (`README.md`, phase 3a) |
| CDK-7 | 4. Authentication | `ApiBundle`, `AWS_IAM` routes from route lists, route policy generation |
| CDK-8 | 5. Game Engine | `GameApi` bundle wiring and the integration test stage step |
| CDK-9 | 6. Action Decider | `DecisionApi` wiring, Bedrock grants, `TranscribeVocabulary`, `ScheduledJob` for the rollup, alarms |
| CDK-10 | 7. Web app polishing | Playwright smoke step and Prod verification step |
| CDK-11 | After a domain is registered | Domain props, certificates, aliases, SES email |
| CDK-12 | Superseded by `local-development.md` | Emulator Dockerfile and run script, `test:emulator` setup, first emulator tests for the `Players` and `Preferences` DAOs |

Authentication, data and engine resources are added by the legs of their own specs (`AA-*`, `DM-*`, `GE-*`, `AD-*`), using these constructs.
