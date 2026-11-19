import { describe, expect, it } from "vitest";
import { errorResponse, jsonResponse } from "../../../../src/controller/web-api/shared/response";

describe("web-api responses", () => {
  it("serializes JSON without caching", () => {
    expect(jsonResponse(200, { a: 1 })).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: '{"a":1}',
    });
  });

  it("builds the shared error body", () => {
    expect(JSON.parse(errorResponse(500, "INTERNAL_ERROR", "Broken.").body)).toEqual({
      code: "INTERNAL_ERROR",
      message: "Broken.",
    });
  });
});
