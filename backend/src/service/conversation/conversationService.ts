import type { ConversationMessageDao } from "../../dao/conversationMessage/conversationMessageDao";
import type { ConversationMessage, ConversationRole } from "../../models/conversationMessage";
import { newUlid } from "../gameSession/ulid";
import type { Personality } from "./personality";

const RETENTION_SECONDS = 90 * 24 * 60 * 60;
const REFRESH_AFTER_SECONDS = 24 * 60 * 60;

export interface ConversationEntry {
  role: ConversationRole;
  text: string;
  decisionId?: string;
  actionId?: string;
  sessionVersion?: number;
}

export interface ConversationServiceDeps {
  dao: ConversationMessageDao;
  personality: Personality;
  /** Told about a storage failure, which never fails the player's turn. */
  onError: (error: unknown) => void;
  now?: () => Date;
  newId?: (timeMs: number) => string;
}

/** A session's stored conversation (conversational-ai.md section 6). */
export interface ConversationService {
  readonly personality: Personality;
  /** The whole conversation, or nothing when storage cannot answer. */
  history(sessionId: string): Promise<ConversationMessage[]>;
  /** Appends messages in order; `known` is the history already read this turn. */
  record(
    sessionId: string,
    entries: readonly ConversationEntry[],
    known: readonly ConversationMessage[],
  ): Promise<void>;
}

export function createConversationService(deps: ConversationServiceDeps): ConversationService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? ((timeMs: number) => newUlid(timeMs));
  return {
    personality: deps.personality,
    history: async (sessionId) => {
      try {
        return await deps.dao.list(sessionId);
      } catch (error) {
        deps.onError(error);
        return [];
      }
    },
    record: async (sessionId, entries, known) => {
      const at = now();
      const stamp = at.toISOString();
      const ttl = Math.floor(at.getTime() / 1000) + RETENTION_SECONDS;
      try {
        for (const [index, entry] of entries.entries()) {
          /* Each entry takes the next millisecond, so a turn's messages keep their order. */
          await deps.dao.append({
            ...entry,
            sessionId,
            messageId: newId(at.getTime() + index),
            ttl,
            entityVersion: 1,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }
        const last = known.at(-1)?.ttl;
        if (last !== undefined && ttl - last >= REFRESH_AFTER_SECONDS)
          await deps.dao.refreshTtl(sessionId, ttl, stamp);
      } catch (error) {
        deps.onError(error);
      }
    },
  };
}
