import { holds, intValue, type EvalContext } from "../primitives/expressions";
import { zonesOfType } from "../primitives/layout";
import type { ActionTemplate } from "../rules/schema";
import { actionText } from "../speech/templates";
import type { GameState, LegalAction } from "../types";
import { describeAction } from "../view/descriptors";
import { evalContext, type Engine } from "./engine";

export type Binding = Record<string, string | number>;
type Param = ActionTemplate["params"][number];

/** Values of a parameter's domain under the earlier parameters' binding (game-engine.md section 4.7). */
function domainValues(engine: Engine, param: Param, ctx: EvalContext): (string | number)[] {
  if ("zones" in param.domain) return [...zonesOfType(engine.layout, param.domain.zones.type)];
  const min = intValue(param.domain.int.min, ctx);
  const max = intValue(param.domain.int.max, ctx);
  if (min === null || max === null) return [];
  const values: number[] = [];
  for (let value = min; value <= max; value += 1) values.push(value);
  return values;
}

/** Every binding of a template that passes prune and require, in domain order (section 7.2). */
export function* legalBindings(
  engine: Engine,
  template: ActionTemplate,
  state: GameState,
): Generator<Binding> {
  function* bind(index: number, binding: Binding): Generator<Binding> {
    const ctx = evalContext(engine, state, binding);
    const param = template.params[index];
    if (param === undefined) {
      if (template.require.every((predicate) => holds(predicate, ctx))) yield binding;
      return;
    }
    for (const value of domainValues(engine, param, ctx)) {
      const next = { ...binding, [param.name]: value };
      const nextCtx = evalContext(engine, state, next);
      if ((param.prune ?? []).every((predicate) => holds(predicate, nextCtx)))
        yield* bind(index + 1, next);
    }
  }
  yield* bind(0, {});
}

/** `TEMPLATE|name=value|...` in declared parameter order (section 9.1). */
export function actionIdOf(template: ActionTemplate, binding: Binding): string {
  return [
    template.id,
    ...template.params.map((param) => `${param.name}=${String(binding[param.name])}`),
  ].join("|");
}

/** Parses an action id into its template and binding, or null when it names no template or misorders params. */
export function parseActionId(
  engine: Engine,
  actionId: string,
): { template: ActionTemplate; binding: Binding } | null {
  const [templateId = "", ...parts] = actionId.split("|");
  const template = engine.templates.get(templateId);
  if (template?.params.length !== parts.length) return null;
  const binding: Binding = {};
  for (const [i, param] of template.params.entries()) {
    const [name, raw = ""] = (parts[i] as string).split("=");
    if (name !== param.name || raw === "") return null;
    binding[param.name] = "int" in param.domain ? Number(raw) : raw;
  }
  return { template, binding };
}

/** True when a parsed binding is one `legalBindings` would yield: every value in its domain, prune and require hold. */
export function isLegalBinding(
  engine: Engine,
  template: ActionTemplate,
  binding: Binding,
  state: GameState,
): boolean {
  const partial: Binding = {};
  for (const param of template.params) {
    const value = binding[param.name] as string | number;
    if (!domainValues(engine, param, evalContext(engine, state, partial)).includes(value))
      return false;
    partial[param.name] = value;
    if (
      !(param.prune ?? []).every((predicate) =>
        holds(predicate, evalContext(engine, state, partial)),
      )
    )
      return false;
  }
  const ctx = evalContext(engine, state, partial);
  return template.require.every((predicate) => holds(predicate, ctx));
}

/** The client-facing legal action for a binding: id, descriptor, text and equivalence key (section 9). */
export function toLegalAction(
  engine: Engine,
  template: ActionTemplate,
  binding: Binding,
  state: GameState,
): LegalAction {
  const ctx = evalContext(engine, state, binding);
  const descriptor = describeAction(template, ctx);
  /* Static checks guarantee speech text for every action. */
  const speech = engine.rules.speech.actions[template.id] as { text: string; short: string };
  const actionId = actionIdOf(template, binding);
  const action: LegalAction = {
    actionId,
    templateId: template.id,
    params: { ...binding },
    descriptor,
    text: actionText(speech.text, binding, descriptor, state, engine.layout),
    shortText: actionText(speech.short, binding, descriptor, state, engine.layout),
  };
  const equivalence = template.equivalence;
  if (equivalence !== undefined && holds(equivalence.when, ctx)) {
    action.equivalenceKey = actionIdOf(template, { ...binding, [equivalence.param]: "*" });
  }
  return action;
}

export function listLegalActions(engine: Engine, state: GameState): LegalAction[] {
  if (state.status !== "IN_PROGRESS") return [];
  const actions: LegalAction[] = [];
  for (const template of engine.rules.actions) {
    for (const binding of legalBindings(engine, template, state)) {
      actions.push(toLegalAction(engine, template, binding, state));
    }
  }
  return actions;
}

/** True when at least one rule action is legal; cheaper than listing them all. */
export function hasLegalAction(engine: Engine, state: GameState): boolean {
  return engine.rules.actions.some(
    (template) => !legalBindings(engine, template, state).next().done,
  );
}
