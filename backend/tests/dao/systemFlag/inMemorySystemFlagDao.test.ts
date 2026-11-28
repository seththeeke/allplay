import { describe, expect, it } from "vitest";
import { createInMemorySystemFlagDao } from "../../../src/dao/systemFlag/inMemorySystemFlagDao";
import { systemFlagDaoContract } from "./systemFlagDaoContract";

describe("InMemorySystemFlagDao", () => {
  systemFlagDaoContract(createInMemorySystemFlagDao);

  it("reads a flag never written as null", async () => {
    expect(await createInMemorySystemFlagDao().get("ANDON")).toBeNull();
  });
});
