/** Returns a value that a test expects to exist, failing the test with a clear message otherwise. */
export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to exist`);
  return value;
}
