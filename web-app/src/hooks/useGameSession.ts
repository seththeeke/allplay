import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ActionSource, GameOptions, LegalAction, SessionEnvelope } from "../models/api";
import { ApiRequestError } from "../services/errors";
import { usePreferences } from "./usePreferences";
import { useServices } from "./useServices";

export interface UseGameSession {
  envelope: SessionEnvelope | undefined;
  /** The latest hint or error message, announced to assistive technology. */
  message: string | null;
  hintAction: LegalAction | null;
  apply: (actionId: string, source: ActionSource) => Promise<void>;
  undo: (source: ActionSource) => Promise<void>;
  requestHint: () => Promise<void>;
  newGame: (options?: GameOptions) => Promise<void>;
  /** Shows a message in the game's announcement line. */
  announce: (message: string) => void;
  /** Replaces the cached envelope, for example with one returned by the action decider. */
  replace: (envelope: SessionEnvelope) => void;
  /** Why no game could be dealt, such as a reached game limit (productionalization.md section 5). */
  blocked: string | null;
  /** True when the game in progress has other options than the tile opened (productionalization.md section 6). */
  otherOptions: boolean;
}

/** True when every option the tile fixes has that value in the session. */
export function optionsMatch(session: GameOptions, wanted: GameOptions): boolean {
  return Object.entries(wanted).every(([name, value]) => session[name] === value);
}

/** Loads the player's game, starting one when none is in progress (direct links such as /spider). */
export function useGameSession(gameId: string, tileOptions?: GameOptions): UseGameSession {
  const { sessions } = useServices();
  const { game, updateGame } = usePreferences(gameId);
  const queryClient = useQueryClient();
  const key = ["session", gameId];
  const [message, setMessage] = useState<string | null>(null);
  const [hintAction, setHintAction] = useState<LegalAction | null>(null);

  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await sessions.current(gameId)) ??
      sessions.start(gameId, tileOptions ?? game.lastOptions ?? undefined),
    staleTime: Infinity,
    /* A refusal such as a reached game limit will not change on a retry; network and server faults may. */
    retry: (failures, error) =>
      failures < 3 && !(error instanceof ApiRequestError && error.status < 500),
  });
  const envelope = query.data;
  const blocked =
    query.error instanceof ApiRequestError && query.error.body.code === "GAME_LIMIT_REACHED"
      ? query.error.body.message
      : null;

  const replace = (next: SessionEnvelope): void => {
    queryClient.setQueryData(key, next);
    setHintAction(null);
  };

  const run = useMutation({
    mutationFn: (work: () => Promise<SessionEnvelope>) => work(),
    onSuccess: (next) => {
      replace(next);
      setMessage(null);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        if (error.body.current !== undefined) replace(error.body.current);
        setMessage(error.body.message);
      } else {
        setMessage("Something went wrong. Please try again.");
      }
    },
  });
  const perform = async (work: () => Promise<SessionEnvelope>): Promise<void> => {
    await run.mutateAsync(work).catch(() => undefined);
  };

  return {
    envelope,
    blocked,
    otherOptions:
      envelope !== undefined &&
      tileOptions !== undefined &&
      !optionsMatch(envelope.session.options, tileOptions),
    message,
    hintAction,
    replace,
    announce: setMessage,
    apply: (actionId, source) =>
      envelope === undefined
        ? Promise.resolve()
        : perform(() =>
            sessions.apply(envelope.session.sessionId, {
              actionId,
              expectedVersion: envelope.session.version,
              source,
            }),
          ),
    undo: (source) =>
      envelope === undefined
        ? Promise.resolve()
        : perform(() =>
            sessions.undo(envelope.session.sessionId, {
              expectedVersion: envelope.session.version,
              source,
            }),
          ),
    requestHint: async () => {
      if (envelope === undefined) return;
      const hint = await sessions.hint(envelope.session.sessionId);
      setHintAction(hint.action);
      setMessage(hint.text);
    },
    newGame: async (options) => {
      const chosen = options ?? tileOptions ?? game.lastOptions ?? undefined;
      if (options !== undefined) updateGame({ lastOptions: options });
      await perform(() => sessions.start(gameId, chosen));
      /* A start counts against the player's games, which the player query reports. */
      await queryClient.invalidateQueries({ queryKey: ["player"] });
    },
  };
}
