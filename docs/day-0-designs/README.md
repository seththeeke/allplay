# Day 0 Designs

Status: Day 0 design, 2026-11-17.

This folder holds the day 0 specification of All Play. Read the documents in this order:

| Document | Contents |
|---|---|
| `0-day-0-project-idea.md` | Product brief and the binding Appendix of clarifications |
| `data-model.md` | Every persisted entity, its table, indexes and a sample item |
| `game-engine.md` | Data-driven engine, rules document format, public interface, session API |
| `spider-solitaire.md` | The Spider Solitaire rules document, vocabulary and test plan |
| `prototype-mocks.md` | Every mock in the web prototype and the leg that replaces it |
| `action-decision.md` | Speech capture, the two-layer LLM decision, confirmation, turn records |
| `authn-authz.md` | Guests, accounts, roles, Cognito, IAM route authorization, guest merge |
| `cdk-stacks.md` | Stacks, constructs, pipeline, cost and telemetry, codebase layout and tooling |
| `/CLAUDE.md` | Working rules for Claude in this repository |

## Execution Order

The execution plan in the project brief runs in eight phases, plus phase 3a (the pipeline walking skeleton), which runs after the web prototype and before authentication. Each row below is one leg and one commit, in order. Leg details are in the named spec.

### Phase 1: CLAUDE.md setup

CLAUDE.md is written as part of the specification. No further legs.

### Phase 2: Rule and build setup

CDK-1, CDK-2, CDK-3, CDK-4 (`cdk-stacks.md`).

### Phase 3: Web App prototyping

The prototype runs entirely in the web app's in-memory mode, with mock data shaped exactly like the API contracts in `backend/src/models/api/`.

| Leg | Scope |
|---|---|
| WA-1 | API contract models in `backend/src/models/api/` for every route in the specs, and the `@allplay/api-models` alias |
| WA-2 | App shell: routes and tier guards, `config.ts`, theme stylesheets and tokens, zoom scaling, default large type and oversized controls |
| WA-3 | Home page with large game tiles, voice and keyboard navigable; direct routes such as `/spider` |
| WA-4 | Game page for Spider Solitaire rendering a mock session envelope: columns with numbers, stock, completed runs, header, proposal banner, choices, blocked banner |
| WA-5 | Tap-to-select and drag-and-drop against mock legal actions (`game-engine.md` Section 12) |
| WA-6 | Voice UI with a mock decider: Space and Talk button, listening banner, proposal and choice flow, key map (`action-decision.md` Section 3.3) |
| WA-7 | Settings and stats pages with auto-saved preferences (in-memory) |
| WA-8 | Help walkthrough: highlights on first visit per game, replayable from Help |
| WA-9 | Auth page layouts and admin page layout with mock metrics charts |

### Phase 3a: Pipeline walking skeleton

Before any phase builds application features (authentication onward), the delivery path runs end to end with the leanest possible slice of every package. Each leg is deployed through the pipeline, not by hand.

| Leg | Scope |
|---|---|
| CDK-5 | `AllPlayPipeline`: GitHub source, synth with lint and unit tests, self-mutate, Test and Prod stages, schedule, budget, alert topic; `docs/runbooks/bootstrap.md` |
| CDK-6 | `WebHosting` construct; the web app (the phase 3 prototype in in-memory mode) served from each stage's default CloudFront URL |
| SK-1 | Sample backend slice: the `AllPlayFunction` and `AllPlayApi` constructs, the dedicated `AllPlay-HealthApi-<Stage>` Lambda behind the public route `GET /v1/health` on the API's default URL, and the web app's `/health` page that calls it |
| SK-2 | Integration tests for `GET /v1/health` and a smoke test of the stage's CloudFront URL, run by the pipeline against Test before Prod deploys, then the same read-only check against Prod |
| SK-3 | A recorded green pipeline run from a push through Prod, with the runbook updated from what was learned |

The health Lambda, route and page stay as the stage health check. The skeleton has no table and no Identity Pool; DM-1 and AA-4 add them. Playwright smoke tests arrive with CDK-10. Every mock the prototype still relies on is listed in `prototype-mocks.md`.

### Phase 4: Authentication

DM-1, DM-2 (`data-model.md`); CDK-7 (`cdk-stacks.md`); AA-1 through AA-10 (`authn-authz.md`).

### Phase 5: Game Engine

DM-3; GE-1 through GE-9 (`game-engine.md`); SP-1 through SP-5 (`spider-solitaire.md`); GE-10, GE-11; CDK-8.

### Phase 6: Backend decision actions

DM-4, DM-5; AD-1 through AD-8 (`action-decision.md`); CDK-9.

### Phase 7: Web app polishing

| Leg | Scope |
|---|---|
| WP-1 | Live services replace in-memory services for games, sessions, players and preferences |
| WP-2 | AD-9: live Transcribe capture, decision calls, Polly playback |
| WP-3 | Guest merge flow and account deletion in the UI |
| WP-4 | Admin page on live metrics, failure browsing and deployment trigger |
| WP-5 | Mobile web layout pass: on-screen controls, touch targets, portrait and landscape |
| CDK-10 | Browser smoke tests and Prod verification in the pipeline |

### Phase 8: Mobile App development

| Leg | Scope |
|---|---|
| IOS-1 | Xcode project, `AllPlayKit` package, SwiftLint, CI build |
| IOS-2 | Amplify Swift configuration, guest credentials, signed API client, contract fixture tests |
| IOS-3 | Home and Spider game screens rendering the session envelope; tap and drag play |
| IOS-4 | Apple Speech capture, decision flow, confirmation, Polly playback |
| IOS-5 | Sign in (email, Google, Apple), guest merge, Face ID unlock, account deletion |
| IOS-6 | Settings, stats, help walkthrough; admin tabs for admins |
