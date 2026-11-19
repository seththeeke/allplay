import { BUILT_IN_VARS } from "../interpreter/engine";
import { buildLayout } from "../primitives/layout";
import type { Effect, Expr, RulesDocument } from "./schema";

/** What an expression may reference where it appears. */
interface Scope {
  params: ReadonlySet<string>;
  refs: ReadonlySet<string>;
  hints: boolean;
}

interface Checker {
  rules: RulesDocument;
  zoneIds: ReadonlySet<string>;
  zoneTypes: ReadonlySet<string>;
  vars: ReadonlySet<string>;
  issues: string[];
}

const UNARY = new Set(["rank", "suit", "color", "faceUp", "isNull", "not", "allFaceUp"]);
const ZONE_ARG = new Set(["zone", "count", "isEmpty"]);
const LISTS = new Set(["all", "any"]);
const PAIRS = new Set(["add", "sub", "min", "max", "eq", "neq", "lt", "lte", "gt", "gte"]);
const ZONE_ITERATORS = new Set(["countZones", "forAll", "exists"]);

type Obj = Record<string, Expr>;
const isObj = (expr: Expr | undefined): expr is Obj =>
  typeof expr === "object" && expr !== null && !Array.isArray(expr);

function checkZone(expr: Expr | undefined, scope: Scope, at: string, c: Checker): void {
  if (expr === undefined || expr === null) {
    c.issues.push(`${at}: missing zone`);
  } else if (typeof expr === "string") {
    if (!c.zoneIds.has(expr)) c.issues.push(`${at}: unknown zone ${expr}`);
  } else {
    checkExpr(expr, scope, at, c);
  }
}

function checkZoneType(type: unknown, at: string, c: Checker): void {
  if (typeof type !== "string" || !c.zoneTypes.has(type))
    c.issues.push(`${at}: unknown zone type ${String(type)}`);
}

function checkName(
  kind: string,
  name: unknown,
  known: ReadonlySet<string>,
  at: string,
  c: Checker,
): void {
  if (typeof name !== "string" || !known.has(name))
    c.issues.push(`${at}: unknown ${kind} ${String(name)}`);
}

/** Checks one expression's operators and references (game-engine.md section 13, stage 2). */
export function checkExpr(expr: Expr, scope: Scope, at: string, c: Checker): void {
  if (expr === null || typeof expr !== "object") return;
  if (Array.isArray(expr)) {
    c.issues.push(`${at}: an array is not an expression`);
    return;
  }
  if ("switch" in expr) {
    checkExpr(expr["switch"], scope, `${at}.switch`, c);
    for (const [key, value] of Object.entries(isObj(expr["cases"]) ? expr["cases"] : {}))
      checkExpr(value, scope, `${at}.cases.${key}`, c);
    if (expr["default"] !== undefined) checkExpr(expr["default"], scope, `${at}.default`, c);
    return;
  }
  const keys = Object.keys(expr);
  const [op = ""] = keys;
  const arg = expr[op] as Expr;
  const here = `${at}.${op}`;
  if (keys.length !== 1) {
    c.issues.push(
      `${at}: an expression has exactly one operator, found ${keys.join(", ") || "none"}`,
    );
  } else if (op === "param") {
    checkName("param", arg, scope.params, here, c);
  } else if (op === "option") {
    checkName("option", arg, new Set(Object.keys(c.rules.options)), here, c);
  } else if (op === "var") {
    checkName("var", arg, c.vars, here, c);
  } else if (op === "ref") {
    checkName("ref", arg, scope.refs, here, c);
  } else if (ZONE_ARG.has(op)) {
    checkZone(arg, scope, here, c);
  } else if (UNARY.has(op)) {
    checkExpr(arg, scope, here, c);
  } else if (op === "card" || op === "cards" || op === "runLength") {
    const spec = isObj(arg) ? arg : {};
    checkZone(spec["zone"], scope, `${here}.zone`, c);
    for (const key of ["fromTop", "rankStep"])
      if (spec[key] !== undefined) checkExpr(spec[key], scope, `${here}.${key}`, c);
  } else if (op === "isSequence") {
    checkExpr(isObj(arg) ? (arg["cards"] ?? null) : null, scope, `${here}.cards`, c);
  } else if (ZONE_ITERATORS.has(op)) {
    const spec = isObj(arg) ? arg : {};
    checkZoneType(spec["type"], here, c);
    const as = typeof spec["as"] === "string" ? spec["as"] : "";
    checkExpr(
      spec["where"] ?? true,
      { ...scope, refs: new Set([...scope.refs, as]) },
      `${here}.where`,
      c,
    );
  } else if (LISTS.has(op) || PAIRS.has(op)) {
    if (!Array.isArray(arg) || (PAIRS.has(op) && arg.length !== 2)) {
      c.issues.push(`${here}: expects ${PAIRS.has(op) ? "two operands" : "a list"}`);
    } else {
      arg.forEach((item, i) => {
        checkExpr(item, scope, `${here}[${String(i)}]`, c);
      });
    }
  } else if (op === "reversesLastAction") {
    if (!scope.hints) c.issues.push(`${here}: only hints may use reversesLastAction`);
  } else {
    c.issues.push(`${at}: unknown operator ${op}`);
  }
}

