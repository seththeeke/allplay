import { readFileSync } from "node:fs";
import { z } from "zod";

/** A recorded playthrough: options and seed fix the deal; the actions are the player's choices. */
export const ScenarioSchema = z.object({
  name: z.string().min(1),
  options: z.record(z.string(), z.union([z.string(), z.number()])),
  seed: z.string().regex(/^[0-9a-f]{32}$/),
  actions: z.array(z.string().min(1)),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export function loadScenario(file: string): Scenario {
  return ScenarioSchema.parse(
    JSON.parse(readFileSync(new URL(`./scenarios/${file}`, import.meta.url), "utf8")),
  );
}
