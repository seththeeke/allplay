import { CATALOG } from "../../../test-data/games";
import { GamesResponseSchema } from "../../models/api";
import type { GameService } from "../types";

export function createMemoryGameService(): GameService {
  return { list: () => Promise.resolve(GamesResponseSchema.parse(CATALOG)) };
}
