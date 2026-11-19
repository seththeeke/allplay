import { gunzipSync, gzipSync } from "node:zlib";
import type { GameState } from "../../game-engine";

/** Engine state is stored gzip-compressed JSON (data-model.md section 6). */
export function encodeGameState(state: GameState): Uint8Array {
  return new Uint8Array(gzipSync(JSON.stringify(state)));
}

export function decodeGameState(bytes: Uint8Array): GameState {
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as GameState;
}
