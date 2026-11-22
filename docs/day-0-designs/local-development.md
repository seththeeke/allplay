# Local Development

Status: Day 0 design, 2026-11-20. Legs are refined as the work is mapped.

All Play runs end to end on a developer's machine in memory, with no AWS account, no Docker and no deployed stack. The local stack is the first place every feature runs, and it exists before any DynamoDB table is built.

Related specs: `cdk-stacks.md` (deployed stacks), `game-engine.md` Section 11 (session persistence), `authn-authz.md` (identity), `action-decision.md` Sections 3.4, 13 and 16 (voice providers), `prototype-mocks.md` (mocks still in the web app).

## 1. Principles

1. One command starts the whole system locally: the backend as a Node.js server and the web app from Vite.
2. The local backend runs the same Lambda handlers, controllers, services and route lists that deploy to AWS. Only the implementations behind the provider interfaces differ (`action-decision.md` Section 16): storage, language model, speech to text and text to speech.
3. Each capability is chosen independently, so any mix runs the same business logic, for example in-memory storage with Bedrock, Transcribe and Polly.
4. Every DAO has an in-memory implementation first, which passes the same contract tests as its DynamoDB implementation.
5. The API integration tests run against the local server as well as the deployed Test stage.
6. The AWS Emulator is not used: it cannot run Lambda, HTTP APIs or IAM authorization, and it needs Docker. `cdk-stacks.md` Section 13 and CDK-12 are superseded.

## 2. Local Server

`backend/src/local/` holds the local server. It is never bundled into a Lambda.

1. A `node:http` server on `http://localhost:4000` serves every route in the backend route lists, plus the local-only routes below. `npm run dev:server` in `backend/` starts it.
2. Each API request becomes an API Gateway HTTP API (payload 2.0) event and is passed to the same handler the route's Lambda uses. The handler's result becomes the HTTP response.
3. Services are built once per process by the composition root `backend/src/local/providers.ts`, so state lasts until the server stops.
4. CORS allows the local web origin, `http://localhost:5173`.

Local-only routes (never deployed):

| Route | Purpose |
|---|---|
| `GET /local/status` | The active preset, the implementation chosen for each capability, and whether each is available (for example "macOS speech helper not built") |
| `POST /local/speech/transcribe` | WAV audio in (16 kHz mono PCM), `{ text, transcriptSource, provider, latencyMs }` out |
| `POST /local/speech/synthesize` | `{ text, rate }` in (1 to 600 characters, rate 0.5 to 2), `audio/wav` out; 503 when text to speech is not set up |
| `GET /local/speech/spoken` | With the recording `TextToSpeech`, every text it was asked to speak, for automation that cannot listen |
| `GET /local/decisions` | The most recent turn log events (`action-decision.md` Section 9.1), kept in memory by the local server, newest first, for the Voice Lab |
| `POST /local/reset` | Clears all in-memory state, for tests |
| `POST /local/seed` | `{ seed }` (32 hex digits) or `{ seed: null }`. Every game started afterwards uses this seed until it is cleared or the state is reset, so tests and manual checks get a known deal |

### 2.1 Presets and Capability Settings

Each capability is chosen by an environment variable. A preset sets all of them, and any variable set explicitly overrides its preset.

| Variable | Values |
|---|---|
| `ALLPLAY_PRESET` | `local` (default), `local-aws`, `continuous-integration` |
| `ALLPLAY_STORAGE` | `memory` (the deployed stages use DynamoDB since DM-3) |
| `ALLPLAY_LLM` | `claude-code`, `claude-api`, `bedrock`, `fake` |
| `ALLPLAY_SPEECH_IN` | `auto`, `macos`, `whisper`, `transcribe`, `typed` |
| `ALLPLAY_SPEECH_OUT` | `kokoro`, `polly`, `recording` |
| `ALLPLAY_AUTH` | `mock`, `cognito-test` (`authn-authz.md` Section 11) |

| Preset | Storage | Language model | Speech in | Speech out | Auth |
|---|---|---|---|---|---|
| `local` | memory | `claude-code` | `auto` (macOS speech, else whisper.cpp, else typed) | `kokoro` | `mock` |
| `local-aws` | memory | `bedrock` | `transcribe` | `polly` | `mock` |
| `local-aws-auth` | memory | `bedrock` | `transcribe` | `polly` | `cognito-test` |
| `continuous-integration` | memory | `fake` | `typed` | `recording` | `mock` |

`ALLPLAY_CLAUDE_MODEL` overrides the model of Claude Code and the Claude API, and `ALLPLAY_CLAUDE_BIN` the Claude Code executable (`action-decision.md` Section 8).

