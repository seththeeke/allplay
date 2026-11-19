import { z } from "zod";

/** The fields of an API Gateway HTTP API (payload 2.0) event that controllers read. */
export const HttpEventSchema = z.object({
  rawPath: z.string(),
  requestContext: z.object({
    requestId: z.string(),
    http: z.object({ method: z.string(), path: z.string() }),
  }),
});
export type HttpEvent = z.infer<typeof HttpEventSchema>;
