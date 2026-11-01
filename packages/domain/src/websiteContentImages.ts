/** Organization-private image references become versioned public URLs only during publication. */
export interface WebsiteContentImage {
  readonly fileId: string;
  readonly alt: string;
  readonly caption: string;
}
const imageBlock =
  /^!\[((?:\\.|[^\]\\])*)\]\(choir-image:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?: "((?:\\.|[^"\\])*)")?\)$/i;
function unescape(value: string): string {
  return value.replace(/\\([\\[\]"])/g, "$1");
}
function escape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}
export function parseWebsiteContentImage(block: string): WebsiteContentImage | null {
  const match = imageBlock.exec(block.trim());
  if (!match) return null;
  const alt = unescape(match[1] ?? "");
  const caption = unescape(match[3] ?? "");
  if (!alt.trim() || alt.length > 500 || caption.length > 1_000) return null;
  return { fileId: (match[2] ?? "").toLowerCase(), alt, caption };
}
export function formatWebsiteContentImage(image: WebsiteContentImage): string {
  return `![${escape(image.alt.trim())}](choir-image:${image.fileId}${image.caption.trim() ? ` "${escape(image.caption.trim())}"` : ""})`;
}
export function websiteImageSelection(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextLine = value.indexOf("\n", end);
  const lineEnd = nextLine < 0 ? value.length : nextLine;
  const image = parseWebsiteContentImage(value.slice(lineStart, lineEnd));
  return image ? { start: lineStart, end: lineEnd, image } : { start, end, image: null };
}
export function websiteContentImageIds(settings: {
  readonly aboutUsText: string;
  readonly historyText: string;
  readonly pages?: readonly { readonly body: string }[] | undefined;
}): string[] {
  const texts = [
    settings.aboutUsText,
    ...(settings.pages === undefined
      ? [settings.historyText]
      : settings.pages.map((page) => page.body)),
  ];
  const ids = new Set<string>();
  for (const text of texts)
    for (const block of text.replace(/\r\n?/g, "\n").split(/\n(?:[ \t]*\n)+/)) {
      const image = parseWebsiteContentImage(block);
      if (image) ids.add(image.fileId);
    }
  return [...ids];
}
