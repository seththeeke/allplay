import {
  compileRules,
  type CompiledGame,
  type GameCatalogEntry,
  type RulesDocument,
} from "../game-engine";
import { GameTileSchema, type GameTile } from "../models/api/game";
import spiderSolitaireV1 from "./spider-solitaire/rules.v1.json";
import spiderSolitaireTiles from "./spider-solitaire/tiles.json";

/** Where the session service gets rules (game-engine.md section 3). */
export interface RulesRepository {
  get(gameId: string, version: number): Promise<RulesDocument>;
  latest(gameId: string): Promise<RulesDocument>;
  list(): Promise<CatalogEntry[]>;
}

/** A catalog entry with the home tiles that start it (productionalization.md section 6). */
export type CatalogEntry = GameCatalogEntry & { tiles: GameTile[] };

export class UnknownGameError extends Error {
  override readonly name = "UnknownGameError";
}

/** Every bundled rules document, by game id, oldest version first. Released versions are never edited. */
const BUNDLED: Readonly<Record<string, readonly unknown[]>> = {
  "spider-solitaire": [spiderSolitaireV1],
};

/** Home tiles by game id; released rules documents are never edited, so tiles live beside them. */
const BUNDLED_TILES: Readonly<Record<string, unknown>> = {
  "spider-solitaire": spiderSolitaireTiles,
};

/**
 * A game's tiles, or one tile from its rules document when it has none. Each
 * tile's options must start a game, so a bad tile fails at load.
 */
function tilesOf(game: CompiledGame, raw: unknown): GameTile[] {
  const entry = game.catalogEntry;
  if (raw === undefined)
    return [{ path: entry.path, name: entry.name, description: entry.description, options: {} }];
  const tiles = GameTileSchema.array().min(1).parse(raw);
  for (const tile of tiles)
    game.createGame({ options: tile.options, seed: "0".repeat(32), seats: ["S1"] });
  return tiles;
}

/**
 * Core games compiled once per container from the bundled JSON files. A
 * document that fails validation fails here, at load, not mid-game.
 */
export function createBundledRulesRepository(
  bundled: Readonly<Record<string, readonly unknown[]>> = BUNDLED,
  bundledTiles: Readonly<Record<string, unknown>> = BUNDLED_TILES,
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
  const doc = (gameId: string, version?: number): Promise<RulesDocument> =>
    new Promise((resolve) => {
      const game = compiled(gameId, version);
      resolve(
        (docs.get(gameId) as RulesDocument[]).find(
          (d) => d.version === game.rulesVersion,
        ) as RulesDocument,
      );
    });
  const catalog: CatalogEntry[] = [...games.keys()].map((gameId) => ({
    ...compiled(gameId).catalogEntry,
    tiles: tilesOf(compiled(gameId), bundledTiles[gameId]),
  }));
  return {
    compiled,
    get: (gameId, version) => doc(gameId, version),
    latest: (gameId) => doc(gameId),
    list: () => Promise.resolve(catalog),
  };
}
