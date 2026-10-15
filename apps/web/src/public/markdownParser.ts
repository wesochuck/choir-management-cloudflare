import React, { type ReactNode } from "react";

function isSafeUrl(url: string): boolean {
  try {
    const trimmed = url.trim();
    if (trimmed.startsWith("mailto:")) return true;
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Parses inline Markdown formatting:
 * - Links: [label](url) where url is https://, http://, or mailto:
 * - Bold: **text**
 * - Italic: *text*
 * All text content is safely escaped by React.
 */
export function parseInlineMarkdown(text: string): ReactNode[] {
  const tokenRegex = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const [fullMatch, linkText, linkUrl, boldText, italicText] = match;
    if (linkText !== undefined && linkUrl !== undefined) {
      if (isSafeUrl(linkUrl)) {
        nodes.push(
          React.createElement(
            "a",
            {
              href: linkUrl.trim(),
              key: `link-${String(keyIndex++)}`,
              rel: "noopener noreferrer",
              target: "_blank",
            },
            linkText,
          ),
        );
      } else {
        nodes.push(fullMatch);
      }
    } else if (boldText !== undefined) {
      nodes.push(React.createElement("strong", { key: `bold-${String(keyIndex++)}` }, boldText));
    } else if (italicText !== undefined) {
      nodes.push(React.createElement("em", { key: `italic-${String(keyIndex++)}` }, italicText));
    }
    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}