function checkEffects(effects: readonly Effect[], scope: Scope, at: string, c: Checker): void {
  effects.forEach((effect, i) => {
    const here = `${at}[${String(i)}]`;
    if ("moveCards" in effect) {
      checkZone(effect.moveCards.from, scope, `${here}.from`, c);
      checkZone(effect.moveCards.to, scope, `${here}.to`, c);
      checkExpr(effect.moveCards.count, scope, `${here}.count`, c);
    } else if ("dealRow" in effect) {
      checkZone(effect.dealRow.from, scope, `${here}.from`, c);
      checkZoneType(effect.dealRow.type, here, c);
    } else if ("flipTop" in effect) {
      checkZone(effect.flipTop.zone, scope, `${here}.zone`, c);
    } else if ("moveToFirstEmpty" in effect) {
      checkZone(effect.moveToFirstEmpty.from, scope, `${here}.from`, c);
      checkZoneType(effect.moveToFirstEmpty.type, here, c);
      checkExpr(effect.moveToFirstEmpty.count, scope, `${here}.count`, c);
    } else if ("addVar" in effect) {
      checkName("var", effect.addVar.name, c.vars, here, c);
      checkExpr(effect.addVar.by, scope, `${here}.by`, c);
    } else {
      for (const [key, value] of Object.entries(effect.emit.data))
        checkExpr(value, scope, `${here}.data.${key}`, c);
    }
  });
}

function checkOptionsAndCards(c: Checker): void {
  const none: Scope = { params: new Set(), refs: new Set(), hints: false };
  for (const [name, option] of Object.entries(c.rules.options)) {
    if (!option.values.includes(option.default))
      c.issues.push(`options.${name}: default is not one of its values`);
  }
  for (const set of c.rules.cardSets) {
    if (Array.isArray(set.copies)) continue;
    const option = c.rules.options[set.copies.switch.option];
    if (option === undefined) {
      c.issues.push(`cardSets.${set.id}: unknown option ${set.copies.switch.option}`);
      continue;
    }
    const missing = option.values.filter(
      (value) => !(String(value) in (set.copies as { cases: object }).cases),
    );
    if (missing.length > 0) c.issues.push(`cardSets.${set.id}: no case for ${missing.join(", ")}`);
  }
  for (const [name, spec] of Object.entries(c.rules.vars))
    checkExpr(spec.initial, none, `vars.${name}`, c);
  c.rules.setup.forEach((step, i) => {
    const at = `setup[${String(i)}]`;
    if (step.when !== undefined) checkExpr(step.when, none, `${at}.when`, c);
    if ("createCards" in step) {
      if (!c.rules.cardSets.some((set) => set.id === step.createCards.cardSet))
        c.issues.push(`${at}: unknown card set ${step.createCards.cardSet}`);
      checkZone(step.createCards.into, none, `${at}.into`, c);
    } else if ("shuffle" in step) {
      checkZone(step.shuffle.zone, none, `${at}.zone`, c);
    } else if ("dealRows" in step) {
      checkZone(step.dealRows.from, none, `${at}.from`, c);
      checkZoneType(step.dealRows.type, at, c);
    } else {
      checkName("var", step.setVar.name, c.vars, at, c);
      checkExpr(step.setVar.value, none, `${at}.value`, c);
    }
  });
}

