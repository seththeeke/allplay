import type { z } from "zod";
import {
  CONFIRMED_APP_ACTIONS,
  type Choice,
  type DecisionRequestSchema,
  type DecisionResponse,
  type GameCatalogEntry,
  type PendingPrompt,
  type ResolutionRequest,
  type ResolutionResponse,
  type SessionEnvelope,
} from "../../models/api";
import type { Decision, DecisionCategory } from "../../models/decision";
import { GameSessionError, invalidRequest } from "../gameSession/errors";
import type { GameSessionService } from "../gameSession/gameSessionService";
import { newUlid } from "../gameSession/ulid";
import { selectAppAction } from "./appSelector";
import { classify } from "./classifier";
import { HINT_ID, selectGameActions, UNDO_ID } from "./gameSelector";
import { LlmUnavailableError, type LlmClient } from "./llm/llmClient";
import { appActionText, failureClassOf, TEXT } from "./outcomes";
import type { TurnLog } from "./turnLog";

type ParsedDecisionRequest = z.output<typeof DecisionRequestSchema>;

export interface DecisionServiceDeps {
  /** The only record of a turn (action-decision.md section 9.1). */
  log: TurnLog;
  llm: LlmClient;
  sessions: GameSessionService;
  catalog: () => Promise<GameCatalogEntry[]>;
  /** The game's `speech.deciderGuidance` for a rules version. */
  guidance: (gameId: string, rulesVersion: number) => Promise<string[]>;
  /** The player's preferences; until DM-1 the defaults (action-decision.md section 6). */
  preferences?: (playerId: string) => Promise<{ autoConfirm: boolean }>;
  now?: () => Date;
  newId?: () => string;
}

export interface DecisionService {
  decide(playerId: string, request: ParsedDecisionRequest): Promise<DecisionResponse>;
  resolve(
    playerId: string,
    decisionId: string,
    request: ResolutionRequest,
  ): Promise<ResolutionResponse>;
}

/** What a turn decided, before it is recorded and answered. */
interface Turn {
  outcome: Decision["outcome"];
  response: Omit<DecisionResponse, "decisionId">;
  record?: Partial<Decision>;
}

const reply = (
  outcome: DecisionResponse["outcome"],
  text: string,
  extra: Partial<Omit<DecisionResponse, "decisionId" | "outcome">> = {},
): Omit<DecisionResponse, "decisionId"> => ({
  outcome,
  displayText: text,
  speech: text,
  proposal: null,
  choices: null,
  appAction: null,
  session: null,
  ...extra,
});

/**
 * The action decider (action-decision.md section 2): classify, select, verify
 * against the session, and log every turn. It keeps no turn state: a pending
 * prompt comes back with the client's next request. Game state changes only
 * through the game session service.
 */
