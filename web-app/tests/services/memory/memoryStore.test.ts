import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../../../src/services/memory/memoryStore";

function throwingStorage(): Storage {
  const fail = (): never => {
    throw new Error("blocked");
  };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, length: 0 };
}

describe("createMemoryStore", () => {
  it("returns the fallback for unknown keys and round-trips values", () => {
    const store = createMemoryStore(null);
    expect(store.read("missing", 7)).toBe(7);
    store.write("k", { a: 1 });
    expect(store.read("k", null)).toEqual({ a: 1 });
  });

  it("mirrors values into storage and reads them back in a new store", () => {
    createMemoryStore(localStorage).write("shared", [1, 2]);
    expect(createMemoryStore(localStorage).read("shared", [])).toEqual([1, 2]);
  });

  it("falls back when stored JSON is corrupt", () => {
    localStorage.setItem("bad", "{not json");
    expect(createMemoryStore(localStorage).read("bad", "fallback")).toBe("fallback");
  });

  it("keeps working when storage throws", () => {
    const store = createMemoryStore(throwingStorage());
    expect(store.read("k", 1)).toBe(1);
    store.write("k", 2);
    expect(store.read("k", 1)).toBe(2);
  });

  it("uses localStorage by default", () => {
    createMemoryStore().write("default", true);
    expect(localStorage.getItem("default")).toBe("true");
  });
});

describe("createMemoryStore without browser storage", () => {
  it("falls back to memory when localStorage access throws", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("denied");
      },
    });
    try {
      const store = createMemoryStore();
      store.write("k", 1);
      expect(store.read("k", 0)).toBe(1);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });
});
