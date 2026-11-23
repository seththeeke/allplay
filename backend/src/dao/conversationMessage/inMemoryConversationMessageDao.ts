import type { ConversationMessage } from "../../models/conversationMessage";
import type { ConversationMessageDao } from "./conversationMessageDao";

/** ConversationMessageDao over a map, ordered by message id as the table's sort key is. */
export function createInMemoryConversationMessageDao(
  items: Map<string, ConversationMessage[]> = new Map(),
): ConversationMessageDao {
  return {
    append: (message) => {
      const others = (items.get(message.sessionId) ?? []).filter(
        (item) => item.messageId !== message.messageId,
      );
      items.set(
        message.sessionId,
        [...others, message].sort((a, b) => a.messageId.localeCompare(b.messageId)),
      );
      return Promise.resolve();
    },
    list: (sessionId) => Promise.resolve([...(items.get(sessionId) ?? [])]),
    refreshTtl: (sessionId, ttl, updatedAt) => {
      const current = items.get(sessionId);
      if (current !== undefined)
        items.set(
          sessionId,
          current.map((item) => ({ ...item, ttl, updatedAt })),
        );
      return Promise.resolve();
    },
    deleteAll: (sessionId) => {
      items.delete(sessionId);
      return Promise.resolve();
    },
  };
}
