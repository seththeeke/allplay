# Conversational AI

Status: Design, 2026-11-22.

Conversational voice is the default way to play. When a game opens, the game speaker greets the player and listens continuously. The player talks naturally, the game acts when the player finishes speaking, and the speaker answers in a word or two. It asks for confirmation only when it is unsure.

The push-to-talk flow of `action-decision.md` remains available as the turn-based voice setting.

Related specs: `day-0-designs/action-decision.md` (decider, providers, turn log), `day-0-designs/data-model.md` (tables, preferences, deletion), `day-0-designs/cdk-stacks.md` (stacks), `day-0-designs/local-development.md` (local presets).

## 1. Principles

1. The LLM selects; the engine executes. Conversational turns use the same server-built candidates, validation and game session service as turn-based turns.
2. A turn makes at most two LLM calls: layer 1 classifies and extracts, and layer 2 selects a move or answers a question.
3. One file, `backend/src/service/conversation/personality/game-speaker.md`, defines the game speaker's voice, behavior and spoken phrases.
4. Speech with no game request produces no spoken reply and no state change.
5. Every provider stays behind its interface. The feature runs on the local Claude Code language model, on-device speech and Kokoro with no AWS access.
6. Transcripts, including side talk, are stored for 90 days (Section 6). Audio is never stored or sent to the backend.

## 2. Voice Modes

The `APP` preference `voiceMode` selects the experience.

| Value            | Label in Settings    | Behavior                                                          |
| ---------------- | -------------------- | ----------------------------------------------------------------- |
| `CONVERSATIONAL` | Conversational voice | Default. Continuous listening, the voice orb, and automatic moves |
| `TURN_BASED`     | Turn-based voice     | The existing voice bar: Space or Talk, then confirm each move     |

A player with no stored `voiceMode` gets `CONVERSATIONAL`. In conversational mode the speaker always speaks, and `voiceOutputEnabled` applies to turn-based mode only. `autoConfirm` also applies to turn-based mode only.

Settings describes conversational mode with this text: "Listens during a game and keeps a transcript of what it hears for 90 days."

## 3. Conversation Flow

```
Game screen opens
  -> POST /v1/conversations/{sessionId}/greeting
  -> orb speaks the greeting, then moves to the bottom left corner
  -> microphone stays open in the browser
Player speaks
  -> speech detector marks the start, keeping 500 ms of earlier audio
  -> any playing reply stops (barge-in)
  -> silence for listenTimeoutMs ends the utterance
  -> client transcribes the utterance
  -> POST /v1/decisions with context.voiceMode = CONVERSATIONAL
  <- reply: applied move, question, answer, or silence
  -> orb speaks the reply and listening continues
```

Utterances are handled in order, one at a time, so a second command spoken during a decision runs against the updated game version.

### 3.1 Listening

1. The microphone opens when the game screen is ready and closes when the player leaves it, pauses listening, or the tab is hidden.
2. A browser speech detector classifies 30 ms audio frames by energy against a rolling noise floor.
3. Speech starts after 150 ms above the threshold. While the speaker is talking, the threshold is doubled so that its own voice does not trigger a barge-in. Browser echo cancellation remains on.
4. An utterance ends after `listenTimeoutMs` of silence (default 1200 ms) or at 15 seconds of continuous speech.
5. An utterance shorter than 250 ms is discarded.
6. A microphone that is denied or unavailable leaves the typed command field available and the orb in its paused state.

### 3.2 Transcription

