# Transcribe, Polly and Bedrock

Status: Day 0 design, 2026-11-20.

The local stack (`local-development.md`) runs the whole game by voice with on-machine providers: Claude Code decides, macOS speech or whisper.cpp transcribes, and Kokoro speaks. This spec adds three AWS implementations of the same provider interfaces, Amazon Bedrock, Amazon Transcribe and Amazon Polly. They are selected by the existing `local-aws` preset, so the whole system still runs in memory on a developer's machine and only these three capabilities call AWS.

The work is a swap. It adds three implementation files and fills in three branches of the local composition root that already exist and today report "arrives with AD-15". No service, controller, prompt, route, model, DAO or web app file changes. That is the proof that the local solution is extensible: each AWS service plugs into an interface that a local implementation has already exercised end to end.

Related specs: `action-decision.md` (Sections 8, 13 and 16, legs AD-1 and AD-15), `local-development.md` (Sections 2.1 and 4), `cdk-stacks.md` (deployed grants, built later).

## 1. Scope

In scope:

1. A Bedrock Converse `LlmClient`.
2. A Transcribe `SpeechToText` that transcribes the uploaded WAV on the local server.
3. A Polly `TextToSpeech` that returns WAV from the local server.
4. Composition root branches, settings and one root script that start the `local-aws` stack.

Out of scope, and unchanged by this spec:

1. Storage. It stays in memory (`ALLPLAY_STORAGE=memory`); DynamoDB arrives with DM-3 and DM-4.
2. Deployed stages. The deployed web client keeps its own design: Transcribe streaming and Polly called from the browser with Identity Pool credentials (`action-decision.md` Sections 3.1 and 13, AD-9). The Bedrock `LlmClient` built here is the one the deployed decision Lambda will use (CDK-9); the Transcribe and Polly implementations here are local-server implementations only.
3. Authentication, Identity Pool, IAM roles for Lambdas, and the Transcribe custom vocabulary resource (AD-6).

## 2. The Extension Points

Three interfaces carry every external capability (`action-decision.md` Section 16). Each one already has local implementations that pass its tests.

| Interface | File | Contract | Existing implementations | Added here |
|---|---|---|---|---|
| `LlmClient` | `backend/src/service/decision/llm/llmClient.ts` | `invoke({ system, user, tool, maxTokens })` returns the forced tool's input, unvalidated, with `modelId`, `latencyMs`, `inputTokens`, `outputTokens`; `status()`; failures throw `LlmUnavailableError` | Claude Code, Claude API, fake | Bedrock Converse |
| `SpeechToText` | `backend/src/service/speech/speechToText.ts` | `transcribe(wav)` returns `{ text }` for 16 kHz mono 16-bit WAV; `transcriptSource`; `status()`; failures throw `SpeechUnavailableError` | macOS speech, whisper.cpp, typed only | Transcribe |
| `TextToSpeech` | `backend/src/service/speech/textToSpeech.ts` | `synthesize(text, rate)` returns WAV bytes; `status()`; failures throw `SpeechOutputUnavailableError` | Kokoro, recording | Polly |

The composition root, `backend/src/local/providers.ts`, is the only file that constructs providers. It has one selection function per capability, and each already has a branch for the AWS setting:

| Function | Setting | Branch today | Branch after this spec |
|---|---|---|---|
| `languageModel` | `ALLPLAY_LLM=bedrock` | `createUnavailableLlm("bedrock", ...)` | `createBedrockLlm(...)` |
| `speechCandidates` | `ALLPLAY_SPEECH_IN=transcribe` | `createTypedOnly("Server-side Transcribe arrives with AD-15.")` | `[createTranscribe(...)]` |
| `speechOutput` | `ALLPLAY_SPEECH_OUT=polly` | `createUnavailableTts("polly", ...)` | `createPolly(...)` |

The `local-aws` preset in `backend/src/local/settings.ts` already selects `bedrock`, `transcribe` and `polly` with in-memory storage. It does not change.

## 3. What Does Not Change

These consume the interfaces and are untouched:

