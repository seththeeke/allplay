import { describe } from "vitest";
import { createInMemoryPreferenceDao } from "../../../src/dao/preference/inMemoryPreferenceDao";
import { preferenceDaoContract } from "./preferenceDaoContract";

describe("InMemoryPreferenceDao", () => {
  preferenceDaoContract(createInMemoryPreferenceDao, (name) => `memory-${name}`);
});
