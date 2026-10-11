/**
 * Copies exactly the given URL to the clipboard as plain text, so pasting
 * yields the bare link with no added labels or rich-text markup. Throws when
 * the async clipboard is unavailable so callers can surface their copy-error
 * messaging.
 */
export async function copyPlainTextUrl(url: string): Promise<void> {
  if (typeof navigator === "undefined" || typeof navigator.clipboard.writeText !== "function") {
    throw new Error("Clipboard is unavailable.");
  }
  await navigator.clipboard.writeText(url);
}
