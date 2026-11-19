import type { ApiErrorCode } from "../../../models/api";

/** API Gateway HTTP API (payload 2.0) result returned by every web-api handler. */
export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export function jsonResponse(statusCode: number, body: unknown): HttpResult {
  return { statusCode, headers: { ...HEADERS }, body: JSON.stringify(body) };
}

export function errorResponse(statusCode: number, code: ApiErrorCode, message: string): HttpResult {
  return jsonResponse(statusCode, { code, message });
}
