import type { GameLayout } from "../primitives/layout";
import type { ActionDescriptor, GameEvent, GameState, ZoneRef } from "../types";

const SUITS = new Set(["SPADES", "HEARTS", "DIAMONDS", "CLUBS"]);

/** Replaces each `{key}` with its resolved text; unresolved keys render empty. */
export function render(template: string, resolve: (key: string) => string | undefined): string {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key: string) => resolve(key) ?? "");
}

/** Spoken form of a zone: its label, prefixed with "empty" when it holds no cards. */
export function zoneText(zoneId: string, state: GameState, layout: GameLayout): string {
  const label = (layout.refs.get(zoneId) as ZoneRef).label;
  return (state.zones[zoneId] as string[]).length === 0 ? `empty ${label}` : label;
}

function valueText(value: unknown, state: GameState, layout: GameLayout): string {
  if (typeof value === "string" && layout.zoneIds.has(value)) return zoneText(value, state, layout);
  if (typeof value === "string" && SUITS.has(value)) return value.toLowerCase();
  return String(value);
}

/** Text for one legal action (game-engine.md section 4.12). */
export function actionText(
  template: string,
  params: Readonly<Record<string, string | number>>,
  descriptor: ActionDescriptor,
  state: GameState,
  layout: GameLayout,
): string {
  return render(template, (key) => {
    const [scope, name = ""] = key.split(".");
    if (scope === "param") return valueText(params[name], state, layout);
    if (scope === "var")
      return state.vars[name] === undefined ? undefined : String(state.vars[name]);
    if (descriptor.kind !== "MOVE_CARDS") return undefined;
    if (key === "cards.lead") return descriptor.cards[0]?.name;
    if (key === "cards.count") return String(descriptor.cards.length);
    if (key === "target.top") return descriptor.to.topCard?.name ?? "empty";
    return undefined;
  });
}

/** Text for an event, or null when the rules give it no speech. */
export function eventText(
  event: GameEvent,
  templates: Readonly<Record<string, string>>,
  state: GameState,
  layout: GameLayout,
): string | null {
  const template = templates[event.type];
  if (template === undefined) return null;
  return render(template, (key) => {
    const [scope, name = ""] = key.split(".");
    if (scope === "data")
      return event.data[name] === undefined
        ? undefined
        : valueText(event.data[name], state, layout);
    if (scope === "var")
      return state.vars[name] === undefined ? undefined : String(state.vars[name]);
    return undefined;
  });
}
