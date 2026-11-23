import { describe, expect, it, vi } from "vitest";
import type { ConversationMessageDao } from "../../../src/dao/conversationMessage/conversationMessageDao";
import { createInMemoryConversationMessageDao } from "../../../src/dao/conversationMessage/inMemoryConversationMessageDao";
import { createConversationService } from "../../../src/service/conversation/conversationService";
import { loadPersonality } from "../../../src/service/conversation/personality";

const personality = loadPersonality({});
const DAY = 86_400;
const at = (day: number) => new Date(Date.UTC(2026, 10, day, 12));
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

function setup(dao: ConversationMessageDao = createInMemoryConversationMessageDao()) {
  let now = at(1);
  const onError = vi.fn();
  const service = createConversationService({
    dao,
    personality,
    onError,
    now: () => now,
    newId: (time) => String(time),
  });
  return {
    service,
    dao,
    onError,
    move: (date: Date) => {
      now = date;
    },
  };
}

describe("conversation service", () => {
  it("records a turn in order with a 90 day expiry", async () => {
    const { service } = setup();
    await service.record(
      "s",
      [
        { role: "PLAYER", text: "move 8 to 7, dinner's ready" },
        { role: "ACTION", text: "Move", actionId: "A", sessionVersion: 2 },
        { role: "SPEAKER", text: "Done." },
      ],
      [],
    );
    const messages = await service.history("s");
    expect(messages.map((message) => message.role)).toEqual(["PLAYER", "ACTION", "SPEAKER"]);
    expect(messages[0]?.text).toBe("move 8 to 7, dinner's ready");
    expect(messages[0]?.ttl).toBe(seconds(at(1)) + 90 * DAY);
  });

  it("moves the whole conversation's expiry once a day has passed", async () => {
    const { service, move } = setup();
    await service.record("s", [{ role: "PLAYER", text: "first" }], []);
    move(new Date(at(1).getTime() + 3_600_000));
    await service.record("s", [{ role: "PLAYER", text: "same day" }], await service.history("s"));
    expect((await service.history("s"))[0]?.ttl).toBe(seconds(at(1)) + 90 * DAY);
    move(at(3));
    await service.record("s", [{ role: "PLAYER", text: "later" }], await service.history("s"));
    const ttls = (await service.history("s")).map((message) => message.ttl);
    expect(new Set(ttls)).toEqual(new Set([seconds(at(3)) + 90 * DAY]));
  });

  it("never fails a turn when storage fails", async () => {
    const broken: ConversationMessageDao = {
      append: () => Promise.reject(new Error("down")),
      list: () => Promise.reject(new Error("down")),
      refreshTtl: () => Promise.reject(new Error("down")),
      deleteAll: () => Promise.reject(new Error("down")),
    };
    const { service, onError } = setup(broken);
    expect(await service.history("s")).toEqual([]);
    await service.record("s", [{ role: "PLAYER", text: "hello" }], []);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("makes real sortable ids and uses the clock by default", async () => {
    const service = createConversationService({
      dao: createInMemoryConversationMessageDao(),
      personality,
      onError: vi.fn(),
    });
    await service.record(
      "s",
      [
        { role: "PLAYER", text: "one" },
        { role: "SPEAKER", text: "two" },
      ],
      [],
    );
    expect((await service.history("s")).map((message) => message.text)).toEqual(["one", "two"]);
  });
});
