# Action Decision Engine

Status: Day 0 design, 2026-11-17.

The action decider turns a player's spoken request into one deterministic action. It owns speech capture contracts, transcription, the two-layer LLM decision, verification against the game engine, the confirmation flow, and the turn records that feed the turn failure metric. It never changes game state itself: game actions are applied only through the game session service (`game-engine.md` Section 11).

Related specs: `game-engine.md` (legal actions), `data-model.md` (`Decision`, `RateLimitCounter`, `MetricRollup`), `authn-authz.md` (Identity Pool credentials), `spider-solitaire.md` (decider guidance).

## 1. Principles

1. The LLM selects; the engine executes. The LLM only ever chooses from a numbered list of candidates the server built. Its output is validated, and anything outside the list is discarded.
2. At most two LLM calls per turn: layer 1 classifies, layer 2 selects.
3. The decider's input is transcript text. Deployed, the web client transcribes with Amazon Transcribe and the iOS client on-device with Apple's Speech framework; locally, the local server transcribes (Section 3.4). Every source calls the same API.
4. Every turn is recorded (`Decision`, 30 day TTL). Audio is never stored or sent to the backend.
5. The transcript is untrusted input. It is placed in the prompt as quoted data, and because the model can only return candidate numbers, a transcript cannot cause any action outside the legal set.
6. Every external capability sits behind an interface (Section 16): the language model, speech to text and text to speech. Business logic never names a vendor. Each runtime chooses implementations in one composition root, and each capability is chosen independently, so any mix (for example in-memory storage with Bedrock, Transcribe and Polly) runs the same logic.

## 2. Turn Flow

```
Player presses Space (or the on-screen Talk button)
  -> client streams microphone audio to Amazon Transcribe (web) or Apple Speech (iOS)
  -> listening ends: silence timeout, Space pressed again, or 10 second cap
  -> client POST /v1/decisions { transcript, context }
       server, in parallel:
         a. layer 1 classify (Bedrock)
         b. load session, compute legal actions and view, load preferences
       -> category GAME: layer 2 game selection (Bedrock) -> validate with engine
       -> category APPLICATION: layer 2 application selection (Bedrock)
       -> category RESPONSE: resolve the pending prompt (no layer 2)
       -> category UNRECOGNIZED: reply with a retry prompt
  <- response: proposal, choices, auto-applied result, application action, or retry prompt
  -> client shows the proposal (and speaks it when voice output is on)
  -> player confirms (Enter or "yes"), cancels (Escape or "no"), or picks a choice ("one", "two")
  -> client POST /v1/decisions/{decisionId}/resolution
```

## 3. Speech Capture

### 3.1 Web (Amazon Transcribe Streaming)

