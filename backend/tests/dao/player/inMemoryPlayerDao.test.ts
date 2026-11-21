import { describe } from "vitest";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import { playerDaoContract } from "./playerDaoContract";

describe("InMemoryPlayerDao", () => {
  playerDaoContract(createInMemoryPlayerDao, (name) => `memory-${name}`);
});
