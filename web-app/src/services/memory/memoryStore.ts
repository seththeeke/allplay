/**
 * In-memory store for the prototype's mock services. It mirrors values into
 * localStorage when available so a reload keeps prototype state; storage
 * failures (private windows, blocked storage) fall back to memory only.
 */
export interface MemoryStore {
  read<T>(key: string, fallback: T): T;
  write(key: string, value: unknown): void;
}

export function createMemoryStore(storage: Storage | null = safeLocalStorage()): MemoryStore {
  const memory = new Map<string, string>();
  return {
    read<T>(key: string, fallback: T): T {
      const raw = memory.get(key) ?? safeGet(storage, key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    write(key: string, value: unknown): void {
      const raw = JSON.stringify(value);
      memory.set(key, raw);
      try {
        storage?.setItem(key, raw);
      } catch {
        /* Storage is a convenience; memory already holds the value. */
      }
    },
  };
}

function safeGet(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
