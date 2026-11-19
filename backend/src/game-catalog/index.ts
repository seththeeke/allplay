import {
  compileRules,
  type CompiledGame,
  type GameCatalogEntry,
  type RulesDocument,
} from "../game-engine";
import spiderSolitaireV1 from "./spider-solitaire/rules.v1.json";

/** Where the session service gets rules (game-engine.md section 3). */
export interface RulesRepository {
  get(gameId: string, version: number): Promise<RulesDocument>;
  latest(gameId: string): Promise<RulesDocument>;
  list(): Promise<GameCatalogEntry[]>;
}

export class UnknownGameError extends Error {
  override readonly name = "UnknownGameError";
}

/** Every bundled rules document, by game id, oldest version first. Released versions are never edited. */
const BUNDLED: Readonly<Record<string, readonly unknown[]>> = {
  "spider-solitaire": [spiderSolitaireV1],
};

/**
 * Core games compiled once per container from the bundled JSON files. A
 * document that fails validation fails here, at load, not mid-game.
 */
export function createBundledRulesRepository(
  bundled: Readonly<Record<string, readonly unknown[]>> = BUNDLED,
): RulesRepository & {
  compiled(gameId: string, version?: number): CompiledGame;
} {
  const games = new Map<string, CompiledGame[]>(
    Object.entries(bundled).map(([gameId, docs]) => [gameId, docs.map((doc) => compileRules(doc))]),
  );
  const docs = new Map<string, RulesDocument[]>(
    Object.entries(bundled).map(([gameId, list]) => [gameId, list as RulesDocument[]]),
  );
  const compiled = (gameId: string, version?: number): CompiledGame => {
    const versions = games.get(gameId) ?? [];
    const game =
      version === undefined ? versions.at(-1) : versions.find((g) => g.rulesVersion === version);
    if (game === undefined) throw new UnknownGameError(`${gameId} v${String(version ?? "latest")}`);
    return game;
  };
  const doc = (gameId: string, version?: number): Promise<RulesDocument> => {
    const game = compiled(gameId, version);
    return Promise.resolve(
      (docs.get(gameId) ?? []).find((d) => d.version === game.rulesVersion) as RulesDocument,
    );
  };
  return {
    compiled,
    get: (gameId, version) => doc(gameId, version),
    latest: (gameId) => doc(gameId),
    list: () => Promise.resolve([...games.keys()].map((gameId) => compiled(gameId).catalogEntry)),
  };
}