`local-aws-auth` is `local-aws` with the Test stage's Cognito for sign-in: `npm run dev:aws-auth` at the root writes the git-ignored `web-app/public/config.local.json` override (which `loadConfig` merges over `config.json`) and passes the Test pool to the local server (`authn-authz.md` Section 11). Any other preset removes that override.

`local-aws` (built by `transcribe-polly-bedrock.md`) calls AWS with the `allplays` profile (CLAUDE.md Section 4). `continuous-integration` needs nothing installed beyond Node.js and is what GitHub Actions runs.

## 3. Identity

1. The caller's identity comes from a development header, `x-allplay-dev-caller` (`guest:<id>`, `player:<id>` or `admin:<id>`, `authn-authz.md` Section 11), defaulting to a fixed local guest. The local server writes it into the request context's IAM identity fields, the same fields `resolveCaller` reads in deployed stages, so `resolveCaller` has no local branch.
2. Tier checks (`requireTier`) run unchanged; the header can name a guest, a player or an admin.
3. Only the local server reads the header. A test asserts that deployed handlers ignore it.

## 4. Local Speech and Model Setup

Each provider has a setup script in `backend/`. Built binaries and models live in `backend/.local/`, which git ignores.

| Provider | Setup | Footprint |
|---|---|---|
| macOS speech helper | `npm run setup:speech:macos` compiles `src/local/macos-speech/transcribe.swift` with `swiftc` (Xcode command line tools). The first use asks for speech recognition permission | A small native binary; recognition runs on device |
| whisper.cpp | `npm run setup:speech:whisper` runs `brew install whisper-cpp` and downloads `ggml-base.en.bin` | About 142 MB model, about 300 MB of memory while transcribing |
| Kokoro | `npm run setup:speech:kokoro` creates a Python virtual environment in `backend/.local/kokoro` with `kokoro-onnx` 0.6.1 and downloads `kokoro-v1.0.onnx` and `voices-v1.0.bin` (AD-13). The server keeps one Python worker (`src/local/kokoro/worker.py`) with the model loaded, starts it on the first request or at startup, and warms it at startup. Voice from `ALLPLAY_KOKORO_VOICE`, default `af_heart`. Measured: about 0.3 s for a short reply and 1 to 1.5 s for a long one, warm | About 350 MB of model files |
| Claude Code | Claude Code installed and signed in on the developer's machine; the local server runs `claude -p` (AD-14). Without it the language model is reported unavailable and every turn is `UNRECOGNIZED` | None |
| Claude API (optional, `ALLPLAY_LLM=claude-api`) | `ANTHROPIC_API_KEY` in the developer's shell, or the key alone in `backend/.local/anthropic-api-key` (AD-14). Without a key the language model is reported unavailable and every turn is `UNRECOGNIZED` | None |
| Bedrock, Transcribe and Polly (`local-aws`, `transcribe-polly-bedrock.md`) | `npm run dev:aws` at the repository root, which runs the servers with the `allplays` profile; credentials stay in the developer's `~/.aws`. Bedrock needs the account's inference quotas raised once (`docs/runbooks/bootstrap.md` step 6) | None |

A provider that is not set up is reported by `GET /local/status`, and the server falls back as Section 2.1 states rather than failing to start.

## 5. Web App

1. The web app's `MEMORY` data mode remains the unit test harness. Locally, `web-app/public/config.json` sets `dataMode: LIVE` and points `apiUrl` at the local server, with `speechInput: LOCAL_SERVER` and `speechOutput: LOCAL_SERVER`. The local server `SpeechOutput` caches audio by text and rate, stops a reply when a newer one starts, and speaks with the browser's voice when the server cannot. In `LIVE` mode the game catalog, sessions, decisions and the Voice Lab call the API; preferences, the player, stats and admin stay in memory until their legs (`prototype-mocks.md`). Application actions such as zoom and theme run in the client, so they change the in-memory preferences.
2. The game screen captures speech when `speechInput` is `LOCAL_SERVER`: Space or the Talk button starts recording, shown by a pulsing dot and "Listening" with a moving ellipsis, Space again or Done stops it, and capture stops by itself after 10 seconds. The audio is transcribed by `POST /local/speech/transcribe` and the transcript is sent to `POST /v1/decisions` with its `transcriptSource`. The listening panel's text field stays available, and a typed command is sent as `TYPED`.
3. The Voice Lab page, `/voice-lab`, is the manual test bench for the voice path. It shows each stage of a voice turn: the local server's status and providers, recording, the transcript with its provider and latency, the command sent to `POST /v1/decisions`, the backend's reply, and the backend's recent decisions from `GET /local/decisions`. It also accepts a typed command.
4. `npm run dev` at the repository root (`scripts/dev.mjs`) first stops any All Play local process still running: a local server or Vite whose command line is in this checkout, or anything listening on ports 4000, 5173 or 4173 whose working directory is in it. It then starts the local server and Vite (with `--force`, so a stale dependency cache is rebuilt) from scratch, prefixes their output with `[api]` and `[web]`, and stops both on Ctrl-C or when either exits. `npm run dev -- --dry-run` lists what it would stop.