export function createDecisionService(deps: DecisionServiceDeps): DecisionService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => newUlid(now().getTime()));
  const preferences = deps.preferences ?? (() => Promise.resolve({ autoConfirm: false }));

  /** Logs how a pending turn ended (`TURN_RESOLVED`). */
  const settle = (
    playerId: string,
    decisionId: string,
    resolution: string,
    outcome: Decision["outcome"],
    extra: { sessionId?: string | undefined; clientLatencyMs?: number } = {},
  ): void => {
    deps.log.resolved({
      decisionId,
      playerId,
      resolution,
      outcome,
      failureClass: failureClassOf(outcome) ?? "NONE",
      ...extra,
    });
  };

  /** Applies a candidate through the session service; UNDO is the session's undo. */
  const perform = (
    playerId: string,
    sessionId: string,
    actionId: string,
    expectedVersion: number,
  ): Promise<SessionEnvelope> =>
    actionId === UNDO_ID
      ? deps.sessions.undo(playerId, sessionId, { expectedVersion })
      : deps.sessions.applyAction(playerId, sessionId, { actionId, expectedVersion });

  /**
   * Applies a pending action. A stale version logs the turn as `EXPIRED` and
   * an illegal action as `INVALID` before the error goes back (section 4.2).
   */
  const applyPending = async (
    playerId: string,
    decisionId: string,
    resolution: string,
    target: { sessionId: string; actionId: string; expectedVersion: number },
  ): Promise<SessionEnvelope> => {
    try {
      return await perform(playerId, target.sessionId, target.actionId, target.expectedVersion);
    } catch (error) {
      if (error instanceof GameSessionError)
        settle(
          playerId,
          decisionId,
          resolution,
          error.code === "ILLEGAL_ACTION" ? "INVALID" : "EXPIRED",
          {
            sessionId: target.sessionId,
          },
        );
      throw error;
    }
  };

  /** A spoken answer to the prompt the client sent back (action-decision.md section 5). */
  const answer = async (
    playerId: string,
    request: ParsedDecisionRequest,
    prompt: PendingPrompt,
    response: "CONFIRM" | "REJECT" | "OPTION" | null,
    optionNumber: number | null,
  ): Promise<Turn> => {
    const { sessionId, expectedVersion } = request.context;
    if (response === "REJECT") {
      settle(playerId, prompt.decisionId, "REJECTED", "REJECTED");
      return { outcome: "RESOLVED", response: reply("RESOLVED", TEXT.cancelled) };
    }
    const wantsChoice = prompt.kind === "CHOICES";
    if (wantsChoice !== (response === "OPTION")) {
      return {
        outcome: "UNRECOGNIZED",
        response: reply("UNRECOGNIZED", wantsChoice ? TEXT.sayNumber : TEXT.sayYesOrNo),
      };
    }
    if (prompt.appAction !== null) {
      settle(playerId, prompt.decisionId, "CONFIRMED", "CONFIRMED");
      return {
        outcome: "RESOLVED",
        response: reply("RESOLVED", appActionText(prompt.appAction), {
          appAction: prompt.appAction,
        }),
      };
    }
    const actionId = prompt.actionIds[wantsChoice ? (optionNumber ?? 0) - 1 : 0];
    if (actionId === undefined || sessionId === null) {
      return { outcome: "UNRECOGNIZED", response: reply("UNRECOGNIZED", TEXT.noSuchChoice) };
    }
    const resolution = wantsChoice ? "CHOSE_OPTION" : "CONFIRMED";
    const session = await applyPending(playerId, prompt.decisionId, resolution, {
      sessionId,
      actionId,
      expectedVersion: expectedVersion ?? 0,
    });
    settle(playerId, prompt.decisionId, resolution, resolution, { sessionId });
    return { outcome: "RESOLVED", response: reply("RESOLVED", TEXT.done, { session }) };
  };

  const gameTurn = async (
    playerId: string,
    request: ParsedDecisionRequest,
    envelope: SessionEnvelope,
  ): Promise<Turn> => {
    const { gameId, rulesVersion } = envelope.view;
    const games = await deps.catalog();
    const selection = await selectGameActions(deps.llm, {
      gameName: games.find((game) => game.gameId === gameId)?.name ?? gameId,
      guidance: await deps.guidance(gameId, rulesVersion),
      envelope,
      transcript: request.transcript.trim(),
      alternatives: request.alternatives,
    });
    const record: Partial<Decision> = {
      candidateCount: selection.candidates.length,
      candidatesDigest: selection.digest,
      selection: {
        ...selection.call,
        selectedIds: selection.selectedIds,
        confidence: selection.confidence,
      },
    };
    const text = new Map(selection.candidates.map((c) => [c.actionId, c.text]));
    const ids = selection.selectedIds;
    if (ids.length === 0) {
      const said = selection.requested;
      return {
        outcome: "UNRECOGNIZED",
        response: reply("UNRECOGNIZED", said === null ? TEXT.whichMove : TEXT.notAllowed(said)),
        record,
      };
    }
    if (ids.length > 4) {
      return { outcome: "UNRECOGNIZED", response: reply("UNRECOGNIZED", TEXT.whichMove), record };
    }
    const sessionId = envelope.session.sessionId;
    const version = envelope.session.version;
    const [only] = ids;
    /* A hint is proposed like a move: highlighted, then made on confirmation (section 6). */
    const hinted =
      ids.length === 1 && only === HINT_ID
        ? (await deps.sessions.hint(playerId, sessionId)).action
        : undefined;
    if (hinted === null) {
      return { outcome: "RESOLVED", response: reply("RESOLVED", TEXT.noHint), record };
    }
    if (hinted !== undefined) {
      const shown = TEXT.hint(hinted.text);
      return {
        outcome: "PROPOSED",
        response: {
          ...reply("PROPOSED", shown, {
            proposal: { actionId: hinted.actionId, text: hinted.text },
          }),
          speech: `${TEXT.hint(hinted.text)} Say yes to make it, or no to cancel.`,
        },
        record: {
          ...record,
          proposal: {
            kind: "PROPOSED",
            text: shown,
            actionIds: [hinted.actionId],
            appAction: null,
            choices: null,
          },
        },
      };
    }
    if (ids.length > 1) {
      const choices: Choice[] = ids.map((actionId, index) => ({
        number: index + 1,
        actionId,
        text: text.get(actionId) ?? actionId,
      }));
      const shown = `${TEXT.choices(choices.length)} ${choices
        .map((choice) => `${String(choice.number)}: ${choice.text}.`)
        .join(" ")}`;
      return {
        outcome: "CHOICES",
        response: reply("CHOICES", shown, { choices }),
        record: {
          ...record,
          proposal: { kind: "CHOICES", text: shown, actionIds: ids, appAction: null, choices },
        },
      };
    }
    const actionId = only as string;
    const actionText = text.get(actionId) ?? actionId;
    if (selection.confidence === "HIGH" && (await preferences(playerId)).autoConfirm) {
      const session = await perform(playerId, sessionId, actionId, version);
      return {
        outcome: "AUTO_APPLIED",
        response: reply("AUTO_APPLIED", actionText, { session }),
        record,
      };
    }
    const shown = `${actionText}?`;
    return {
      outcome: "PROPOSED",
      response: {
        ...reply("PROPOSED", shown, { proposal: { actionId, text: actionText } }),
        speech: `${actionText}. Say yes to confirm, or no to cancel.`,
      },
      record: {
        ...record,
        proposal: {
          kind: "PROPOSED",
          text: shown,
          actionIds: [actionId],
          appAction: null,
          choices: null,
        },
      },
    };
  };

  const appTurn = async (
    request: ParsedDecisionRequest,
    envelope: SessionEnvelope | null,
  ): Promise<Turn> => {
    const { action, call } = await selectAppAction(deps.llm, {
      transcript: request.transcript.trim(),
      alternatives: request.alternatives,
      screen: request.context.screen,
      currentGameId: envelope?.session.gameId ?? null,
      games: await deps.catalog(),
    });
    const record: Partial<Decision> = {
      selection: { ...call, selectedIds: action === null ? [] : [action.action] },
    };
    if (action === null) {
      return {
        outcome: "UNRECOGNIZED",
        response: reply("UNRECOGNIZED", TEXT.unrecognized),
        record,
      };
    }
    const confirm = CONFIRMED_APP_ACTIONS.has(action.action);
    const shown = confirm ? `${appActionText(action)}?` : appActionText(action);
    return {
      outcome: "APP_ACTION",
      response: reply("APP_ACTION", shown, { appAction: action }),
      record: {
        ...record,
        proposal: {
          kind: "APP_ACTION",
          text: shown,
          actionIds: [],
          appAction: action,
          choices: null,
        },
      },
    };
  };

  const loadSession = async (
    playerId: string,
    request: ParsedDecisionRequest,
  ): Promise<SessionEnvelope | null> => {
    const { sessionId, screen } = request.context;
    if (screen !== "GAME" || sessionId === null) return null;
    try {
      const envelope = await deps.sessions.get(playerId, sessionId);
      return envelope.session.status === "IN_PROGRESS" ? envelope : null;
    } catch (error) {
      if (error instanceof GameSessionError) return null;
      throw error;
    }
  };

  return {
    decide: async (playerId, request) => {
      const started = now();
      const transcript = request.transcript.trim();
      const pending = request.context.pendingPrompt;
      /* GAME is offered on the game screen; the session loads in parallel with layer 1 (section 11). */
      const inGame = request.context.screen === "GAME" && request.context.sessionId !== null;
      const envelopePromise = loadSession(playerId, request);
      const categories: DecisionCategory[] = [
        ...(inGame ? (["GAME"] as const) : []),
        "APPLICATION",
        ...(pending === null ? [] : (["RESPONSE"] as const)),
        "UNRECOGNIZED",
      ];

      let turn: Turn;
      let classification: Decision["classification"];
      let envelope: SessionEnvelope | null = null;
      try {
        const [classified, loaded] = await Promise.all([
          classify(deps.llm, {
            transcript,
            alternatives: request.alternatives,
            categories,
            pending:
              pending === null
                ? null
                : { kind: pending.kind, choiceCount: pending.actionIds.length },
          }),
          envelopePromise,
        ]);
        envelope = loaded;
        classification = {
          ...classified.call,
          category: classified.category,
          response: classified.response,
        };
        if (
          pending !== null &&
          (classified.category === "GAME" || classified.category === "APPLICATION")
        )
          settle(playerId, pending.decisionId, "SUPERSEDED", "EXPIRED");
        if (classified.category === "RESPONSE" && pending !== null) {
          turn = await answer(
            playerId,
            request,
            pending,
            classified.response,
            classified.optionNumber,
          );
        } else if (classified.category === "GAME") {
          turn =
            envelope === null
              ? { outcome: "UNRECOGNIZED", response: reply("UNRECOGNIZED", TEXT.noGame) }
              : await gameTurn(playerId, request, envelope);
        } else if (classified.category === "APPLICATION") {
          turn = await appTurn(request, envelope);
        } else {
          turn = { outcome: "UNRECOGNIZED", response: reply("UNRECOGNIZED", TEXT.unrecognized) };
        }
      } catch (error) {
        if (!(error instanceof LlmUnavailableError)) throw error;
        envelope = await envelopePromise;
        turn = {
          outcome: "UNRECOGNIZED",
          response: reply("UNRECOGNIZED", TEXT.modelUnavailable(error.message), {
            speech: TEXT.modelUnavailableSpeech,
          }),
        };
      }

      const decisionId = newId();
      const at = started.toISOString();
      const outcome = turn.outcome;
      const failureClass = failureClassOf(outcome);
      const gameId = envelope?.session.gameId;
      deps.log.decided({
        decisionId,
        playerId,
        ...(request.context.sessionId === null ? {} : { sessionId: request.context.sessionId }),
        ...(gameId === undefined ? {} : { gameId }),
        ...(envelope === null
          ? request.context.expectedVersion === null
            ? {}
            : { sessionVersion: request.context.expectedVersion }
          : { sessionVersion: envelope.session.version }),
        transcriptSource: request.transcriptSource,
        transcript,
        alternatives: request.alternatives,
        uiContext: {
          screen: request.context.screen,
          pendingDecisionId: pending?.decisionId ?? null,
        },
        ...(classification === undefined ? {} : { classification }),
        ...turn.record,
        outcome,
        ...(failureClass === undefined ? {} : { failureClass }),
        serverLatencyMs: Math.max(0, now().getTime() - started.getTime()),
        createdAt: at,
      });
      return { decisionId, ...turn.response };
    },

    resolve: async (playerId, decisionId, request) => {
      const { resolution, sessionId, actionId, clientLatencyMs } = request;
      const applies =
        resolution === "CHOSE_OPTION" || (resolution === "CONFIRMED" && actionId !== null);
      if (!applies) {
        settle(playerId, decisionId, resolution, resolution, {
          ...(sessionId === null ? {} : { sessionId }),
          clientLatencyMs,
        });
        return { session: null };
      }
      if (sessionId === null || actionId === null)
        throw invalidRequest("Send the session and the action to apply.");
      const session = await applyPending(playerId, decisionId, resolution, {
        sessionId,
        actionId,
        expectedVersion: request.expectedVersion ?? 0,
      });
      settle(playerId, decisionId, resolution, resolution, { sessionId, clientLatencyMs });
      return { session };
    },
  };
}
