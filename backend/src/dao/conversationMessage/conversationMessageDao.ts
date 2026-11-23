import type { ConversationMessage } from "../../models/conversationMessage";

/** ConversationMessage persistence (conversational-ai.md section 6). */
export interface ConversationMessageDao {
  append(message: ConversationMessage): Promise<void>;
  /** The whole conversation, oldest first, from one logical query. */
  list(sessionId: string): Promise<ConversationMessage[]>;
  /** Moves every message's expiry, so a conversation expires as a whole. */
  refreshTtl(sessionId: string, ttl: number, updatedAt: string): Promise<void>;
  deleteAll(sessionId: string): Promise<void>;
}