## 6. Testing on a Developer Machine

1. Local integration tests: `backend/tests/integration/` takes its target from `API_URL`. A local run starts the server with the `continuous-integration` preset, resets it, runs the suite and stops it. GitHub Actions runs this on every push.
2. Audio fixtures: `say -o <file>.wav --data-format=LEI16@16000 "<words>"` produces 16 kHz WAV files of spoken commands. Tests post them to `POST /local/speech/transcribe` to exercise the real speech-to-text implementation end to end.
3. Voice playthrough: `npm run test:voice` in `web-app/` drives the web app in Playwright against a running local stack with the Claude Code language model. It sets the seed of `backend/tests/game-engine/golden/spider-one-suit.json`, then plays the whole game by typing the hard-coded commands in `web-app/tests/voice-playthrough/spider-one-suit.commands.json` into the listening panel, confirming each proposal with Enter or a spoken "yes", and mixing in application commands (zoom and theme). It checks that each turn proposes the expected action, that the game ends `WON`, and through `GET /local/decisions` that every turn was classified by a Claude model. It makes about 130 Claude Code calls, so it runs on demand and never in CI.
4. Claude Code testing: Claude Code can start the local stack and drive the web app on the same machine, through browser automation, computer use or Playwright. Because automation cannot speak into a microphone, it uses typed commands or the audio fixtures. Because it cannot listen, it uses the recording `TextToSpeech` and checks the text that would have been spoken.

## 7. Legs

| Leg | Scope |
|---|---|
| LD-1 | Local server skeleton: event adapter, route table from the route lists, the health route, `GET /local/status`, `POST /local/reset`, `dev:server` script, composition root with Section 2.1 settings |
| LD-2 | Session and game routes on the local server with the in-memory session DAO, path parameters in the local route table, and `POST /local/seed` |
| LD-3 | Local caller identity header written into the IAM identity fields |
| LD-4 | Web app `LIVE` services against the local server, and a root `npm run dev` |
| LD-5 | Local integration test run in GitHub Actions with the `continuous-integration` preset |
| LD-6 | Fakes for sign-in (`authn-authz.md` AA-11) and deployments as those features land |
| LD-7 | Game screen microphone capture through the local server, and the voice playthrough test (Section 6) |

The voice legs (AD-10 to AD-15) are listed in `action-decision.md` Section 15. The first build order is LD-1, LD-3, AD-12, AD-10, then AD-11: speech to text, shown in the Voice Lab, reaching the backend as text.

## Appendix: Implementation Progress

Status as of 2026-11-20.

- LD-1 is done: `npm run dev:server` in `backend/` starts the local server on port 4000, with presets, `/local/status`, `/local/reset`, `/local/decisions` and `/local/speech/transcribe`.
- LD-3 is done: the `x-allplay-dev-caller` header is written into the IAM identity field.
- `npm run setup:speech:macos` and `npm run setup:speech:whisper` work on this machine.
- `web-app/public/config.json` points at the local server, and the Voice Lab is at `http://localhost:5173/voice-lab`.
- LD-2 is done: game and session routes through the `game` bundle, `POST /local/seed`, and an in-memory SeatAssignment for the current session.
- LD-4 is done: `dataMode: LIVE` uses the local server for games, sessions and decisions, and `npm run dev` at the root restarts the whole local stack.
- LD-7 is done: Space records on the game screen and the local server transcribes; `npm run test:voice` in `web-app/` won the seeded one-suit game through Claude Code (116 commands, 8.6 minutes, run against a `vite preview` build on port 4173 with `ALLPLAY_WEB_ORIGIN=http://localhost:4173` and `VOICE_BASE_URL=http://localhost:4173`).
- The playthrough found three decider weaknesses, fixed in the prompts and candidates (`action-decision.md` Sections 5 and 6): number words as columns, dealing phrases classified as unrecognized, and units of different depth to an empty column.
- AD-13 is done: spoken replies use Kokoro through the local server when voice output is on.
- LD-6 is covered for sign-in by AA-11 (the development callers) and for deployments by the in-memory pipeline behind the admin routes (AA-8).
- Open: LD-5 (local integration tests in CI).
