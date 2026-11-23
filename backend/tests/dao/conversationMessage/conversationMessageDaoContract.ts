import { expect, it } from "vitest";
import type { ConversationMessageDao } from "../../../src/dao/conversationMessage/conversationMessageDao";
import type { ConversationMessage } from "../../../src/models/conversationMessage";

const AT = "2026-11-22T10:00:00.000Z";

export const conversationMessage = (
  sessionId: string,
  messageId: string,
  extra: Partial<ConversationMessage> = {},
): ConversationMessage => ({
  sessionId,
  messageId,
  role: "PLAYER",
  text: "move eight to seven, dinner's ready",
  ttl: 1800000000,
  entityVersion: 1,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

/** The behavior every ConversationMessageDao must have (conversational-ai.md section 6). */
export function conversationMessageDaoContract(
  create: () => ConversationMessageDao,
  id: (name: string) => string = (name) => name,
): void {
  it("returns one session's whole conversation in message order", async () => {
    const dao = create();
    const session = id("ordered");
    await dao.append(conversationMessage(session, "01B", { role: "SPEAKER", text: "Done." }));
    await dao.append(conversationMessage(session, "01A"));
    await dao.append(conversationMessage(id("other"), "01C"));
    expect((await dao.list(session)).map((message) => message.messageId)).toEqual(["01A", "01B"]);
    expect(await dao.list(id("nobody"))).toEqual([]);
  });

  it("moves every message's expiry together", async () => {
    const dao = create();
    const session = id("expiry");
    await dao.append(conversationMessage(session, "01A"));
    await dao.append(conversationMessage(session, "01B"));
    await dao.refreshTtl(session, 1900000000, "2026-11-23T10:00:00.000Z");
    const messages = await dao.list(session);
    expect(messages.map((message) => message.ttl)).toEqual([1900000000, 1900000000]);
    expect(messages[0]?.updatedAt).toBe("2026-11-23T10:00:00.000Z");
    await dao.refreshTtl(id("nobody"), 1900000000, AT);
    expect(await dao.list(id("nobody"))).toEqual([]);
  });

  it("deletes one session's conversation, past one write batch", async () => {
    const dao = create();
    const session = id("deleted");
    const kept = id("kept");
    for (let index = 0; index < 30; index += 1)
      await dao.append(conversationMessage(session, `01${String(index).padStart(3, "0")}`));
    await dao.append(conversationMessage(kept, "01A"));
    await dao.deleteAll(session);
    expect(await dao.list(session)).toEqual([]);
    expect(await dao.list(kept)).toHaveLength(1);
    await dao.deleteAll(kept);
  });
}
