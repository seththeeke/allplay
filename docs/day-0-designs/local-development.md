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
| `POST /local/speech/synthesize` | `{ text, rate }` in, audio out (AD-13) |
| `GET /local/decisions` | The most recent decisions recorded by the backend, newest first, for the Voice Lab |
| `POST /local/reset` | Clears all in-memory state, for tests |

### 2.1 Presets and Capability Settings

Each capability is chosen by an environment variable. A preset sets all of them, and any variable set explicitly overrides its preset.

| Variable | Values |
|---|---|
| `ALLPLAY_PRESET` | `local` (default), `local-aws`, `continuous-integration` |
| `ALLPLAY_STORAGE` | `memory` (DynamoDB arrives with DM-3) |
| `ALLPLAY_LLM` | `claude-api`, `bedrock`, `fake` |
| `ALLPLAY_SPEECH_IN` | `auto`, `macos`, `whisper`, `transcribe`, `typed` |
| `ALLPLAY_SPEECH_OUT` | `kokoro`, `polly`, `recording` |

| Preset | Storage | Language model | Speech in | Speech out |
|---|---|---|---|---|
| `local` | memory | `claude-api` | `auto` (macOS speech, else whisper.cpp, else typed) | `kokoro` |
| `local-aws` | memory | `bedrock` | `transcribe` | `polly` |
| `continuous-integration` | memory | `fake` | `typed` | `recording` |

`local-aws` calls AWS with the `allplays` profile (CLAUDE.md Section 4). `continuous-integration` needs nothing installed beyond Node.js and is what GitHub Actions runs.

## 3. Identity

1. The caller's identity comes from a development header, `x-allplay-dev-caller`, defaulting to a fixed local guest. The local server writes it into the request context's IAM identity fields, the same fields `resolveCaller` reads in deployed stages, so `resolveCaller` has no local branch.
2. Tier checks (`requireTier`) run unchanged; the header can name a guest, a player or an admin.
3. Only the local server reads the header. A test asserts that deployed handlers ignore it.

## 4. Local Speech and Model Setup

Each provider has a setup script in `backend/`. Built binaries and models live in `backend/.local/`, which git ignores.

| Provider | Setup | Footprint |
|---|---|---|
| macOS speech helper | `npm run setup:speech:macos` compiles `src/local/macos-speech/transcribe.swift` with `swiftc` (Xcode command line tools). The first use asks for speech recognition permission | A small native binary; recognition runs on device |
| whisper.cpp | `npm run setup:speech:whisper` runs `brew install whisper-cpp` and downloads `ggml-base.en.bin` | About 142 MB model, about 300 MB of memory while transcribing |
| Kokoro | `npm run setup:speech:kokoro` creates a Python virtual environment in `backend/.local/kokoro` with `kokoro-onnx` and downloads the model (AD-13) | About 300 MB of model files |
| Claude API | `ANTHROPIC_API_KEY` in the developer's shell (AD-14) | None |

A provider that is not set up is reported by `GET /local/status`, and the server falls back as Section 2.1 states rather than failing to start.

## 5. Web App

1. The web app's `MEMORY` data mode remains the unit test harness. Locally, `web-app/public/config.json` points `apiUrl` at the local server, with `speechInput: LOCAL_SERVER` and `speechOutput: LOCAL_SERVER`.
2. The Voice Lab page, `/voice-lab`, is the manual test bench for the voice path. It shows each stage of a voice turn: the local server's status and providers, recording, the transcript with its provider and latency, the command sent to `POST /v1/decisions`, the backend's reply, and the backend's recent decisions from `GET /local/decisions`. It also accepts a typed command.
3. `npm run dev` at the repository root starts the local server and Vite together.

## 6. Testing on a Developer Machine

1. Local integration tests: `backend/tests/integration/` takes its target from `API_URL`. A local run starts the server with the `continuous-integration` preset, resets it, runs the suite and stops it. GitHub Actions runs this on every push.
2. Audio fixtures: `say -o <file>.wav --data-format=LEI16@16000 "<words>"` produces 16 kHz WAV files of spoken commands. Tests post them to `POST /local/speech/transcribe` to exercise the real speech-to-text implementation end to end.
3. Claude Code testing: Claude Code can start the local stack and drive the web app on the same machine, through browser automation, computer use or Playwright. Because automation cannot speak into a microphone, it uses typed commands or the audio fixtures. Because it cannot listen, it uses the recording `TextToSpeech` and checks the text that would have been spoken.

## 7. Legs

| Leg | Scope |
|---|---|
| LD-1 | Local server skeleton: event adapter, route table from the route lists, the health route, `GET /local/status`, `POST /local/reset`, `dev:server` script, composition root with Section 2.1 settings |
| LD-2 | Session and game routes on the local server with the in-memory session DAO |
| LD-3 | Local caller identity header written into the IAM identity fields |
| LD-4 | Web app `LIVE` services against the local server, and a root `npm run dev` |
| LD-5 | Local integration test run in GitHub Actions with the `continuous-integration` preset |
| LD-6 | Fakes for sign-in and deployments as those features land |

The voice legs (AD-10 to AD-15) are listed in `action-decision.md` Section 15. The first build order is LD-1, LD-3, AD-12, AD-10, then AD-11: speech to text, shown in the Voice Lab, reaching the backend as text.