| Layer | Files | Why it needs no change |
|---|---|---|
| Decider | `service/decision/decisionService.ts`, `classifier.ts`, `gameSelector.ts`, `appSelector.ts`, `outcomes.ts` | They call `LlmClient.invoke` and validate the returned tool input with zod, whatever produced it |
| Prompts | `service/decision/prompts/` | The system blocks, user message and tool JSON Schema are provider-neutral; each `LlmClient` maps them to its own API |
| Local server | `local/server.ts` | `POST /local/speech/transcribe` calls `SpeechToText.transcribe`; `POST /local/speech/synthesize` calls `TextToSpeech.synthesize`; `GET /local/status` reports each provider's `status()` |
| Controllers and session service | `controller/web-api/`, `service/gameSession/` | They never see a provider |
| Web app | `web-app/src/` | The local-server `SpeechInput` uploads WAV and the local-server `SpeechOutput` plays WAV. Both are unaware of which provider the server uses, so `web-app/public/config.json` keeps `speechInput: LOCAL_SERVER` and `speechOutput: LOCAL_SERVER` |
| Voice playthrough | `web-app/tests/voice-playthrough/` | It accepts any Claude or Bedrock decider; Section 8 states its use here |

## 4. Bedrock Converse `LlmClient`

File: `backend/src/service/decision/llm/bedrockConverse.ts`, exporting `createBedrockLlm(options, client?)`. The optional client is the injected Bedrock Runtime client, so the implementation is testable without AWS.

### 4.1 Plug-In Point

`languageModel` in `providers.ts`:

| Setting | Implementation |
|---|---|
| `ALLPLAY_LLM=bedrock` (the `local-aws` preset) | `createBedrockLlm({ modelId, region, timeoutMs })` |

### 4.2 Behavior

1. It calls Bedrock Runtime `Converse` through `@aws-sdk/client-bedrock-runtime` in region `us-east-1`.
2. The request maps the `LlmRequest` one field at a time:

| `LlmRequest` | Converse request |
|---|---|
| `system` blocks | `system: [{ text }, ...]` followed by `{ cachePoint: { type: "default" } }` after the last block |
| `user` | `messages: [{ role: "user", content: [{ text: user }] }]` |
| `tool` | `toolConfig.tools: [{ toolSpec: { name, description, inputSchema: { json: inputSchema } } }]` |
| Forced tool | `toolConfig.toolChoice: { tool: { name } }` |
| `maxTokens` | `inferenceConfig: { maxTokens, temperature: 0 }` |

3. The tool input is the `toolUse.input` of the first `toolUse` content block naming the layer's tool. `modelId` is the configured model id, `latencyMs` is `metrics.latencyMs`, and token counts come from `usage.inputTokens` and `usage.outputTokens`, including cache reads and writes.
4. Timeout is 2,500 ms per call with one retry on throttling or a 5xx response after a 100 ms jittered backoff, as `action-decision.md` Section 8 states. A timeout, an AWS error, missing credentials, or a response without the tool call throws `LlmUnavailableError`. The decider already turns that into an `UNRECOGNIZED` turn that says it cannot understand commands right now.
5. `status()` reports available when AWS credentials resolve, with the detail "Bedrock, model <modelId>". It makes no model call, so starting the server costs nothing.

### 4.3 Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ALLPLAY_BEDROCK_MODEL` | `us.amazon.nova-2-lite-v1:0` | Model or inference profile id (`action-decision.md` Section 8) |
| `ALLPLAY_AWS_REGION` | `us-east-1` | Region of all three clients |

A model change is a configuration change only. Claude Haiku 5.5 on Bedrock is `ALLPLAY_BEDROCK_MODEL` set to its inference profile id, with no code change.

## 5. Transcribe `SpeechToText`

File: `backend/src/service/speech/transcribe.ts`, exporting `createTranscribe(options, client?)`.

### 5.1 Plug-In Point

`speechCandidates` in `providers.ts`:

| Setting | Implementation |
|---|---|
| `ALLPLAY_SPEECH_IN=transcribe` (the `local-aws` preset) | `[createTranscribe({ region, vocabularyName })]` |

`auto` keeps its local order (macOS speech, then whisper.cpp). Transcribe runs only when it is chosen.