1. The client obtains AWS credentials from the Cognito Identity Pool through Amplify (guest or signed in). The Identity Pool roles allow `transcribe:StartStreamTranscriptionWebSocket` only.
2. On Space, the client opens a Transcribe streaming WebSocket (`en-US`, PCM 16 kHz mono, partial results stabilization `high`, the stage's custom vocabulary). Credentials and microphone permission are obtained when the game screen loads, and audio captured between the key press and the socket opening is buffered and sent first, so the first word is never lost. No socket is held open while idle, because Transcribe bills streamed audio.
3. Partial transcripts are shown live in the listening banner. While the microphone is open, the banner shows a pulsing dot and "Listening" with a moving ellipsis, so it is always clear whether the app is listening; with reduced motion both hold still.
4. Listening ends on the first of:
   - silence for `listenTimeoutMs` (preference, default 1200 ms) after at least one final transcript segment;
   - the player pressing Space again;
   - 10 seconds of capture.
5. The final transcript is the concatenation of final segments. Up to two alternatives with confidence scores are sent along.
6. An empty transcript produces no API call; the client shows "I didn't hear anything" and returns to idle.

Custom vocabulary: one Transcribe custom vocabulary per stage, `allplay-vocabulary-<stage>`, containing the union of every core game's vocabulary (`spider-solitaire.md` Section 3) and the application command words (zoom, theme, contrast, undo, hint, confirm). It is created by a CDK custom resource, since CloudFormation has no Transcribe vocabulary resource.

### 3.2 iOS (Apple Speech)

The iOS client uses `SFSpeechRecognizer` with on-device recognition required, `contextualStrings` set from the same vocabulary list, and the same three end conditions. It sends `transcriptSource: "APPLE_SPEECH"`.

### 3.3 Keys

| Key | Idle | Listening | Proposal or choices shown |
|---|---|---|---|
| Space | Start listening | Stop listening | Start listening (a spoken "yes", "no" or number answers the prompt) |
| Enter | | | Confirm the proposal |
| Escape | | Cancel listening | Cancel the proposal |
| 1 to 4 | | | Pick a numbered choice |

On touch devices, a large Talk button replaces Space, and Confirm, Cancel and each choice are large buttons.

### 3.4 Local Speech to Text

Locally (`local-development.md`), the web client does not call Transcribe. It captures the same 16 kHz mono PCM audio, encodes it as WAV when listening ends, and posts it to the local server's `POST /local/speech/transcribe`. The server passes it to its `SpeechToText` implementation (Section 16) and returns the transcript. The client then sends the transcript to `POST /v1/decisions` exactly as in Section 2. Audio is held in memory for the one request and never stored.

| `SpeechToText` implementation | Where | `transcriptSource` |
|---|---|---|
| macOS speech: a Swift helper (`backend/src/local/macos-speech/`) using Apple's `SFSpeechRecognizer` with on-device recognition and the vocabulary as contextual strings | Local, macOS | `MACOS_SPEECH` |
| whisper.cpp: the `whisper-cli` binary with the `ggml-base.en` model | Local, any OS | `WHISPER` |
| Amazon Transcribe called from the local server with the developer's AWS profile | Local `local-aws` preset | `TRANSCRIBE` |
| Typed: the listening panel's text field, no audio | Any, including tests | `TYPED` |

The local server's `auto` choice uses macOS speech when the helper is built, else whisper.cpp when its binary and model are present, else typed input only.

## 4. Decision API

Routes are on the All Play HTTP API with IAM authorization (`authn-authz.md` Section 4).

### 4.1 POST /v1/decisions

Request:

```json
{
  "transcript": "move the seven of spades onto the eight",
  "alternatives": [{ "transcript": "move the seven of spades on to the eight", "confidence": 0.81 }],
  "transcriptSource": "TRANSCRIBE",
  "context": {
    "screen": "GAME",
    "sessionId": "01JEX4Q8N6W2D3K5T7V9B1C3E5",
    "expectedVersion": 37,
    "pendingDecisionId": null
  }
}
```

`screen` is `HOME`, `GAME`, `STATS`, `SETTINGS` or `HELP`. `pendingDecisionId` is set when a proposal or choice list is on screen.

Response (one of the outcomes below):

```json
{
  "decisionId": "01JEX5B2R4T6Y8U0I2O4P6A8S0",
  "outcome": "CHOICES",
  "displayText": "There are two eights. Say 1 for column 2 or 2 for column 9.",
  "speech": "There are two eights. Say one for column two, or two for column nine.",
  "proposal": null,
  "choices": [
    { "number": 1, "actionId": "MOVE_UNIT|from=tableau.4|depth=1|to=tableau.2", "text": "Seven of spades from column 4 to column 2" },
    { "number": 2, "actionId": "MOVE_UNIT|from=tableau.4|depth=1|to=tableau.9", "text": "Seven of spades from column 4 to column 9" }
  ],
  "appAction": null,
  "session": null
}
```

| Outcome | Meaning | Client behavior |
|---|---|---|
| `PROPOSED` | One game action selected; confirmation required | Highlight cards and target, show banner, await Enter / Escape / speech |
| `CHOICES` | 2 to 4 game actions match | Show numbered choices |
| `AUTO_APPLIED` | One action selected with high confidence and the player has `autoConfirm` on; already applied | Render `session` (the new envelope) and its events |
| `APP_ACTION` | An application action selected | Execute it locally (Section 7); destructive ones show a confirmation first |
| `RESOLVED` | The transcript answered a pending prompt; any resulting game action is applied | Render `session` when present |
| `UNRECOGNIZED` | Nothing matched | Show and speak the retry prompt |

### 4.2 POST /v1/decisions/{decisionId}/resolution

The client sends exactly one resolution per decision it received, except for `RESOLVED` and `UNRECOGNIZED` decisions, which the server finalizes itself.

```json
{
  "resolution": "CONFIRMED",
  "optionNumber": null,
  "expectedVersion": 37,
  "clientLatencyMs": 1615
}
```

| Resolution | Valid for | Server behavior |
|---|---|---|
| `CONFIRMED` | `PROPOSED`, `APP_ACTION` | For a game action, applies it through the game session service and returns the envelope |
| `CHOSE_OPTION` | `CHOICES` | Applies the chosen action and returns the envelope |
| `REJECTED` | `PROPOSED`, `CHOICES`, `APP_ACTION` | Records the rejection |
| `ACKNOWLEDGED` | `AUTO_APPLIED`, `APP_ACTION` that needed no confirmation | Records client latency only |

`clientLatencyMs` is the time from the end of capture to the proposal (or applied result) being displayed. It is the "round trip for a move request" key metric.

A resolution for a game action whose session version has moved on returns `409 VERSION_CONFLICT` with the current envelope, and the decision is recorded as `EXPIRED`.

Open decisions: a `PROPOSED`, `CHOICES` or `APP_ACTION` decision keeps what was shown in its `proposal` field (`data-model.md` Section 9): the kind, the candidate action ids in choice order, and the application action. A resolution or a `RESPONSE` turn reads the decision through the `DecisionDao`, accepts it only from the player who owns it and only while its outcome is still open, and writes the final outcome and failure class back. A resolution for an unknown decision returns `404 NOT_FOUND`; one for a decision that is already final returns `422 VALIDATION_ERROR`.

## 5. Layer 1: Classification

Purpose: decide what kind of request the transcript is.

Categories offered to the model depend on context:

| Category | Offered when |
|---|---|
| `GAME` | `screen` is `GAME` |
| `APPLICATION` | Always |
| `RESPONSE` | `pendingDecisionId` is set |
| `UNRECOGNIZED` | Always |

Prompt structure (Bedrock Converse):

1. System prompt (static per stage, cached with a `cachePoint`): the role, each category's definition with examples, the list of application action names with one-line descriptions, the rule that a plausible game command is `GAME` rather than `UNRECOGNIZED` whenever `GAME` is offered (layer 2 still returns nothing when no move fits), and the output contract.
2. User message: the transcript and alternatives inside `<transcript>` tags, the offered categories, and when a prompt is pending, its kind (`CONFIRMATION` or `CHOICES`) and number of choices.
3. Tool `classify`, which the model is required to call (`toolChoice: { tool: { name: "classify" } }`):

```json
{
  "category": "GAME | APPLICATION | RESPONSE | UNRECOGNIZED",
  "response": "CONFIRM | REJECT | OPTION | null",
  "optionNumber": "integer 1-4 or null"
}
```

A `RESPONSE` classification is resolved directly: `CONFIRM` and `OPTION` apply the pending action; `REJECT` records the rejection. When a pending prompt exists and layer 1 returns `GAME` or `APPLICATION`, the pending decision is recorded as `EXPIRED` (the player moved on) and the new request proceeds.

## 6. Layer 2: Game Selection

Purpose: choose which legal game action the player means.

Candidates are built by the game session service from the session state loaded in parallel with layer 1:

1. Every legal action from the engine, with equivalence groups collapsed to their first member (`game-engine.md` Section 9.3).
2. Meta actions `UNDO` (when available) and `HINT`.

Each candidate is one numbered line with its engine text and short text. A move of more than one card ends with the card count, for example "(3 cards)", so units of different depth between the same zones can be told apart:

```
1 | UNDO | undo the last move
2 | HINT | show a hint
3 | column 4 to column 2 | Move seven of spades from column 4 to column 2 (onto eight of hearts)
4 | column 4 to column 9 | Move seven of spades from column 4 to column 9 (onto eight of clubs)
5 | column 6 to empty column 5 | Move king of spades from column 6 to empty column 5
...
12 | deal | Deal a new row of cards
```

Prompt structure:

1. System prompt (static, cached): the role, the selection rules (choose only listed numbers; return several numbers only when the request genuinely fits several; a bare number word names a place, such as a column, and names a card only with "the" before it or a suit after it, and the card reading is tried only when the place reading matches nothing; return none when no reading fits; never guess a column the player did not imply), and the output contract.
2. Second system block (static per game and rules version, cached): the game's `speech.deciderGuidance`.
3. User message: a board summary (each zone's label and its face-up cards in plain words, face-down cards as a count), the numbered candidates, and the transcript inside `<transcript>` tags.
4. Tool `select_actions`, required:

```json
{
  "selected": "array of 0 to 4 candidate numbers",
  "confidence": "HIGH | LOW",
  "requested": "with no selection, the move the player asked for in a few words, else null"
}
```

Post-processing:

1. Numbers not in the list are discarded.
2. Each selected action is verified with `validateAction` against the session at `expectedVersion`. Any that fail are discarded and counted as `INVALID`; if none remain, the outcome is `UNRECOGNIZED` with `outcome` recorded as `INVALID`.
3. One action remains: `PROPOSED`, or `AUTO_APPLIED` when the player's `autoConfirm` is on and `confidence` is `HIGH`. `HINT` is proposed like a move: the engine's hint action becomes the `PROPOSED` action, highlighted on the board, with the text "Hint: <move>. Confirm to make this move." and made on confirmation. With no move left, the outcome is `RESOLVED` with "There are no moves left. Try undo or a new game." `UNDO` follows the same confirmation rule as moves. The meta candidates use the action ids `UNDO` and `HINT`.

Preferences: the decider reads `autoConfirm` through a preference reader. Until the Preference DAO exists (DM-1), the reader returns the defaults of `data-model.md` Section 5, so `autoConfirm` is off and every single match is `PROPOSED`.
4. Two to four remain: `CHOICES`.
5. Zero remain and the model described the move it understood (`requested`): `UNRECOGNIZED` with "That move is not allowed right now: <requested>. Say hint if you'd like a suggestion." The description is shown and spoken only, never acted on, and is cut to plain words of at most 100 characters.
6. Zero remain with no description, or the model returned more than four: `UNRECOGNIZED` with "I'm not sure which move you mean. Try naming the column numbers, like three to seven, or say hint for a suggestion."

## 7. Layer 2: Application Selection

Purpose: choose an application action. Application actions run in the client; the server only selects them.

| Action | Parameters | Confirmation |
|---|---|---|
| `ZOOM_IN`, `ZOOM_OUT`, `ZOOM_RESET` | | Never |
| `SET_THEME` | `theme`: `DEFAULT`, `HIGH_CONTRAST`, `BLACK_AND_WHITE`, `FOUR_COLOR`, `DARK` | Never |
| `SET_VOICE_OUTPUT` | `enabled` | Never |
| `SET_AUTO_CONFIRM` | `enabled` | Never |
| `REPEAT` | | Never (re-speaks the last prompt) |
| `SHOW_HELP`, `SHOW_STATS`, `SHOW_SETTINGS`, `GO_HOME` | | Never |
| `OPEN_GAME` | `gameId` | Never |
| `NEW_GAME` | `gameId`, `options` (for example "new two suit game") | Always |
| `SIGN_IN`, `SIGN_OUT` | | Always |

Prompt structure: a cached system prompt listing every action with its parameters, allowed values and example phrasings; the user message holds the transcript; tool `select_app_action` is required and returns `{ "action": <enum>, "params": { } }` validated by a zod schema. An invalid or missing selection becomes `UNRECOGNIZED`. Preference-changing actions are saved by the client through the preferences API, like any other preference change.

## 8. Model and Bedrock Configuration

| Setting | Value |
|---|---|
| Model (both layers) | Amazon Nova Micro, cross-region inference profile `us.amazon.nova-micro-v1:0` |
| API | Bedrock Runtime `Converse` via `@aws-sdk/client-bedrock-runtime` |
| Region | `us-east-1` |
| Inference | `temperature: 0`, `maxTokens: 200` (layer 1: 60) |
| Tool use | One tool per layer, forced with `toolChoice` |
| Caching | `cachePoint` after the static system blocks |
| Timeout | 2,500 ms per call, one retry on throttling or 5xx with 100 ms jittered backoff |

`LlmClient` implementations:

| Implementation | Use | Notes |
|---|---|---|
| Bedrock Converse | Deployed stages; locally in `local-aws` | As configured above |
| Claude Code | Local preset `local` | The developer's own Claude Code command line, so local turns use the developer's Claude Code plan rather than pay-as-you-go API billing. Each call is one `claude -p` run with `--output-format json`, the layer's tool input schema as `--json-schema`, the static blocks as `--system-prompt`, no tools, no MCP servers, no setting sources, no saved session, `--effort low`, and a working directory outside the repository so no project context loads. The tool input is read from `structured_output`. Model from `ALLPLAY_CLAUDE_MODEL`, default `claude-haiku-5-5`; executable from `ALLPLAY_CLAUDE_BIN`, default `claude`. Timeout 30,000 ms per call. Measured about 1.5 s per layer |
| Claude API | Local setting `ALLPLAY_LLM=claude-api` | The official Anthropic TypeScript SDK (`@anthropic-ai/sdk`), Messages API with the same tool forced by `tool_choice`. Model from `ALLPLAY_CLAUDE_MODEL`, default `claude-haiku-5-5`. Thinking is disabled, since a forced tool call cannot follow a thinking block, and no sampling parameters are sent, since Claude Haiku 5.5 accepts only their defaults. The static system blocks carry `cache_control`. Timeout 10,000 ms per call, because the call leaves the developer's machine for the public API. The key comes from `ANTHROPIC_API_KEY` in the developer's environment, or from the git-ignored file `backend/.local/anthropic-api-key`, and is never committed |
| Fixed-response fake | Unit tests, `continuous-integration`, Test stage integration tests (AD-7) | Deterministic answers keyed by transcript |

All implementations take the same prompt blocks and tool schema and return the same parsed tool input, validated with zod. A provider's text never reaches the decider unvalidated.

The model id, `maxTokens` and timeout are configuration per layer (`DECIDER_L1_MODEL_ID`, `DECIDER_L2_MODEL_ID`, and so on), set as Lambda environment variables from CDK context. All Bedrock access goes through one `LlmClient` interface in `service/decision/llm/`, so changing provider or model changes one implementation and the configuration, never the decider logic.

A model change is accepted only when it passes the offline evaluation (Section 12) at or above the current model's accuracy.

## 9. Turn Outcomes and Failure Classes

| Final outcome | Failure class |
|---|---|
| `UNRECOGNIZED` (no category, no selection, or more than four matches) | `HARD` |
| `INVALID` (every selection failed engine validation) | `HARD` |
| `REJECTED` (player cancelled) | `HARD` |
| `CHOSE_OPTION` (player resolved an ambiguity) | `SOFT` |
| `CONFIRMED`, `AUTO_APPLIED`, `ACKNOWLEDGED`, `RESOLVED` | `NONE` |
| `EXPIRED` (superseded, version conflict, or never resolved) | `NONE` |

An undo after an auto-applied move is not a failure. A decision starts with failure class `PENDING`; the daily rollup job expires decisions still pending at the end of the day (`data-model.md` Section 12).

## 10. Cost and Abuse Controls

1. Per-player limits on `POST /v1/decisions`: 20 per minute and 600 per day, for guests and accounts alike, enforced with `RateLimitCounter` conditional increments. Over the limit returns `429 RATE_LIMITED` with the speech "Let's slow down for a moment. Try again in a minute."
2. API Gateway route throttling on `POST /v1/decisions`: 50 requests per second steady, 100 burst, per stage.
3. Bedrock token counts are added to the day's `MetricRollup` and shown on /admin.
4. The AWS Budgets alarm (`cdk-stacks.md` Section 9) covers Bedrock and Transcribe spend.

Estimated cost per voice turn with Nova Micro (about 3,700 input tokens and 100 output tokens across both layers): under $0.0002 for Bedrock. Transcribe streaming costs $0.024 per minute; a 3 second command is about $0.0012 (Transcribe bills a 15 second minimum per request, so short commands cost $0.006 each). Transcribe is therefore the larger per-turn cost.

## 11. Latency Budget

Target: median `clientLatencyMs` under 2,000 ms.

| Step | Budget (ms) |
|---|---|
| Final transcript after capture ends | 300 |
| Client to API Gateway to Lambda | 80 |
| Layer 1, in parallel with session load and legal action computation | 450 |
| Layer 2 | 600 |
| Validation and response | 70 |
| Render | 100 |
| Total | 1,600 |

Measures that hold the budget: pre-fetched credentials and buffered first audio, parallel layer 1 and session loading, cached system prompts, the decider Lambda at 1,024 MB on arm64, and `HINT`/`RESPONSE` paths that skip layer 2.

## 12. Evaluation

An offline utterance evaluation set lives at `backend/tests/decision-eval/`: for each core game, at least 200 cases, each with a board state (seeded game plus action history), a transcript, and the expected action ids or expected category. It includes column commands, card-name commands, ambiguous commands, application commands, responses to pending prompts, filler words, and common mistranscriptions ("for" for "four", "won" for "one").

`npm run eval:decider -- --stage Test` runs the set against Bedrock and reports top-1 accuracy, ambiguity rate, unrecognized rate, and latency percentiles. It costs real money, so it is run on demand (before changing prompts or models) and never in the pipeline. Accuracy target: 95% top-1 on unambiguous cases.

Unit tests (run in CI, no Bedrock calls) cover prompt building, candidate numbering, equivalence collapsing, post-processing rules, outcome and failure classification, rate limiting, and resolution handling, using a fake `LlmClient`.

## 13. Voice Output (Polly)

Text to speech sits behind `SpeechOutput` in the web client and `TextToSpeech` on the local server (Section 16). Deployed, `SpeechOutput` is Polly as described below. Locally, the client posts text to `POST /local/speech/synthesize` and plays the returned audio. The local server's `TextToSpeech` is Kokoro (the open-source Kokoro-82M model through `kokoro-onnx`), or Polly with the developer's AWS profile in the `local-aws` preset. Tests use a recording implementation that keeps the text it was asked to speak and plays nothing.

When `voiceOutputEnabled` is on, the client speaks the response `speech` field (and event speech text from the session envelope) by calling Amazon Polly `SynthesizeSpeech` directly with Identity Pool credentials (neural engine, the player's `voiceId`, SSML `prosody rate` from `speechRate`). The Identity Pool roles allow `polly:SynthesizeSpeech` only. The client caches synthesized audio by text for the session. Spoken text uses words, never symbols ("seven of spades", "column two").

## 14. Code Layout

```
backend/src/controller/web-api/decisions/   router, routes, controllers for Section 4
backend/src/service/decision/
  decisionService.ts       orchestration (Section 2)
  classifier.ts            layer 1
  gameSelector.ts          layer 2 game
  appSelector.ts           layer 2 application
  prompts/                 prompt builders and static prompt text
  llm/                     LlmClient interface; Bedrock Converse, Claude Code, Claude API and fake implementations
  outcomes.ts              outcome and failure classification
  rateLimiter.ts
backend/src/service/speech/  SpeechToText and TextToSpeech interfaces and local implementations
backend/src/local/            local server, composition root, macOS speech helper source
backend/src/models/decision.ts, appAction.ts
```

## 15. Implementation Legs

Built in execution phase 6 (Backend decision actions) unless noted. Each leg is one commit.

| Leg | Scope |
|---|---|
| AD-1 | `models/decision.ts` and `models/appAction.ts`; `LlmClient` interface, fake client, Bedrock Converse implementation with timeout and retry |
| AD-2 | Layer 1 classifier: prompt builder, tool schema, parsing; unit tests |
| AD-3 | Layer 2 game selector: board summary, candidate numbering with equivalence collapse, post-processing and validation through the game session service; unit tests |
| AD-4 | Layer 2 application selector and the application action catalog; unit tests |
| AD-5 | Decision service orchestration with parallel loading, outcomes, failure classes, `Decision` writes, metric counters; `POST /v1/decisions` and resolution routes |
| AD-6 | Rate limiter and API throttling; Bedrock and Transcribe IAM grants; Transcribe custom vocabulary custom resource |
| AD-7 | API integration tests for the decision routes against the Test stage, using a test-only fixed-response mode of `LlmClient` enabled by an environment variable in Test only |
| AD-8 | Offline evaluation set and `eval:decider` script for Spider Solitaire |
| AD-10 | `SpeechToText` interface with the macOS speech helper, whisper.cpp and typed implementations; `POST /local/speech/transcribe` on the local server |
| AD-11 | Web client audio capture (16 kHz PCM, WAV encoding), `SpeechInput` local server implementation, and the Voice Lab page (`local-development.md` Section 5) that shows the transcript and what the backend received |
| AD-12 | Decision intake: `POST /v1/decisions` parses the request, records a `Decision` through an in-memory `DecisionDao`, and replies `UNRECOGNIZED` with the heard text until the layers of AD-2 to AD-5 replace that reply |
| AD-13 | `TextToSpeech` with Kokoro and recording implementations, `POST /local/speech/synthesize`, and the web `SpeechOutput` local server implementation |
| AD-14 | Claude Code and Claude API `LlmClient` implementations and their tests |
| AD-15 | Server-side Transcribe and Polly implementations for the `local-aws` preset |
| AD-9 | Web client: Transcribe streaming capture, listening banner, proposal and choice UI, key handling, Polly playback (execution phase 7) |

## 16. Provider Interfaces

| Interface | Runtime | Implementations |
|---|---|---|
| `LlmClient` | Backend, `service/decision/llm/` | Bedrock Converse, Claude Code, Claude API, fixed-response fake |
| `SpeechToText` | Local server, `service/speech/` | macOS speech helper, whisper.cpp, Transcribe, typed only (no audio accepted) |
| `TextToSpeech` | Local server, `service/speech/` | Kokoro, Polly, recording |
| `SpeechInput` | Web client, `web-app/src/voice/` | Transcribe streaming (deployed), local server upload, typed |
| `SpeechOutput` | Web client, `web-app/src/voice/` | Polly (deployed), local server playback, browser speech synthesis, recording |
| DAOs | Backend, `dao/` | DynamoDB, in-memory (`local-development.md`) |

1. Each runtime has one composition root: the Lambda bootstraps for deployed stages and `backend/src/local/providers.ts` for the local server. It reads the configuration (`local-development.md` Section 2.1) and builds every implementation. Nothing else constructs a provider.
2. Services receive providers as constructor dependencies. A service never imports an implementation, and a lint rule enforces that for `service/decision/` and `service/speech/`.
3. Every implementation of an interface passes that interface's shared contract tests, as the session DAOs do.
4. The web client's `SpeechInput` and `SpeechOutput` are chosen from the stage `config.json` fields `speechInput` (`TRANSCRIBE`, `LOCAL_SERVER`, `TYPED`) and `speechOutput` (`POLLY`, `LOCAL_SERVER`, `BROWSER`, `OFF`).

## Appendix: Implementation Progress

Status as of 2026-11-20. Verified by the owner in the Voice Lab.

| Leg | Status | Notes |
|---|---|---|
| AD-10 | Done | `SpeechToText` in `backend/src/service/speech/` with macOS speech, whisper.cpp and typed-only implementations. The macOS helper runs as `AllPlaySpeech.app`, launched with `open`, because macOS kills a bare command-line binary that asks for speech permission. Measured: macOS speech under 1 s warm (about 8 s on the first run after a rebuild); whisper.cpp `ggml-base.en` 0.3 to 0.6 s warm |
| AD-11 | Done | 16 kHz AudioWorklet capture and WAV encoding (`web-app/src/voice/`), the local server `VoiceLabService`, and the `/voice-lab` page. Checked end to end in Chrome with a fake microphone |
| AD-12 | Done | `POST /v1/decisions` intake with an in-memory `DecisionDao`; it replies `UNRECOGNIZED` with the heard text until AD-2 to AD-5 |
| AD-1 | Done locally | Models, `LlmClient` interface and fake. The Bedrock Converse implementation follows with AD-15 |
| AD-14 | Done | Claude Code `LlmClient` (the `local` default, `claude -p` with structured output, about 1.5 s per layer on `claude-haiku-5-5`) and Claude API `LlmClient` (optional, needs a pay-as-you-go key) |
| AD-2 to AD-5 | Done locally | Classifier, game selector, application selector, orchestration, open decisions and the resolution route, on the in-memory `DecisionDao`. Rate limits (AD-6) and metric counters (DM-5) wait for the deployed stack. Verified 2026-11-20 by the voice playthrough: the seeded one-suit game won from the web app in 8.6 minutes, with every turn decided by Claude Code |
| AD-13 | Open | Kokoro `TextToSpeech` and local playback; the game screen speaks through the browser until then |
| AD-6 to AD-9, AD-15 | Open | Rate limits, Test stage tests, evaluation set, Bedrock, AWS speech and Transcribe capture |

Local development legs LD-1 (local server) and LD-3 (development caller) are done; see `local-development.md`.
