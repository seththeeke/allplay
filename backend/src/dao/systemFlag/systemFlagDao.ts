import type { SystemFlag } from "../../models/systemFlag";

/** System flag persistence (data-model.md section 14); one contract test covers both implementations. */
export interface SystemFlagDao {
  /** The flag, or null when it was never written. */
  get(flagId: SystemFlag["flagId"]): Promise<SystemFlag | null>;
  /** Writes the flag, keeping its original `createdAt`. */
  put(flag: SystemFlag): Promise<SystemFlag>;
}
