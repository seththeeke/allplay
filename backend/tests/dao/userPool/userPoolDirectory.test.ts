import { describe, expect, it } from "vitest";
import { createUserPoolDirectory, providersOf } from "../../../src/dao/userPool/userPoolDirectory";

function stub(...replies: object[]) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  return {
    sent,
    client: {
      send: (command: object) => {
        sent.push({
          name: command.constructor.name,
          input: (command as { input: Record<string, unknown> }).input,
        });
        return Promise.resolve(replies.shift() ?? {});
      },
    },
  };
}

const user = (
  username: string,
  email: string,
  extra: Record<string, string> = {},
  created = 1,
) => ({
  Username: username,
  UserCreateDate: new Date(created),
  Attributes: [
    { Name: "email", Value: email },
    ...Object.entries(extra).map(([Name, Value]) => ({ Name, Value })),
  ],
});

describe("UserPoolDirectory", () => {
  it("finds users by email across spellings and pages, oldest first", async () => {
    const { client, sent } = stub(
      {
        Users: [user("b", "Pat@Example.com", { email_verified: "true" }, 2), { Attributes: [] }],
        PaginationToken: "next",
      },
      {
        Users: [
          user(
            "a",
            "pat@example.com",
            { identities: JSON.stringify([{ providerName: "Google", userId: "g1" }]) },
            1,
          ),
          user("c", "other@example.com"),
        ],
      },
      { Users: [user("b", "pat@example.com", { email_verified: "true" }, 2)] },
    );
    const users = await createUserPoolDirectory(client).usersByEmail("pool", " Pat@Example.com ");
    expect(users).toEqual([
      { username: "a", emailVerified: false, providers: ["Google"], createdAt: 1 },
      { username: "b", emailVerified: true, providers: [], createdAt: 2 },
    ]);
    expect(sent[0]?.input).toMatchObject({
      UserPoolId: "pool",
      Filter: 'email = "Pat@Example.com"',
    });
    expect(sent[1]?.input).toMatchObject({ PaginationToken: "next" });
    expect(sent[2]?.input).toMatchObject({ Filter: 'email = "pat@example.com"' });
    const quoted = stub({}, {});
    await createUserPoolDirectory(quoted.client).usersByEmail("pool", 'a"b\\c@example.com');
    expect(quoted.sent[0]?.input["Filter"]).toBe('email = "a\\"b\\\\c@example.com"');
    const noDate = stub({
      Users: [{ Username: "x", Attributes: [{ Name: "email", Value: "x@e.com" }] }],
    });
    expect(
      (await createUserPoolDirectory(noDate.client).usersByEmail("pool", "x@e.com"))[0]?.createdAt,
    ).toBe(0);
  });

  it("links a provider identity and adds users to groups", async () => {
    const { client, sent } = stub({}, {});
    const directory = createUserPoolDirectory(client);
    await directory.linkProvider("pool", "dest", "Google", "g1");
    await directory.addToGroup("pool", "dest", "PLAYER");
    expect(sent[0]).toEqual({
      name: "AdminLinkProviderForUserCommand",
      input: {
        UserPoolId: "pool",
        DestinationUser: { ProviderName: "Cognito", ProviderAttributeValue: "dest" },
        SourceUser: {
          ProviderName: "Google",
          ProviderAttributeName: "Cognito_Subject",
          ProviderAttributeValue: "g1",
        },
      },
    });
    expect(sent[1]).toEqual({
      name: "AdminAddUserToGroupCommand",
      input: { UserPoolId: "pool", Username: "dest", GroupName: "PLAYER" },
    });
    expect(typeof createUserPoolDirectory().addToGroup).toBe("function");
  });

  it("creates an invited user with a verified email and an emailed temporary password", async () => {
    const { client, sent } = stub({ User: { Username: "u-1" } }, {});
    const directory = createUserPoolDirectory(client);
    expect(await directory.createUser("pool", "pat@example.com")).toBe("u-1");
    expect(await directory.createUser("pool", "sam@example.com")).toBe("sam@example.com");
    expect(sent[0]).toEqual({
      name: "AdminCreateUserCommand",
      input: {
        UserPoolId: "pool",
        Username: "pat@example.com",
        UserAttributes: [
          { Name: "email", Value: "pat@example.com" },
          { Name: "email_verified", Value: "true" },
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      },
    });
  });

  it("finds a username by sub and deletes users", async () => {
    const { client, sent } = stub({ Users: [{ Username: "Google_1" }] }, {}, {});
    const directory = createUserPoolDirectory(client);
    expect(await directory.usernameBySub("pool", 'sub-"1')).toBe("Google_1");
    expect(sent[0]?.input).toEqual({ UserPoolId: "pool", Filter: 'sub = "sub-1"', Limit: 1 });
    expect(await directory.usernameBySub("pool", "none")).toBeNull();
    await directory.deleteUser("pool", "Google_1");
    expect(sent[2]).toEqual({
      name: "AdminDeleteUserCommand",
      input: { UserPoolId: "pool", Username: "Google_1" },
    });
  });

  it("signs a user out everywhere and finds a sub by username", async () => {
    const { client, sent } = stub(
      {},
      { UserAttributes: [{ Name: "email" }, { Name: "sub", Value: "s-1" }] },
      {},
    );
    const directory = createUserPoolDirectory(client);
    await directory.globalSignOut("pool", "u");
    expect(sent[0]).toEqual({
      name: "AdminUserGlobalSignOutCommand",
      input: { UserPoolId: "pool", Username: "u" },
    });
    expect(await directory.subOfUsername("pool", "u")).toBe("s-1");
    expect(await directory.subOfUsername("pool", "u")).toBeNull();
    const missing = createUserPoolDirectory({
      send: () =>
        Promise.reject(Object.assign(new Error("no user"), { name: "UserNotFoundException" })),
    });
    expect(await missing.subOfUsername("pool", "x")).toBeNull();
    const failing = createUserPoolDirectory({ send: () => Promise.reject(new Error("throttled")) });
    await expect(failing.subOfUsername("pool", "x")).rejects.toThrow("throttled");
  });

  it("reads a user's linked identities", async () => {
    const { client, sent } = stub(
      {
        UserAttributes: [
          { Name: "identities", Value: '[{"providerName":"Google","userId":"g-1"}]' },
        ],
      },
      {},
    );
    const directory = createUserPoolDirectory(client);
    expect(await directory.identitiesOf("pool", "Google_g-1")).toEqual([
      { providerName: "Google", userId: "g-1" },
    ]);
    expect(sent[0]).toEqual({
      name: "AdminGetUserCommand",
      input: { UserPoolId: "pool", Username: "Google_g-1" },
    });
    expect(await directory.identitiesOf("pool", "native")).toEqual([]);
  });

  it("reads the identities attribute defensively", () => {
    expect(providersOf(undefined)).toEqual([]);
    expect(providersOf("")).toEqual([]);
    expect(providersOf("not json")).toEqual([]);
    expect(providersOf('{"a":1}')).toEqual([]);
    expect(providersOf('[{"providerName":"Google","userId":"1"},{"providerName":5}]')).toEqual([
      { providerName: "Google", userId: "1" },
    ]);
  });
});
