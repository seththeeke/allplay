import { z } from "zod";

/** Who a conversation message came from (conversational-ai.md section 6). */
export const ConversationRoleSchema = z.enum(["PLAYER", "SPEAKER", "ACTION"]);
export type ConversationRole = z.infer<typeof ConversationRoleSchema>;

/**
 * One message of a session's conversation. It carries no player id: access is
 * checked through the session's seats, so a guest merge leaves it unchanged.
 */
export const ConversationMessageSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  role: ConversationRoleSchema,
  text: z.string().min(1),
  decisionId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  sessionVersion: z.number().int().min(0).optional(),
  ttl: z.number().int(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
