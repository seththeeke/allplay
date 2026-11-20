import { z } from "zod";

/**
 * Rules document schema version 1 (game-engine.md section 4). Expressions are
 * JSON values here; their operators and references are checked by the static
 * checks in staticChecks.ts.
 */

export const ExprSchema = z.json();
export type Expr = z.infer<typeof ExprSchema>;

const IdSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, "ids are ALL_CAPS");
const NameSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "names are camelCase");
const SuitSchema = z.enum(["SPADES", "HEARTS", "DIAMONDS", "CLUBS"]);
const OptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const CopySpecSchema = z.strictObject({
  suits: z.array(SuitSchema).min(1),
  ranks: z.union([z.literal("A-K"), z.array(z.number().int().min(1).max(13)).min(1)]),
  times: z.number().int().min(1),
});
export type CopySpec = z.infer<typeof CopySpecSchema>;

const CopiesSchema = z.union([
  z.array(CopySpecSchema).min(1),
  z.strictObject({
    switch: z.strictObject({ option: NameSchema }),
    cases: z.record(z.string(), z.array(CopySpecSchema).min(1)),
  }),
]);

const ZoneTypeSchema = z.strictObject({
  type: NameSchema,
  count: z.number().int().min(1),
  label: z.strictObject({
    singular: z.string().min(1),
    plural: z.string().min(1),
    numbered: z.boolean(),
  }),
  aliases: z.array(z.string()),
  visibility: z.enum(["CARDS", "COUNT_ONLY"]),
  layout: z.enum(["FAN_DOWN", "STACK", "ROW"]),
  region: z.enum(["TOP", "MAIN", "BOTTOM"]),
});
export type ZoneType = z.infer<typeof ZoneTypeSchema>;

const WhenSchema = { when: ExprSchema.optional() };

const SetupStepSchema = z.union([
  z.strictObject({
    ...WhenSchema,
    createCards: z.strictObject({ cardSet: z.string(), into: ExprSchema, faceUp: z.boolean() }),
  }),
  z.strictObject({ ...WhenSchema, shuffle: z.strictObject({ zone: ExprSchema }) }),
  z.strictObject({
    ...WhenSchema,
    dealRows: z.strictObject({
      from: ExprSchema,
      type: NameSchema,
      counts: z.array(z.number().int().min(0)).min(1),
      faceUp: z.boolean(),
    }),
  }),
  z.strictObject({
    ...WhenSchema,
    setVar: z.strictObject({ name: NameSchema, value: ExprSchema }),
  }),
]);
export type SetupStep = z.infer<typeof SetupStepSchema>;

export const EffectSchema = z.union([
  z.strictObject({
    moveCards: z.strictObject({ from: ExprSchema, count: ExprSchema, to: ExprSchema }),
  }),
  z.strictObject({
    dealRow: z.strictObject({ from: ExprSchema, type: NameSchema, faceUp: z.boolean() }),
  }),
  z.strictObject({ flipTop: z.strictObject({ zone: ExprSchema, faceUp: z.boolean() }) }),
  z.strictObject({
    moveToFirstEmpty: z.strictObject({ from: ExprSchema, count: ExprSchema, type: NameSchema }),
  }),
  z.strictObject({ addVar: z.strictObject({ name: NameSchema, by: ExprSchema }) }),
  z.strictObject({
    emit: z.strictObject({ event: IdSchema, data: z.record(z.string(), ExprSchema) }),
  }),
]);
export type Effect = z.infer<typeof EffectSchema>;

const DomainSchema = z.union([
  z.strictObject({ zones: z.strictObject({ type: NameSchema }) }),
  z.strictObject({ int: z.strictObject({ min: ExprSchema, max: ExprSchema }) }),
]);
export type Domain = z.infer<typeof DomainSchema>;

const ActionSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(["MOVE_CARDS", "DEAL", "OTHER"]),
  params: z.array(
    z.strictObject({
      name: NameSchema,
      domain: DomainSchema,
      prune: z.array(ExprSchema).optional(),
    }),
  ),
  require: z.array(ExprSchema).default([]),
  effects: z.array(EffectSchema).min(1),
  score: z.number().default(0),
  countsAsMove: z.boolean().default(true),
  equivalence: z.strictObject({ param: NameSchema, when: ExprSchema }).optional(),
});
export type ActionTemplate = z.infer<typeof ActionSchema>;

const TriggerSchema = z.strictObject({
  id: IdSchema,
  forEach: z.strictObject({ type: NameSchema, as: NameSchema }).optional(),
  when: ExprSchema,
  effects: z.array(EffectSchema).min(1),
  score: z.number().default(0),
});
export type Trigger = z.infer<typeof TriggerSchema>;

export const RulesDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  gameId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.number().int().min(1),
  name: z.string().min(1),
  description: z.string(),
  path: z.string().regex(/^\/[a-z0-9-]+$/),
  players: z.strictObject({ min: z.literal(1), max: z.literal(1) }),
  options: z.record(
    NameSchema,
    z.strictObject({
      type: z.literal("ENUM"),
      values: z.array(OptionValueSchema).min(1),
      default: OptionValueSchema,
      labels: z.record(z.string(), z.string()),
    }),
  ),
  vars: z.record(NameSchema, z.strictObject({ initial: ExprSchema, label: z.string().min(1) })),
  derived: z
    .record(NameSchema, z.strictObject({ value: ExprSchema, label: z.string().min(1) }))
    .default({}),
  cardSets: z.array(z.strictObject({ id: z.string().min(1), copies: CopiesSchema })),
  zones: z.array(ZoneTypeSchema).min(1),
  setup: z.array(SetupStepSchema),
  actions: z.array(ActionSchema).min(1),
  triggers: z.array(TriggerSchema),
  endConditions: z.array(z.strictObject({ status: z.enum(["WON", "LOST"]), when: ExprSchema })),
  undo: z.strictObject({
    allowed: z.boolean(),
    score: z.number(),
    refundUndoneAction: z.boolean(),
  }),
  hints: z.strictObject({
    weights: z.array(
      z.strictObject({ action: IdSchema.optional(), weight: z.number(), when: ExprSchema }),
    ),
  }),
  speech: z.strictObject({
    zoneAliases: z.record(z.string(), z.array(z.string())).optional(),
    actions: z.record(
      IdSchema,
      z.strictObject({ text: z.string().min(1), short: z.string().min(1) }),
    ),
    events: z.record(IdSchema, z.string().min(1)),
    deciderGuidance: z.array(z.string()).optional(),
  }),
});
export type RulesDocument = z.infer<typeof RulesDocumentSchema>;
