import type { z } from "zod";
import { ApiErrorSchema } from "../../models/api";
import { ApiRequestError } from "../errors";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export interface ApiClient {
  get<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T>>;
  post<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<z.output<T>>;
  patch<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<z.output<T>>;
}

/**
 * JSON calls to the All Play HTTP API. A response that matches the error
 * contract rejects with ApiRequestError (carrying the current envelope on a
 * version conflict); anything else unreadable rejects with an INTERNAL_ERROR.
 */
export function createApiClient(
  apiUrl: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  headers: () => Record<string, string> | Promise<Record<string, string>> = () => ({}),
): ApiClient {
  const base = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const call = async <T extends z.ZodType>(
    path: string,
    schema: T,
    init?: RequestInit,
  ): Promise<z.output<T>> => {
    const response = await fetchImpl(new URL(path, base).toString(), {
      ...init,
      headers: { ...(await headers()), ...(init?.headers as Record<string, string> | undefined) },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(body);
      throw new ApiRequestError(
        response.status,
        error.success
          ? error.data
          : {
              code: "INTERNAL_ERROR",
              message: `The server answered ${String(response.status)}.`,
            },
      );
    }
    return schema.parse(body);
  };
  return {
    get: (path, schema) => call(path, schema),
    post: (path, body, schema) =>
      call(path, schema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    patch: (path, body, schema) =>
      call(path, schema, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}
