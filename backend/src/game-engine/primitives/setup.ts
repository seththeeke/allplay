import { EngineInvariantError } from "../errors";
import { shuffle, type Random } from "../random/xoshiro";
import type { CopySpec, RulesDocument, SetupStep } from "../rules/schema";
import { evaluate, holds, zoneOf, type EvalContext } from "./expressions";
import { zonesOfType } from "./layout";

const ALL_RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** The copy specs of a card set, resolving an option switch (game-engine.md section 4.3). */
export function copySpecs(
  cardSet: RulesDocument["cardSets"][number],
  options: Readonly<Record<string, unknown>>,
): CopySpec[] {
  const { copies } = cardSet;
  if (Array.isArray(copies)) return copies;
  /* Static checks guarantee a case for every option value. */
  return copies.cases[String(options[copies.switch.option])] as CopySpec[];
}

function createCards(specs: CopySpec[], into: string, faceUp: boolean, ctx: EvalContext): void {
  const target = ctx.state.zones[into] as string[];
  for (const spec of specs) {
    const ranks = spec.ranks === "A-K" ? ALL_RANKS : spec.ranks;
    for (let copy = 0; copy < spec.times; copy += 1) {
      for (const suit of spec.suits) {
        for (const rank of ranks) {
          const cardId = `c${String(Object.keys(ctx.state.cards).length)}`;
          ctx.state.cards[cardId] = { suit, rank, faceUp };
          target.push(cardId);
        }
      }
    }
  }
}

function dealRows(
  spec: Extract<SetupStep, { dealRows: unknown }>["dealRows"],
  ctx: EvalContext,
): void {
  const source = ctx.state.zones[zoneOf(spec.from, ctx)] as string[];
  const targets = zonesOfType(ctx.layout, spec.type);
  const remaining = targets.map((_, i) => spec.counts[i] ?? 0);
  while (remaining.some((count) => count > 0)) {
    targets.forEach((zoneId, i) => {
      if (remaining[i] === 0) return;
      const cardId = source.pop();
      if (cardId === undefined)
        throw new EngineInvariantError(`Not enough cards to deal to ${spec.type}`);
      (ctx.state.cards[cardId] as { faceUp: boolean }).faceUp = spec.faceUp;
      (ctx.state.zones[zoneId] as string[]).push(cardId);
      remaining[i] = (remaining[i] as number) - 1;
    });
  }
}

/** Runs one setup step when its `when` holds (game-engine.md section 4.6). */
export function runSetupStep(
  step: SetupStep,
  rules: RulesDocument,
  random: Random,
  ctx: EvalContext,
): void {
  if (step.when !== undefined && !holds(step.when, ctx)) return;
  if ("createCards" in step) {
    const spec = step.createCards;
    const cardSet = rules.cardSets.find(
      (set) => set.id === spec.cardSet,
    ) as RulesDocument["cardSets"][number];
    createCards(copySpecs(cardSet, ctx.state.options), zoneOf(spec.into, ctx), spec.faceUp, ctx);
  } else if ("shuffle" in step) {
    shuffle(ctx.state.zones[zoneOf(step.shuffle.zone, ctx)] as string[], random);
  } else if ("dealRows" in step) {
    dealRows(step.dealRows, ctx);
  } else {
    const value = evaluate(step.setVar.value, ctx);
    ctx.state.vars[step.setVar.name] = typeof value === "number" ? value : 0;
  }
}
