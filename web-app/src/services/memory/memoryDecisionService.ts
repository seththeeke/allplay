import { mockDecide } from "../../../test-data/decider";
import {
  CONFIRMED_APP_ACTIONS,
  type DecisionResponse,
  type SessionEnvelope,
} from "../../models/api";
import type { DecisionService, PreferencesService, SessionService } from "../types";

/** The special action id the decider uses for undo, which is a session action rather than a rule action. */
export const UNDO_ACTION_ID = "UNDO";
const SPIDER = "spider-solitaire";

/**
 * In-memory action decider: a rule-based stand-in for the Bedrock layers,
 * with the real API's outcomes, confirmation rules and stateless resolution:
 * a pending prompt comes back in the request (action-decision.md section 4).
 */
export function createMemoryDecisionService(
  sessions: SessionService,
  preferences: PreferencesService,
): DecisionService {
  let counter = 0;

  const perform = (
    sessionId: string,
    actionId: string,
    version: number,
  ): Promise<SessionEnvelope> =>
    actionId === UNDO_ACTION_ID
      ? sessions.undo(sessionId, { expectedVersion: version, source: "VOICE" })
      : sessions.apply(sessionId, { actionId, expectedVersion: version, source: "VOICE" });

  const respond = (
    outcome: DecisionResponse["outcome"],
    text: string,
    extra: Partial<
      Omit<DecisionResponse, "decisionId" | "outcome" | "displayText" | "speech">
    > = {},
  ): DecisionResponse => {
    counter += 1;
    const decisionId = `decision-${String(counter)}`;
    return {
      decisionId,
      outcome,
      displayText: text,
      speech: text,
      proposal: null,
      choices: null,
      appAction: null,
      session: null,
      ...extra,
    };
  };

  return {
    decide: async (request) => {
      const { context } = request;
      const prior = context.pendingPrompt;
      const envelope = context.screen === "GAME" ? await sessions.current(SPIDER) : null;
      const decision = mockDecide({
        transcript: request.transcript,
        pending: prior?.kind ?? null,
        legalActions: envelope?.legalActions ?? null,
        gameId: envelope === null ? null : SPIDER,
      });
      const version = context.expectedVersion ?? envelope?.session.version ?? 0;
      const sessionId = envelope?.session.sessionId ?? null;

      if (decision.kind === "RESPONSE" && prior !== null) {
        if (decision.response === "REJECT") return respond("RESOLVED", "Cancelled.");
        const chosen =
          decision.response === "OPTION"
            ? prior.actionIds[(decision.optionNumber ?? 1) - 1]
            : prior.actionIds[0];
        if (prior.appAction !== null)
          return respond("RESOLVED", "Done.", { appAction: prior.appAction });
        if (chosen === undefined || context.sessionId === null)
          return respond("UNRECOGNIZED", "There is no choice with that number.");
        const session = await perform(context.sessionId, chosen, version);
        return respond("RESOLVED", "Done.", { session });
      }
      if (decision.kind === "APP") {
        const confirm = CONFIRMED_APP_ACTIONS.has(decision.action.action);
        const text = confirm ? "Are you sure?" : "OK.";
        return respond("APP_ACTION", text, { appAction: decision.action });
      }
      if (decision.kind === "META" && decision.meta === "HINT" && sessionId !== null) {
        const hint = await sessions.hint(sessionId);
        return respond("RESOLVED", hint.text);
      }
      const ids =
        decision.kind === "META"
          ? [UNDO_ACTION_ID]
          : decision.kind === "GAME"
            ? decision.actionIds
            : [];
      const texts = new Map(
        (envelope?.legalActions ?? []).map((action) => [action.actionId, action.text]),
      );
      texts.set(UNDO_ACTION_ID, "Undo the last move");
      if (sessionId === null || ids.length === 0 || ids.length > 4) {
        return respond(
          "UNRECOGNIZED",
          "I'm not sure what you mean. Try naming the column numbers, like three to seven.",
        );
      }
      if (ids.length > 1) {
        const choices = ids.map((actionId, index) => ({
          number: index + 1,
          actionId,
          text: texts.get(actionId) ?? actionId,
        }));
        const text = `There are ${String(ids.length)} matching moves. Say the number you want.`;
        return respond("CHOICES", text, { choices });
      }
      const actionId = ids[0] ?? UNDO_ACTION_ID;
      const text = texts.get(actionId) ?? actionId;
      const { app } = await preferences.get();
      if (app.autoConfirm) {
        return respond("AUTO_APPLIED", text, {
          session: await perform(sessionId, actionId, version),
        });
      }
      return respond("PROPOSED", `${text}?`, { proposal: { actionId, text } });
    },
    resolve: async (_decisionId, request) => {
      const applies = request.resolution === "CONFIRMED" || request.resolution === "CHOSE_OPTION";
      const { sessionId, actionId } = request;
      if (!applies || sessionId === null || actionId === null) return { session: null };
      return { session: await perform(sessionId, actionId, request.expectedVersion ?? 0) };
    },
  };
}
