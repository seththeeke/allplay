import { z } from "zod";

/** What a case expects the decider to do (action-decision.md section 12). */
export const ExpectationSchema = z.discriminatedUnion("kind", [
  /** One of `accept` proposed or applied, or offered among choices that are all in `accept`. */
  z.object({ kind: z.literal("GAME"), accept: z.array(z.string()).min(1), ambiguous: z.boolean() }),
  z.object({ kind: z.literal("APP"), action: z.string().min(1) }),
  /** A spoken answer to the pending prompt, resolved without a new proposal. */
  z.object({ kind: z.literal("RESPONSE") }),
  z.object({ kind: z.literal("UNRECOGNIZED") }),
]);
export type Expectation = z.infer<typeof ExpectationSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  gameId: z.string().min(1),
  /** The board: a seeded deal and the actions played on it. */
  seed: z.string().regex(/^[0-9a-f]{32}$/),
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  history: z.array(z.string()),
  transcript: z.string().min(1),
  pending: z
    .object({ kind: z.enum(["CONFIRMATION", "CHOICES"]), actionIds: z.array(z.string()).min(1) })
    .nullable(),
  expect: ExpectationSchema,
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalSetSchema = z.object({
  gameId: z.string(),
  cases: z.array(EvalCaseSchema).min(200),
});
