/** The message to show for a failed account call: the error's own text, or a plain fallback. */
export function errorMessage(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message.length > 0 ? failure.message : fallback;
}
