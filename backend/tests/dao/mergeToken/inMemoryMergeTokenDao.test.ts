import { createHash } from "node:crypto";
import { describe } from "vitest";
import { createInMemoryMergeTokenDao } from "../../../src/dao/mergeToken/inMemoryMergeTokenDao";
import { mergeTokenDaoContract } from "./mergeTokenDaoContract";

describe("InMemoryMergeTokenDao", () => {
  mergeTokenDaoContract(
    createInMemoryMergeTokenDao,
    (name) => createHash("sha256").update(name).digest("hex"),
    (name) => `memory-${name}`,
  );
});
