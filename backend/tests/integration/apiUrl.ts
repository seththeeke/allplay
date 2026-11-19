/** The stage API base URL from API_URL, always ending in a slash. */
export function apiUrl(): string {
  const value = process.env["API_URL"];
  if (value === undefined || value === "") {
    throw new Error("Set API_URL to the stage's API URL to run integration tests.");
  }
  return value.endsWith("/") ? value : `${value}/`;
}
