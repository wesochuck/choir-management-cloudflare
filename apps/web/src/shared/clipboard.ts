export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function copyRichLink({
  label,
  url,
}: {
  readonly label: string;
  readonly url: string;
}): Promise<void> {
  const plainText = `${label}: ${url}`;
  const htmlText = `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard.write === "function" &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      const htmlBlob = new Blob([htmlText], { type: "text/html" });
      const textBlob = new Blob([plainText], { type: "text/plain" });
      const item = new ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": textBlob,
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // Fall through to plain text clipboard fallback
    }
  }

  if (typeof navigator !== "undefined" && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(plainText);
  }
}
