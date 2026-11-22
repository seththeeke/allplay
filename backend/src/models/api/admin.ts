import { z } from "zod";
import { IsoTimestampSchema } from "./common";

/** Admin contracts (authn-authz.md section 5, data-model.md section 11). */

const LATENCY_BUCKETS = [
  "le250",
  "le500",
  "le750",
  "le1000",
  "le1500",
  "le2000",
  "le3000",
  "le5000",
  "overflow",
] as const;
export const LatencyBucketsSchema = z.record(z.enum(LATENCY_BUCKETS), z.number().int().min(0));
export type LatencyBuckets = z.infer<typeof LatencyBucketsSchema>;

export const DayMetricsSchema = z.object({
  period: z.iso.date(),
  totalPlayers: z.number().int().min(0),
  totalAccounts: z.number().int().min(0),
  totalGuests: z.number().int().min(0),
  activePlayers30d: z.number().int().min(0),
  newPlayers: z.number().int().min(0),
  gamesStarted: z.record(z.string(), z.number().int().min(0)),
  gamesWon: z.record(z.string(), z.number().int().min(0)),
  gamesAbandoned: z.record(z.string(), z.number().int().min(0)),
  decisions: z.number().int().min(0),
  hardFailures: z.number().int().min(0),
  softFailures: z.number().int().min(0),
  llmCalls: z.number().int().min(0),
  llmInputTokens: z.number().int().min(0),
  llmOutputTokens: z.number().int().min(0),
  clientLatencyP50Ms: z.number().int().min(0).nullable(),
  clientLatencyP95Ms: z.number().int().min(0).nullable(),
  serverLatencyP50Ms: z.number().int().min(0).nullable(),
  serverLatencyP95Ms: z.number().int().min(0).nullable(),
});
export type DayMetrics = z.infer<typeof DayMetricsSchema>;

export const MetricsResponseSchema = z.object({ days: z.array(DayMetricsSchema) });
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

export const AdminDecisionSchema = z.object({
  decisionId: z.string().min(1),
  createdAt: IsoTimestampSchema,
  gameId: z.string().nullable(),
  transcript: z.string(),
  outcome: z.string().min(1),
  failureClass: z.enum(["PENDING", "HARD", "SOFT", "NONE"]),
  clientLatencyMs: z.number().int().min(0).nullable(),
});
export type AdminDecision = z.infer<typeof AdminDecisionSchema>;

export const AdminDecisionsResponseSchema = z.object({ decisions: z.array(AdminDecisionSchema) });
export type AdminDecisionsResponse = z.infer<typeof AdminDecisionsResponseSchema>;

export const ExecutionStatusSchema = z.enum([
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
  "STOPPED",
  "SUPERSEDED",
]);

export const DeploymentSchema = z.object({
  executionId: z.string().min(1),
  status: ExecutionStatusSchema,
  trigger: z.enum(["SCHEDULE", "ADMIN", "MANUAL"]),
  startedAt: IsoTimestampSchema,
  lastUpdatedAt: IsoTimestampSchema,
  stages: z.array(z.object({ name: z.string().min(1), status: ExecutionStatusSchema })),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export const DeploymentsResponseSchema = z.object({ deployments: z.array(DeploymentSchema) });
export type DeploymentsResponse = z.infer<typeof DeploymentsResponseSchema>;

export const StartDeploymentResponseSchema = z.object({ executionId: z.string().min(1) });
export type StartDeploymentResponse = z.infer<typeof StartDeploymentResponseSchema>;

/** Accounts sharing a normalized email (authn-authz.md section 6.2). */
export const DuplicateAccountsResponseSchema = z.object({
  duplicates: z.array(
    z.object({
      emailKey: z.string().min(1),
      accounts: z.array(
        z.object({
          playerId: z.string().min(1),
          signInProviders: z.array(z.enum(["COGNITO", "GOOGLE", "APPLE"])),
          createdAt: IsoTimestampSchema,
        }),
      ),
    }),
  ),
});
export type DuplicateAccountsResponse = z.infer<typeof DuplicateAccountsResponseSchema>;

export const MergeAccountsRequestSchema = z.object({
  primaryPlayerId: z.string().regex(/^ACCT#.+$/),
  duplicatePlayerId: z.string().regex(/^ACCT#.+$/),
});
export type MergeAccountsRequest = z.infer<typeof MergeAccountsRequestSchema>;