function checkActions(c: Checker): void {
  const ids = new Set<string>();
  for (const action of c.rules.actions) {
    const at = `actions.${action.id}`;
    if (ids.has(action.id)) c.issues.push(`${at}: duplicate action id`);
    ids.add(action.id);
    const earlier = new Set<string>();
    for (const param of action.params) {
      const scope: Scope = { params: new Set(earlier), refs: new Set(), hints: false };
      if ("zones" in param.domain) checkZoneType(param.domain.zones.type, `${at}.${param.name}`, c);
      else {
        checkExpr(param.domain.int.min, scope, `${at}.${param.name}.min`, c);
        checkExpr(param.domain.int.max, scope, `${at}.${param.name}.max`, c);
      }
      earlier.add(param.name);
      (param.prune ?? []).forEach((p, i) => {
        checkExpr(
          p,
          { ...scope, params: new Set(earlier) },
          `${at}.${param.name}.prune[${String(i)}]`,
          c,
        );
      });
    }
    const scope: Scope = { params: earlier, refs: new Set(), hints: false };
    action.require.forEach((p, i) => {
      checkExpr(p, scope, `${at}.require[${String(i)}]`, c);
    });
    checkEffects(action.effects, scope, `${at}.effects`, c);
    if (action.equivalence !== undefined) {
      checkName("param", action.equivalence.param, earlier, `${at}.equivalence`, c);
      checkExpr(action.equivalence.when, scope, `${at}.equivalence.when`, c);
    }
    const speech = c.rules.speech.actions[action.id];
    if (speech === undefined) c.issues.push(`${at}: no speech text`);
    for (const text of speech === undefined ? [] : [speech.text, speech.short]) {
      for (const [, name] of text.matchAll(/\{param\.([a-zA-Z0-9]+)\}/g))
        checkName("param", name, earlier, `${at}.speech`, c);
    }
  }
}

function checkTriggersAndHints(c: Checker): void {
  for (const trigger of c.rules.triggers) {
    const at = `triggers.${trigger.id}`;
    if (trigger.forEach !== undefined) checkZoneType(trigger.forEach.type, at, c);
    const scope: Scope = {
      params: new Set(),
      refs: new Set(trigger.forEach === undefined ? [] : [trigger.forEach.as]),
      hints: false,
    };
    checkExpr(trigger.when, scope, `${at}.when`, c);
    checkEffects(trigger.effects, scope, `${at}.effects`, c);
  }
  const none: Scope = { params: new Set(), refs: new Set(), hints: false };
  c.rules.endConditions.forEach((condition, i) => {
    checkExpr(condition.when, none, `endConditions[${String(i)}]`, c);
  });
  c.rules.hints.weights.forEach((entry, i) => {
    const at = `hints.weights[${String(i)}]`;
    const action =
      entry.action === undefined ? undefined : c.rules.actions.find((a) => a.id === entry.action);
    if (entry.action !== undefined && action === undefined)
      c.issues.push(`${at}: unknown action ${entry.action}`);
    const params = new Set(action?.params.map((param) => param.name) ?? []);
    checkExpr(entry.when, { params, refs: new Set(), hints: true }, at, c);
  });
}

/** Stage 2 of validateRules: every reference resolves and every operator exists. Returns the issues found. */
export function staticChecks(rules: RulesDocument): string[] {
  const layout = buildLayout(rules.zones);
  const c: Checker = {
    rules,
    zoneIds: layout.zoneIds,
    zoneTypes: new Set(layout.zoneTypes.keys()),
    vars: new Set([...BUILT_IN_VARS, ...Object.keys(rules.vars)]),
    issues: [],
  };
  if (layout.zoneTypes.size !== rules.zones.length) c.issues.push("zones: duplicate zone type");
  checkOptionsAndCards(c);
  checkActions(c);
  checkTriggersAndHints(c);
  return c.issues;
}