| `speechInput`  | Behavior                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCAL_SERVER` | Each utterance is encoded as WAV and sent to `POST /local/speech/transcribe`                                                                                                                |
| `TRANSCRIBE`   | Speech-gated stream: detected speech opens a Transcribe stream, starting with the 500 ms of buffered audio. The stream stays open through pauses and closes after 15 seconds without speech |
| `TYPED`        | The typed command field only                                                                                                                                                                |

The maximum Transcribe cost is $1.44 per player-hour. No stream is open during long silences.

### 3.3 Controls

| Input                      | Action                                               |
| -------------------------- | ---------------------------------------------------- |
| Space, or pressing the orb | Pause or resume listening                            |
| Enter                      | Confirm the waiting prompt                           |
| Escape                     | Cancel the waiting prompt, or stop the current reply |
| 1 to 4                     | Pick a numbered choice                               |
| Type button                | Open the typed command field                         |

## 4. Decisions

`POST /v1/decisions` accepts `context.voiceMode`, defaulting to `TURN_BASED`. Turn-based behavior does not change. The response gains `silent`, a boolean that defaults to false.

### 4.1 Layer 1

Conversational classification adds two categories and one field.

| Category   | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `QUESTION` | A question about this game or what happened in it, such as "did I already deal?" |
| `IGNORED`  | No request for the game or app, such as room conversation or nonsense            |

`command` holds only the words directed at the game. For "move 8 to 7, dinner's ready", `command` is "move 8 to 7", and layer 2 receives that text. The last six conversation messages are supplied as quoted data, so "do that again" and "undo that" can be understood.

### 4.2 Outcomes

| Result                           | Outcome        | Spoken reply                                                                   |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| One action, `HIGH` confidence    | `AUTO_APPLIED` | A rotating acknowledgement                                                     |
| One action, `LOW` confidence     | `PROPOSED`     | A short confirmation question                                                  |
| Two to four actions              | `CHOICES`      | The numbered options                                                           |
| Undo                             | `AUTO_APPLIED` | A rotating acknowledgement                                                     |
| Hint                             | `PROPOSED`     | The hint and an offer to make it                                               |
| Application action               | `APP_ACTION`   | A rotating acknowledgement; `NEW_GAME`, `SIGN_IN` and `SIGN_OUT` still confirm |
| Game request with no legal match | `UNRECOGNIZED` | A brief explanation                                                            |
| `QUESTION`                       | `ANSWERED`     | The layer 2 answer                                                             |
| `IGNORED`                        | `IGNORED`      | None; `silent` is true                                                         |

`ANSWERED` and `IGNORED` have failure class `NONE`. A waiting prompt stays open through an `IGNORED` turn.

### 4.3 Questions

A `QUESTION` turn loads the full conversation with one `Query` and asks layer 2 for an answer of at most 25 words, using the personality, the board summary and the most recent 200 messages as quoted data. The answer tool returns text only and cannot change game state.

## 5. Game Speaker Personality

`game-speaker.md` has these level two headings, each required:

| Heading            | Use                                                   |
| ------------------ | ----------------------------------------------------- |
| `Persona`          | System prompt block for every conversational LLM call |
| `Greeting`         | Spoken when a new game starts                         |
| `Welcome Back`     | Spoken when a game with history is reopened           |
| `Acknowledgements` | Bulleted replies after a completed action             |
| `Confirm`          | Confirmation template containing `{action}`           |
| `Choices`          | Choice prompt template containing `{options}`         |
| `Not Allowed`      | Reply when a requested move is not legal              |
| `Unavailable`      | Reply when the language model cannot answer           |

The file is parsed and validated with zod when the decider starts. It ships with the `DecisionApi` Lambda and is read from the source tree locally. Local changes take effect when the server restarts.

## 6. Conversation Storage

Entity `ConversationMessage`, table `AllPlay-ConversationMessages-<Stage>`.

| Key           | Attribute   | Type          |
| ------------- | ----------- | ------------- |
| Partition key | `sessionId` | String        |
| Sort key      | `messageId` | String (ULID) |

No GSIs. One `Query` on `sessionId` returns the full conversation in order.

| Attribute                                 | Type   | Notes                                                    |
| ----------------------------------------- | ------ | -------------------------------------------------------- |
| `role`                                    | String | `PLAYER`, `SPEAKER` or `ACTION`                          |
| `text`                                    | String | The full transcript, spoken reply, or action description |
| `decisionId`                              | String | Optional, the related turn                               |
| `actionId`                                | String | Optional, `ACTION` messages only                         |
| `sessionVersion`                          | Number | Optional, the game version after an action               |
| `ttl`                                     | Number | Last message time + 90 days, epoch seconds               |
| `entityVersion`, `createdAt`, `updatedAt` |        | `data-model.md` Section 1                                |

1. Messages carry no `playerId`, so a guest merge needs no change here. Access is checked through the session's seats.
2. The first write that moves a conversation's expiry forward by at least one day refreshes `ttl` on every message, so a conversation expires as a whole 90 days after its last message.
3. Account deletion deletes the conversation of every session it deletes.
4. A failed conversation write is logged and never fails the player's turn.

## 7. API

Both routes are appended to the decisions bundle with IAM authorization and the `GUEST` tier.

`POST /v1/conversations/{sessionId}/greeting` returns `{ "text": "...", "kind": "GREETING" | "WELCOME_BACK" }` and records the message when it is a new game's first greeting. The caller must hold a seat in the session.

`POST /v1/decisions/{decisionId}/resolution` accepts an optional `voiceMode`. In conversational mode it records the applied action and returns `speech`, the acknowledgement to speak.

## 8. Voice Orb

| State      | Appearance                                                                       | Status text for assistive technology |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| `GREETING` | Large and centered, pulsing while its clouds drift, with the greeting beneath it | The greeting                         |
| `IDLE`     | Small, bottom left, clouds barely drifting                                       | "Listening for your voice"           |
| `HEARING`  | Small, clouds drifting faster, with a bright ring                                | "Hearing you"                        |
| `THINKING` | Small, clouds drifting, dimmed                                                   | "Working on it"                      |
| `SPEAKING` | Small, pulsing while its clouds drift gently                                     | The reply text                       |
| `PAUSED`   | Small, still, desaturated, with a slash                                          | "Listening paused"                   |

1. The orb is a round view of a cloudy sky: deep blue at the top, a soft ragged line of white cloud through the middle, and pale periwinkle haze below. Two cloud layers drift slowly past each other. It is drawn on a 2D canvas with no 3D library.
2. After the greeting ends, the orb shrinks and falls into the bottom left corner over 700 ms.
3. With reduced motion, the sky is one still frame, the orb moves without animation, and each state is shown by a static ring style and its text.
4. The orb is a real button of at least 56 CSS pixels, with an accessible name that states the action.
5. Prompts and choices appear in a compact panel beside the orb only while they wait for an answer. Game actions stay available at the bottom right.

## 9. Infrastructure

1. `AllPlayStatefulStack` adds the table with the standard `AllPlayTable` settings and `ttl`.
2. `DecisionApi` gets `Query`, `PutItem`, `UpdateItem` on the table and the `CONVERSATION_MESSAGES_TABLE` variable.
3. `PlayerApi` gets `Query` and `BatchWriteItem` on the table and the same variable for account deletion. A merge leaves messages untouched, so `AdminApi` needs no access.
4. Test's verification role gets access to the table for the DAO contract tests.

## 10. Local Development

The `local` preset uses Claude Code for layers 1 and 2, macOS speech or whisper.cpp for transcription, Kokoro for replies, and an in-memory conversation DAO. The `continuous-integration` preset uses the fixed-response language model. No conversational path requires Bedrock.

## 11. Implementation Legs

Each leg is one commit.

| Leg  | Scope                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| CA-1 | This spec, with `data-model.md` and `action-decision.md` references                                                      |
| CA-2 | `ConversationMessage` model, DAOs and contract tests, table, grants, and account deletion                                |
| CA-3 | Personality file and parser; conversational layer 1, question answering, decisions, greeting route and message recording |
| CA-4 | `voiceMode` preference and Settings control                                                                              |
| CA-5 | Speech detector, continuous local and Transcribe listeners, interruptible speech output                                  |
| CA-6 | Voice orb, conversational game screen, and an end-to-end check on the local Claude Code stack                            |
| CA-7 | Three-dimensional orb on a 2D canvas                                                                                     |
| CA-8 | Cloudy sky appearance for the orb                                                                                        |

## Appendix: Implementation Progress

Status as of 2026-11-22.

| Leg                 | Status                     | Notes                                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-1 to CA-8        | Done locally, not deployed | Checked in Chromium with spoken audio as the microphone, on the local server with Claude Code (`claude-haiku-5-5`), macOS speech and in-memory storage. A move, side talk and a history question each behaved as specified. Measured server time on Claude Code: about 5 s for a move or question and 2 to 3 s for ignored speech |
| Transcribe listener | Unit tested only           | The speech-gated stream has not run against Amazon Transcribe                                                                                                                                                                                                                                                                     |
| Bedrock             | Not run                    | The conversational prompts have not been evaluated on Nova Micro, because the Bedrock quota is still 0                                                                                                                                                                                                                            |
