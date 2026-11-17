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
}

/** Loads the player's game, starting one when none is in progress (direct links such as /spider). */
export function useGameSession(gameId: string): UseGameSession {
  const { sessions } = useServices();
  const { game, updateGame } = usePreferences(gameId);
  const queryClient = useQueryClient();
  const key = ["session", gameId];
  const [message, setMessage] = useState<string | null>(null);
  const [hintAction, setHintAction] = useState<LegalAction | null>(null);

  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await sessions.current(gameId)) ?? sessions.start(gameId, game.lastOptions ?? undefined),
    staleTime: Infinity,
  });
  const envelope = query.data;

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
      const chosen = options ?? game.lastOptions ?? undefined;
      if (options !== undefined) updateGame({ lastOptions: options });
      await perform(() => sessions.start(gameId, chosen));
    },
  };
}
