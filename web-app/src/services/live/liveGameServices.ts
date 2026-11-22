import {
  DecisionResponseSchema,
  GamesResponseSchema,
  HintResponseSchema,
  ResolutionResponseSchema,
  SessionEnvelopeSchema,
  StatsResponseSchema,
} from "../../models/api";
import { ApiRequestError } from "../errors";
import type { DecisionService, GameService, SessionService, StatsService } from "../types";
import type { ApiClient } from "./apiClient";

/** `GET /v1/games` (game-engine.md section 11). */
export function createLiveGameService(api: ApiClient): GameService {
  return { list: () => api.get("v1/games", GamesResponseSchema) };
}

/** The session routes of game-engine.md section 11. */
export function createLiveSessionService(api: ApiClient): SessionService {
  const session = (id: string) => `v1/sessions/${encodeURIComponent(id)}`;
  return {
    current: async (gameId) => {
      try {
        return await api.get(
          `v1/sessions/current?gameId=${encodeURIComponent(gameId)}`,
          SessionEnvelopeSchema,
        );
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
      }
    },
    start: (gameId, options) =>
      api.post(
        "v1/sessions",
        options === undefined ? { gameId } : { gameId, options },
        SessionEnvelopeSchema,
      ),
    apply: (id, request) => api.post(`${session(id)}/actions`, request, SessionEnvelopeSchema),
    undo: (id, request) => api.post(`${session(id)}/undo`, request, SessionEnvelopeSchema),
    hint: (id) => api.get(`${session(id)}/hint`, HintResponseSchema),
    abandon: (id, request) => api.post(`${session(id)}/abandon`, request, SessionEnvelopeSchema),
  };
}

/** The action decider routes of action-decision.md section 4. */
export function createLiveDecisionService(api: ApiClient): DecisionService {
  return {
    decide: (request) => api.post("v1/decisions", request, DecisionResponseSchema),
    resolve: (decisionId, request) =>
      api.post(
        `v1/decisions/${encodeURIComponent(decisionId)}/resolution`,
        request,
        ResolutionResponseSchema,
      ),
  };
}

/** `GET /v1/players/me/stats` (authn-authz.md section 5). */
export function createLiveStatsService(api: ApiClient): StatsService {
  return { list: () => api.get("v1/players/me/stats", StatsResponseSchema) };
}
