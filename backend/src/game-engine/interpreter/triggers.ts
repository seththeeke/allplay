import { EngineInvariantError } from "../errors";
import { changeVar, runEffect, type MutationContext } from "../primitives/effects";
import { holds } from "../primitives/expressions";
import { zonesOfType } from "../primitives/layout";
import { TRIGGER_PASS_LIMIT, type Engine } from "./engine";

/**
 * Runs triggers to a fixed point (game-engine.md section 4.8): full passes in
 * declaration order until a pass changes nothing.
 */
export function settleTriggers(engine: Engine, ctx: MutationContext): void {
  for (let pass = 0; pass < TRIGGER_PASS_LIMIT; pass += 1) {
    let fired = false;
    for (const trigger of engine.rules.triggers) {
      const zones =
        trigger.forEach === undefined ? [null] : zonesOfType(engine.layout, trigger.forEach.type);
      for (const zoneId of zones) {
        const refs =
          trigger.forEach === undefined || zoneId === null
            ? ctx.refs
            : { [trigger.forEach.as]: zoneId };
        const scoped = { ...ctx, refs };
        if (!holds(trigger.when, scoped)) continue;
        for (const effect of trigger.effects) runEffect(effect, scoped);
        changeVar(ctx, "score", trigger.score);
        fired = true;
      }
    }
    if (!fired) return;
  }
  throw new EngineInvariantError(
    `Triggers did not settle within ${String(TRIGGER_PASS_LIMIT)} passes`,
  );
}

/** Applies the first matching end condition (section 4.9); callers only pass in-progress games. */
export function evaluateEndConditions(engine: Engine, ctx: MutationContext): void {
  const ended = engine.rules.endConditions.find((condition) => holds(condition.when, ctx));
  if (ended === undefined) return;
  ctx.state.status = ended.status;
  ctx.events.push({
    type: ended.status === "WON" ? "GAME_WON" : "GAME_LOST",
    data: {},
    speech: null,
  });
}
