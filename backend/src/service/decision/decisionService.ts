import type { z } from "zod";
import type { DecisionDao } from "../../dao/decision/decisionDao";
import {
  CONFIRMED_APP_ACTIONS,
  type Choice,
  type DecisionRequestSchema,
  type DecisionResponse,
  type GameCatalogEntry,
  type ResolutionRequest,
  type ResolutionResponse,
  type SessionEnvelope,
} from "../../models/api";
import { OPEN_OUTCOMES, type Decision, type DecisionCategory } from "../../models/decision";
import { GameSessionError, notApplicable, notFound } from "../gameSession/errors";
import type { GameSessionService } from "../gameSession/gameSessionService";
import { newUlid } from "../gameSession/ulid";
import { selectAppAction } from "./appSelector";
import { classify, type PendingPrompt } from "./classifier";
import { HINT_ID, selectGameActions, UNDO_ID } from "./gameSelector";
import { LlmUnavailableError, type LlmClient } from "./llm/llmClient";
import { appActionText, failureClassOf, TEXT } from "./outcomes";

type ParsedDecisionRequest = z.output<typeof DecisionRequestSchema>;

/** Decisions expire 30 days after creation (data-model.md section 9). */
const TTL_SECONDS = 30 * 24 * 60 * 60;

export interface DecisionServiceDeps {
  dao: DecisionDao;
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
  recent(playerId: string, limit: number): Promise<Decision[]>;
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
 * against the session, and record every turn. Game state changes only through
 * the game session service.
 */
export function createDecisionService(deps: DecisionServiceDeps): DecisionService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => newUlid(now().getTime()));
  const preferences = deps.preferences ?? (() => Promise.resolve({ autoConfirm: false }));

  const finalize = async (
    decision: Decision,
    outcome: Decision["outcome"],
    extra: Partial<Decision> = {},
  ): Promise<void> => {
    const failureClass = failureClassOf(outcome);
    await deps.dao.update({
      ...decision,
      ...extra,
      outcome,
      failureClass,
      dayOutcomeKey: `${decision.createdAt.slice(0, 10)}#${failureClass}`,
      updatedAt: now().toISOString(),
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

  const openDecision = async (playerId: string, decisionId: string | null) => {
    if (decisionId === null) return null;
    const decision = await deps.dao.get(decisionId);
    return decision !== null &&
      decision.playerId === playerId &&
      OPEN_OUTCOMES.has(decision.outcome)
      ? decision
      : null;
  };

  /** A spoken answer to the open prompt (action-decision.md section 5). */
  const answer = async (
    playerId: string,
    pending: Decision,
    response: "CONFIRM" | "REJECT" | "OPTION" | null,
    optionNumber: number | null,
  ): Promise<Turn> => {
    const proposal = pending.proposal;
    if (response === "REJECT") {
      await finalize(pending, "REJECTED");
      return { outcome: "RESOLVED", response: reply("RESOLVED", TEXT.cancelled) };
    }
    const index = response === "OPTION" ? (optionNumber ?? 0) - 1 : 0;
    const wantsChoice = proposal?.kind === "CHOICES";
    if (proposal === undefined || wantsChoice !== (response === "OPTION")) {
      return {
        outcome: "UNRECOGNIZED",
        response: reply("UNRECOGNIZED", wantsChoice ? TEXT.sayNumber : TEXT.sayYesOrNo),
      };
    }
    if (proposal.appAction !== null) {
      await finalize(pending, "CONFIRMED");
      return {
        outcome: "RESOLVED",
        response: reply("RESOLVED", appActionText(proposal.appAction), {
          appAction: proposal.appAction,
        }),
      };
    }
    const actionId = proposal.actionIds[index];
    if (actionId === undefined || pending.sessionId === undefined) {
      return { outcome: "UNRECOGNIZED", response: reply("UNRECOGNIZED", TEXT.noSuchChoice) };
    }
    const session = await applyFor(playerId, pending, actionId, pending.sessionVersion ?? 0);
    await finalize(pending, wantsChoice ? "CHOSE_OPTION" : "CONFIRMED");
    return { outcome: "RESOLVED", response: reply("RESOLVED", TEXT.done, { session }) };
  };

  /** Applies an open decision's action; a stale version expires the decision before the 409 goes back. */
  const applyFor = async (
    playerId: string,
    decision: Decision,
    actionId: string,
    expectedVersion: number,
  ): Promise<SessionEnvelope> => {
    try {
      return await perform(playerId, decision.sessionId ?? "", actionId, expectedVersion);
    } catch (error) {
      if (error instanceof GameSessionError) await finalize(decision, "EXPIRED");
      throw error;
    }
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
      const pending = await openDecision(playerId, request.context.pendingDecisionId);
      const prompt: PendingPrompt | null =
        pending?.proposal === undefined
          ? null
          : {
              kind: pending.proposal.kind === "CHOICES" ? "CHOICES" : "CONFIRMATION",
              choiceCount: pending.proposal.choices?.length ?? 0,
            };
      /* GAME is offered on the game screen; the session loads in parallel with layer 1 (section 11). */
      const inGame = request.context.screen === "GAME" && request.context.sessionId !== null;
      const envelopePromise = loadSession(playerId, request);
      const categories: DecisionCategory[] = [
        ...(inGame ? (["GAME"] as const) : []),
        "APPLICATION",
        ...(prompt === null ? [] : (["RESPONSE"] as const)),
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
            pending: prompt,
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
          await finalize(pending, "EXPIRED");
        if (classified.category === "RESPONSE" && pending !== null) {
          turn = await answer(playerId, pending, classified.response, classified.optionNumber);
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
      await deps.dao.create({
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
          pendingPrompt: request.context.pendingDecisionId,
        },
        ...(classification === undefined ? {} : { classification }),
        ...turn.record,
        outcome,
        failureClass,
        serverLatencyMs: Math.max(0, now().getTime() - started.getTime()),
        dayOutcomeKey: `${at.slice(0, 10)}#${failureClass}`,
        ttl: Math.floor(started.getTime() / 1000) + TTL_SECONDS,
        entityVersion: 1,
        createdAt: at,
        updatedAt: at,
      });
      return { decisionId, ...turn.response };
    },

    resolve: async (playerId, decisionId, request) => {
      const decision = await deps.dao.get(decisionId);
      if (decision?.playerId !== playerId) throw notFound("Decision");
      const kind = decision.outcome;
      if (!OPEN_OUTCOMES.has(kind) && kind !== "AUTO_APPLIED")
        throw notApplicable("This decision is already resolved.");
      const allowed: Record<ResolutionRequest["resolution"], readonly string[]> = {
        CONFIRMED: ["PROPOSED", "APP_ACTION"],
        CHOSE_OPTION: ["CHOICES"],
        REJECTED: ["PROPOSED", "CHOICES", "APP_ACTION"],
        ACKNOWLEDGED: ["AUTO_APPLIED", "APP_ACTION"],
      };
      if (!allowed[request.resolution].includes(kind))
        throw notApplicable(`${request.resolution} does not apply to a ${kind} decision.`);
      const latency = { clientLatencyMs: request.clientLatencyMs };
      const actionIndex =
        request.resolution === "CHOSE_OPTION" ? (request.optionNumber ?? 0) - 1 : 0;
      const actionId = decision.proposal?.actionIds[actionIndex];
      if (
        (request.resolution === "CONFIRMED" && kind === "PROPOSED") ||
        request.resolution === "CHOSE_OPTION"
      ) {
        if (actionId === undefined) throw notApplicable("There is no choice with that number.");
        const session = await applyFor(
          playerId,
          decision,
          actionId,
          request.expectedVersion ?? decision.sessionVersion ?? 0,
        );
        await finalize(decision, request.resolution, latency);
        return { session };
      }
      await finalize(decision, request.resolution, latency);
      return { session: null };
    },

    recent: (playerId, limit) => deps.dao.listByPlayer(playerId, limit),
  };
}
