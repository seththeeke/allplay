import { z } from "zod";

/** Body of `GET /v1/health`, the stage health check (cdk-stacks.md section 5). */
export const HealthResponseSchema = z.object({
  status: z.literal("OK"),
  stage: z.string().min(1),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
