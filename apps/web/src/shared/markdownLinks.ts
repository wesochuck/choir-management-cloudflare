export const markdownLinkSource = String.raw`\[((?:\\.|[^\]\\])+)\]\(([^)\s]+)\)(?:\{target="(_blank|_self)"\})?`;

export function safePublicLinkUrl(value: string): string | null {
  const url = value.trim();
  if (!url || /[\p{Cc}\s\\]/u.test(url)) return null;
  if (url.startsWith("#")) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function normalizeEditorLinkUrl(value: string): string | null {
  const trimmed = value.trim();
  return (
    safePublicLinkUrl(trimmed) ??
    (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(trimmed)
      ? safePublicLinkUrl(`https://${trimmed}`)
      : null)
  );
}

export function markdownLinkLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, "$1");
}

export function markdownLinkSelection(value: string, start: number, end: number) {
  for (const match of value.matchAll(new RegExp(markdownLinkSource, "g"))) {
    const linkEnd = match.index + match[0].length;
    if (start < match.index || end > linkEnd) continue;
    return {
      start: match.index,
      end: linkEnd,
      text: markdownLinkLabel(match[1] ?? ""),
      url: match[2] ?? "",
      newTab: match[3] !== "_self",
      existing: true,
    };
  }
  return { start, end, text: value.slice(start, end), url: "", newTab: false, existing: false };
}

export function formatMarkdownLink(text: string, url: string, newTab: boolean): string {
  const label = text
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, " ");
  const destination = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${label}](${destination}){target="${newTab ? "_blank" : "_self"}"}`;
}
