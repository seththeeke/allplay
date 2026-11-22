import { useState } from "react";

/** Which of a page's actions is waiting on the network, so its button can show it. */
export function useBusy<Key extends string>(): {
  busy: Key | null;
  track: <T>(key: Key, work: Promise<T>) => Promise<T>;
} {
  const [busy, setBusy] = useState<Key | null>(null);
  return {
    busy,
    track: async (key, work) => {
      setBusy(key);
      try {
        return await work;
      } finally {
        setBusy(null);
      }
    },
  };
}
