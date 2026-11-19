import { describe } from "vitest";
import { createInMemoryGameSessionDao } from "../../../src/dao/gameSession/inMemoryGameSessionDao";
import { gameSessionDaoContract } from "./gameSessionDaoContract";

describe("InMemoryGameSessionDao", () => {
  gameSessionDaoContract(createInMemoryGameSessionDao);
});