### 5.2 Behavior

1. `transcriptSource` is `TRANSCRIBE` and `name` is `transcribe`.
2. Batch Transcribe needs the audio in S3, so the local server uses Transcribe streaming (`StartStreamTranscription` through `@aws-sdk/client-transcribe-streaming`). This matches the deployed client's service and settings.
3. The WAV header is checked (16 kHz, mono, 16-bit PCM) and removed. The PCM is sent as an audio stream in chunks of 100 ms (3,200 bytes), with `LanguageCode: en-US`, `MediaEncoding: pcm`, `MediaSampleRateHertz: 16000` and `EnablePartialResultsStabilization` with stability `high`.
4. The transcript is the concatenation of the final (non-partial) result segments, trimmed. Silence gives an empty transcript, which the client already handles ("I didn't hear anything").
5. `ALLPLAY_TRANSCRIBE_VOCABULARY` names a custom vocabulary when set. It is unset by default, because the stage vocabulary is created by AD-6.
6. Errors, timeouts (10,000 ms for a clip of at most 10 seconds) and missing credentials throw `SpeechUnavailableError`. The local server already answers that with 503 and the client's message.
7. `status()` reports available when credentials resolve, with the detail "Amazon Transcribe streaming, en-US".

## 6. Polly `TextToSpeech`

File: `backend/src/service/speech/polly.ts`, exporting `createPolly(options, client?)`.

### 6.1 Plug-In Point

`speechOutput` in `providers.ts`:

| Setting | Implementation |
|---|---|
| `ALLPLAY_SPEECH_OUT=polly` (the `local-aws` preset) | `createPolly({ region, voiceId })` |

### 6.2 Behavior

1. It calls `SynthesizeSpeech` through `@aws-sdk/client-polly` with `Engine: generative`, `OutputFormat: pcm`, `SampleRate: "16000"` and `TextType: ssml`.
2. The text is escaped for XML and wrapped as `<speak><prosody rate="NN%">text</prosody></speak>`, where `NN` is `rate` times 100, rounded. This is the player's `speechRate`, as `action-decision.md` Section 13 states for the deployed client.
3. Polly returns raw 16-bit PCM. The implementation prepends a 44-byte WAV header, using the WAV writer that already produces `silentWav`, generalized to take samples. The result is WAV, so `POST /local/speech/synthesize`, its `audio/wav` content type and the web player are unchanged.
4. Errors, timeouts (5,000 ms) and missing credentials throw `SpeechOutputUnavailableError`. The local server answers 503, and the web `SpeechOutput` falls back to the browser voice, as it already does for Kokoro.
5. `status()` reports available when credentials resolve, with the detail "Amazon Polly generative, voice <voiceId>". The Kokoro warm-up at startup applies only to Kokoro; Polly needs none.

### 6.3 Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ALLPLAY_POLLY_VOICE` | `Ruth` | Polly generative voice, the default of the `voiceId` preference (`data-model.md` Section 5) |

## 7. Credentials, Startup and Cost

### 7.1 Credentials

1. The three clients use the AWS SDK default credential chain with no keys in code or configuration. The developer's `allplays` profile supplies them, through `AWS_PROFILE=allplays` as CLAUDE.md Section 4 requires. No other profile is used.
2. The profile needs `bedrock:InvokeModel` on the configured model, `transcribe:StartStreamTranscription`, and `polly:SynthesizeSpeech`. These calls create no AWS resources, so the deploy safety gate does not apply to them.
3. Bedrock model access for the configured model is enabled once in the `us-east-1` console when the account requires it. `docs/runbooks/bootstrap.md` records the step.

### 7.2 Startup

| Command | Effect |
|---|---|
| `npm run dev:aws` at the repository root | Runs `scripts/dev.mjs` with `ALLPLAY_PRESET=local-aws` and `AWS_PROFILE=allplays`. It stops running All Play processes and starts the local server and Vite, exactly as `npm run dev` does |
| `ALLPLAY_PRESET=local-aws AWS_PROFILE=allplays npm run dev:server` in `backend/` | The local server alone with the AWS providers |

