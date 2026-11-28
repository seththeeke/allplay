import { describe, expect, it } from "vitest";
import { createInMemoryRolePolicyStore } from "../../../src/dao/rolePolicy/inMemoryRolePolicyStore";
import { createIamRolePolicyStore } from "../../../src/dao/rolePolicy/rolePolicyStore";

function stubIam(...replies: (object | Error)[]) {
  const sent: { command: string; input: Record<string, unknown> }[] = [];
  return {
    sent,
    send: (command: object) => {
      sent.push({
        command: command.constructor.name,
        input: (command as { input: Record<string, unknown> }).input,
      });
      const reply = replies.shift() ?? {};
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
}

function named(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe("IAM role policy store", () => {
  it("puts an inline policy as JSON and removes it", async () => {
    const stub = stubIam();
    const store = createIamRolePolicyStore(stub);
    await store.put("AllPlay-GuestRole-Test", "AllPlay-AndonDeny", { Version: "2012-10-17" });
    await store.remove("AllPlay-GuestRole-Test", "AllPlay-AndonDeny");
    expect(stub.sent).toEqual([
      {
        command: "PutRolePolicyCommand",
        input: {
          RoleName: "AllPlay-GuestRole-Test",
          PolicyName: "AllPlay-AndonDeny",
          PolicyDocument: '{"Version":"2012-10-17"}',
        },
      },
      {
        command: "DeleteRolePolicyCommand",
        input: { RoleName: "AllPlay-GuestRole-Test", PolicyName: "AllPlay-AndonDeny" },
      },
    ]);
  });

  it("treats a policy already gone as removed, and rethrows other failures", async () => {
    const store = createIamRolePolicyStore(
      stubIam(named("NoSuchEntityException"), named("AccessDenied")),
    );
    await store.remove("r", "p");
    await expect(store.remove("r", "p")).rejects.toThrow("AccessDenied");
  });

  it("defaults to the IAM client", () => {
    expect(createIamRolePolicyStore()).toHaveProperty("put");
  });
});

describe("in-memory role policy store", () => {
  it("keeps policies by role and name", async () => {
    const store = createInMemoryRolePolicyStore();
    await store.put("r", "p", { a: 1 });
    expect(store.policies.get("r/p")).toEqual({ a: 1 });
    await store.remove("r", "p");
    expect(store.policies.size).toBe(0);
  });
});
