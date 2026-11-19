import { describe, expect, it } from "vitest";
import { compileRules, RulesValidationError, validateRules } from "../../src/game-engine";
import { toyRules } from "./toyRules";

type Rules = ReturnType<typeof toyRules>;
type Doc = Record<string, unknown>;

function issuesAfter(change: (rules: Rules) => void): string[] {
  const rules = toyRules();
  change(rules);
  const result = validateRules(rules);
  return result.valid ? [] : result.issues;
}

const actions = (rules: Rules) => rules["actions"] as Doc[];
const action = (rules: Rules, i: number) => actions(rules)[i] as Doc;
const triggers = (rules: Rules) => rules["triggers"] as Doc[];
const setup = (rules: Rules) => rules["setup"] as Doc[];

describe("validateRules", () => {
  it("accepts the toy game", () => {
    expect(validateRules(toyRules())).toMatchObject({ valid: true });
  });

  it("reports schema problems with their paths", () => {
    expect(validateRules({})).toMatchObject({ valid: false });
    const result = validateRules({ ...toyRules(), gameId: "Bad Id" });
    expect(result.valid ? [] : result.issues).toEqual([expect.stringMatching(/^gameId: /)]);
    const root = validateRules(7);
    expect(root.valid ? [] : root.issues[0]).toMatch(/^document: /);
  });

  it("refuses to compile an invalid document", () => {
    expect(() => compileRules({ ...toyRules(), zones: [] })).toThrow(RulesValidationError);
    try {
      compileRules({ ...toyRules(), zones: [] });
    } catch (error) {
      expect((error as RulesValidationError).issues.length).toBeGreaterThan(0);
    }
  });

  it("checks options and card sets", () => {
    expect(
      issuesAfter((rules) => {
        (rules["options"] as Record<string, Doc>)["mode"] = {
          type: "ENUM",
          values: ["EASY"],
          default: "HARD",
          labels: {},
        };
      }),
    ).toEqual(["options.mode: default is not one of its values"]);
    expect(
      issuesAfter((rules) => {
        ((rules["cardSets"] as Doc[])[1] as { copies: { cases: Doc } }).copies.cases = {
          "1": [{ suits: ["CLUBS"], ranks: "A-K", times: 1 }],
        };
      }),
    ).toEqual(["cardSets.extra: no case for 2"]);
    expect(
      issuesAfter((rules) => {
        ((rules["cardSets"] as Doc[])[1] as { copies: { switch: Doc } }).copies.switch = {
          option: "colour",
        };
      }),
    ).toEqual(["cardSets.extra: unknown option colour"]);
  });

  it("checks setup steps", () => {
    const issues = issuesAfter((rules) => {
      setup(rules).push(
        { createCards: { cardSet: "nope", into: "deck.9", faceUp: false } },
        { shuffle: { zone: "deck.9" } },
        { dealRows: { from: "deck.9", type: "nope", counts: [1], faceUp: false } },
        { setVar: { name: "nope", value: { var: "nope" } } },
        { when: { option: "nope" }, shuffle: { zone: "deck.1" } },
      );
      (rules["vars"] as Record<string, Doc>)["extra"] = { initial: { param: "x" }, label: "extra" };
    });
    expect(issues).toEqual([
      "vars.extra.param: unknown param x",
      "setup[6]: unknown card set nope",
      "setup[6].into: unknown zone deck.9",
      "setup[7].zone: unknown zone deck.9",
      "setup[8].from: unknown zone deck.9",
      "setup[8]: unknown zone type nope",
      "setup[9]: unknown var nope",
      "setup[9].value.var: unknown var nope",
      "setup[10].when.option: unknown option nope",
    ]);
  });

  it("checks action params, requirements, effects, equivalence and speech", () => {
    const issues = issuesAfter((rules) => {
      const shift = action(rules, 0);
      (shift["params"] as Doc[])[0] = { name: "from", domain: { zones: { type: "nope" } } };
      (shift["params"] as Doc[])[1] = {
        name: "n",
        domain: { int: { min: { param: "to" }, max: 3 } },
        prune: [{ param: "to" }],
      };
      shift["require"] = [
        { ref: "z" },
        { eq: [1] },
        { all: 1 },
        { reversesLastAction: true },
        { what: 1 },
        { a: 1, b: 2 },
        [1],
      ];
      shift["equivalence"] = { param: "zz", when: true };
      actions(rules).push({
        ...shift,
        effects: [
          { moveToFirstEmpty: { from: "x.1", count: 1, type: "nope" } },
          { addVar: { name: "nope", by: 1 } },
          { dealRow: { from: "deck.1", type: "nope", faceUp: true } },
          { flipTop: { zone: "x.1", faceUp: true } },
          { emit: { event: "E", data: { a: { var: "nope" } } } },
        ],
      });
      (rules["speech"] as { actions: Record<string, Doc> }).actions["SHIFT"] = {
        text: "{param.zz}",
        short: "s",
      };
    });
    expect(issues).toContain("actions.SHIFT.from: unknown zone type nope");
    expect(issues).toContain("actions.SHIFT.n.min.param: unknown param to");
    expect(issues).toContain("actions.SHIFT.n.prune[0].param: unknown param to");
    expect(issues).toContain("actions.SHIFT.require[0].ref: unknown ref z");
    expect(issues).toContain("actions.SHIFT.require[1].eq: expects two operands");
    expect(issues).toContain("actions.SHIFT.require[2].all: expects a list");
    expect(issues).toContain(
      "actions.SHIFT.require[3].reversesLastAction: only hints may use reversesLastAction",
    );
    expect(issues).toContain("actions.SHIFT.require[4]: unknown operator what");
    expect(issues).toContain(
      "actions.SHIFT.require[5]: an expression has exactly one operator, found a, b",
    );
    expect(issues).toContain("actions.SHIFT.require[6]: an array is not an expression");
    expect(issues).toContain("actions.SHIFT.equivalence: unknown param zz");
    expect(issues).toContain("actions.SHIFT.speech: unknown param zz");
    expect(issues).toContain("actions.SHIFT: duplicate action id");
    expect(issues).toContain("actions.SHIFT.effects[0].from: unknown zone x.1");
    expect(issues).toContain("actions.SHIFT.effects[0]: unknown zone type nope");
    expect(issues).toContain("actions.SHIFT.effects[1]: unknown var nope");
    expect(issues).toContain("actions.SHIFT.effects[2]: unknown zone type nope");
    expect(issues).toContain("actions.SHIFT.effects[3].zone: unknown zone x.1");
    expect(issues).toContain("actions.SHIFT.effects[4].data.a.var: unknown var nope");
  });

  it("requires speech for every action", () => {
    expect(
      issuesAfter((rules) => {
        delete (rules["speech"] as { actions: Record<string, Doc> }).actions["DRAW"];
      }),
    ).toEqual(["actions.DRAW: no speech text"]);
  });

  it("checks triggers, end conditions, hints and zone iterators", () => {
    const issues = issuesAfter((rules) => {
      triggers(rules).push({
        id: "BAD",
        forEach: { type: "nope", as: "z" },
        when: { ref: "q" },
        effects: [{ addVar: { name: "banked", by: 1 } }],
      });
      (rules["endConditions"] as Doc[]).push({
        status: "WON",
        when: { forAll: { type: "nope", as: "d", where: { ref: "d" } } },
      });
      (rules["hints"] as { weights: Doc[] }).weights.push(
        { action: "NOPE", weight: 1, when: true },
        { weight: 1, when: { param: "to" } },
        {
          action: "SHIFT",
          weight: 1,
          when: { switch: { param: "to" }, cases: { a: { param: "x" } }, default: { var: "nope" } },
        },
      );
      rules["zones"] = [...(rules["zones"] as Doc[]), (rules["zones"] as Doc[])[0] as Doc];
    });
    expect(issues).toEqual([
      "zones: duplicate zone type",
      "triggers.BAD: unknown zone type nope",
      "triggers.BAD.when.ref: unknown ref q",
      "endConditions[2].forAll: unknown zone type nope",
      "hints.weights[3]: unknown action NOPE",
      "hints.weights[4].param: unknown param to",
      "hints.weights[5].cases.a.param: unknown param x",
      "hints.weights[5].default.var: unknown var nope",
    ]);
  });

  it("reports malformed operator arguments", () => {
    const issues = issuesAfter((rules) => {
      action(rules, 1)["require"] = [
        {},
        { isSequence: 5 },
        { isSequence: {} },
        { forAll: 5 },
        { exists: { type: "pile", as: "p" } },
      ];
    });
    expect(issues).toEqual([
      "actions.DRAW.require[0]: an expression has exactly one operator, found none",
      "actions.DRAW.require[3].forAll: unknown zone type undefined",
    ]);
  });

  it("checks card positions, sequences and switches", () => {
    const issues = issuesAfter((rules) => {
      action(rules, 1)["require"] = [
        { rank: { card: { zone: "x.1", fromTop: { var: "nope" } } } },
        { isSequence: { cards: { var: "nope" } } },
        { card: 5 },
        { switch: { var: "nope" }, cases: 1 },
      ];
    });
    expect(issues).toEqual([
      "actions.DRAW.require[0].rank.card.zone: unknown zone x.1",
      "actions.DRAW.require[0].rank.card.fromTop.var: unknown var nope",
      "actions.DRAW.require[1].isSequence.cards.var: unknown var nope",
      "actions.DRAW.require[2].card.zone: missing zone",
      "actions.DRAW.require[3].switch.var: unknown var nope",
    ]);
  });
});