`GET /local/status` and the Voice Lab show `bedrock`, `transcribe` and `polly` as the providers, each with its availability. The capabilities stay independent, so any mix runs: for example `ALLPLAY_LLM=bedrock` with macOS speech and Kokoro, or Claude Code with Transcribe and Polly.

### 7.3 Cost

Per voice turn with Nova Micro: under $0.0002 for Bedrock (`action-decision.md` Section 10). Transcribe streaming bills a 15 second minimum, about $0.006 per spoken command; typed commands skip Transcribe. Polly generative bills by characters, about $0.004 for a 120-character reply. A full voice playthrough of the one-suit game costs under one dollar. The existing AWS Budgets alarm covers this spend.

## 8. Acceptance

The goal is met when, with `npm run dev:aws` and no code changed outside Sections 4 to 7:

1. `GET /local/status` reports `bedrock`, `transcribe` and `polly` available.
2. In the Voice Lab, a spoken command is transcribed with source `TRANSCRIBE`, and the backend reply is recorded with a Bedrock `modelId`.
3. On the game screen, a spoken move is proposed and confirmed, and the reply is heard in the Polly voice.
4. The voice playthrough (`npm run test:voice` in `web-app/`) wins the seeded one-suit game with the Bedrock decider. If Nova Micro does not win it, the model id changes to the strongest Bedrock model that does, with a note in `action-decision.md` Section 8. The prompts change only if no Bedrock model wins, and then the fix is checked against the Claude Code decider as well.

Each leg ships with unit tests at the coverage CLAUDE.md requires. AWS clients are injected and stubbed, so the tests make no AWS calls.

## 9. Legs

| Leg | Scope | Completes |
|---|---|---|
| TPB-1 | `bedrockConverse.ts`, the `languageModel` branch, `ALLPLAY_BEDROCK_MODEL` and `ALLPLAY_AWS_REGION` | AD-1 (Bedrock implementation) |
| TPB-2 | `transcribe.ts`, the `speechCandidates` branch, `ALLPLAY_TRANSCRIBE_VOCABULARY` | AD-15 (Transcribe) |
| TPB-3 | `polly.ts`, the generalized WAV writer, the `speechOutput` branch, `ALLPLAY_POLLY_VOICE` | AD-15 (Polly) |
| TPB-4 | Root `npm run dev:aws`, the model access step in `docs/runbooks/bootstrap.md`, and the `local-development.md` setup table | LD presets |
| TPB-5 | Acceptance run of Section 8, the Bedrock model decision, and progress notes in this spec, `action-decision.md` and `local-development.md` | |

Order: TPB-1, then TPB-2 and TPB-3, then TPB-4 and TPB-5. Each leg is one commit and each is verified by hand in the Voice Lab before the next starts.

## Appendix: Implementation Progress

Status as of 2026-11-20.

| Leg | Status | Notes |
|---|---|---|
| TPB-1 | Done | `bedrockConverse.ts`. Calls authenticate and reach Nova Micro, but the account's Bedrock inference quotas are applied at 0, so every call is throttled until AWS Support raises them (`docs/runbooks/bootstrap.md` step 6). The decider degrades as designed: an `UNRECOGNIZED` turn that says why |
| TPB-2 | Done | `transcribe.ts` and the shared `wav.ts`. A spoken "move three over to seven" transcribes to "Move 3 over to 7." in about 0.7 s |
| TPB-3 | Done | `polly.ts`. A long reply synthesizes in about 0.3 s; Polly's WAV transcribed back through Transcribe returns the original sentence |
| TPB-4 | Done | `npm run dev:aws`; the runbook step for Bedrock quotas |
| TPB-5 | Done | The owner played a deployed voice game with Transcribe, Bedrock and Polly (2026-11-28). Earlier: `GET /local/status` reports all three AWS providers available. A mixed setup (`local-aws` with `ALLPLAY_LLM=claude-code`) took a spoken clip through Transcribe, proposed the right move, and spoke the reply with Polly. The voice playthrough and the Nova Micro decision follow once Bedrock calls are allowed |

The only files changed outside Sections 4 to 7 were their tests, and two local server tests that had asserted the old "arrives with AD-15" placeholders.
