import type { SpiderState } from "../test-data/spider/simulator";
import { createServices } from "../src/services/createServices";
import { createMemoryStore } from "../src/services/memory/memoryStore";
import type { Services } from "../src/services/types";
import { must } from "./must";
import { LOCAL_CONFIG } from "./renderApp";

const KEY = "allplay.memory.session.spider-solitaire";

/** Services with a started game where two sevens can each go onto an eight, so "the seven onto the eight" is ambiguous. */
export async function ambiguousServices(): Promise<Services> {
  const store = createMemoryStore(null);
  const services = createServices(LOCAL_CONFIG, store, () => 7);
  await services.sessions.start("spider-solitaire");
  const stored = store.read<{ state: SpiderState }>(KEY, null as never);
  const cards = Object.values(stored.state.cards);
  const sevens = cards.filter((card) => card.rank === 7).slice(0, 2);
  const eight = must(cards.find((card) => card.rank === 8));
  const placed = [...sevens, eight];
  for (const card of placed) card.faceUp = true;
  const used = new Set(placed.map((card) => card.id));
  for (const zoneId of Object.keys(stored.state.zones)) {
    stored.state.zones[zoneId] = (stored.state.zones[zoneId] ?? []).filter((id) => !used.has(id));
  }
  stored.state.zones["tableau.1"]?.push(must(sevens[0]).id);
  stored.state.zones["tableau.2"]?.push(must(sevens[1]).id);
  stored.state.zones["tableau.3"]?.push(eight.id);
  store.write(KEY, stored);
  return services;
}
