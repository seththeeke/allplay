import { describe, expect, it } from "vitest";
import { DEFAULT_APP_PREFERENCES, PreferencesResponseSchema } from "../../src/models/api";

describe("api models alias", () => {
  it("re-exports the backend contract models", () => {
    expect(
      PreferencesResponseSchema.parse({ app: DEFAULT_APP_PREFERENCES, games: {} }).app.theme,
    ).toBe("DEFAULT");
  });
});
