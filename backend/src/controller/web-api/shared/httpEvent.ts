import { z } from "zod";

/** The fields of an API Gateway HTTP API (payload 2.0) event that controllers read. */
export const HttpEventSchema = z.object({
  /** `<METHOD> <path template>`, for example `GET /v1/sessions/{sessionId}`. */
  routeKey: z.string().optional(),
  rawPath: z.string(),
  pathParameters: z.record(z.string(), z.string()).optional(),
  queryStringParameters: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  isBase64Encoded: z.boolean().optional(),
  requestContext: z.object({
    requestId: z.string(),
    http: z.object({ method: z.string(), path: z.string() }),
    authorizer: z
      .object({
        iam: z
          .object({
            cognitoIdentity: z
              .object({
                identityId: z.string().min(1),
                identityPoolId: z.string().optional(),
                amr: z.array(z.string()).optional(),
              })
              .nullish(),
            userArn: z.string().optional(),
          })
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
