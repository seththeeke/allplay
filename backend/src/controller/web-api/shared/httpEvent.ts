import { z } from "zod";

/** The fields of an API Gateway HTTP API (payload 2.0) event that controllers read. */
export const HttpEventSchema = z.object({
  rawPath: z.string(),
  body: z.string().optional(),
  isBase64Encoded: z.boolean().optional(),
  requestContext: z.object({
    requestId: z.string(),
    http: z.object({ method: z.string(), path: z.string() }),
    authorizer: z
      .object({
        iam: z
          .object({ cognitoIdentity: z.object({ identityId: z.string().min(1) }).nullish() })
          .optional(),
      })
      .optional(),
  }),
});
export type HttpEvent = z.infer<typeof HttpEventSchema>;

/** The request body parsed as JSON, or undefined when it is missing or not JSON. */
export function jsonBody(event: HttpEvent): unknown {
  if (event.body === undefined) return undefined;
  const text =
    event.isBase64Encoded === true
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
