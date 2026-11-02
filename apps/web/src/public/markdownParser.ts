import React, { type ReactNode } from "react";
import { markdownLinkLabel, markdownLinkSource, safePublicLinkUrl } from "../shared/markdownLinks";

function plainTextLinks(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(/(?:https?:\/\/|mailto:)[^\s<>"']+/g)) {
    const url = match[0].replace(/[.,!?;:)]+$/, "");
    nodes.push(text.slice(offset, match.index));
    nodes.push(
      safePublicLinkUrl(url)
        ? React.createElement(
            "a",
            {
              href: url,
              key: `${keyPrefix}-${String(match.index)}`,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            url,
          )
        : url,
    );
    offset = match.index + url.length;
  }
  nodes.push(text.slice(offset));
  return nodes;
}

/** Safe inline Markdown with optional explicit tab targets. Legacy links keep opening in a new tab. */
export function parseInlineMarkdown(text: string): ReactNode[] {
  return parseInlineTokens(text, 0, true);
}

function inlineText(text: string, key: string, allowLinks: boolean): ReactNode[] {
  return allowLinks ? plainTextLinks(text, key) : [text];
}

function parseInlineTokens(text: string, depth: number, allowLinks: boolean): ReactNode[] {
  // Bounded nesting supports emphasis around links and within labels without nested anchors.
  if (depth >= 8) return [text];
  const tokenRegex = new RegExp(
    `${allowLinks ? `${markdownLinkSource}|` : ""}\\*\\*([^*]+)\\*\\*|\\*([^*]+)\\*`,
    "g",
  );
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex)
      nodes.push(
        ...inlineText(text.slice(lastIndex, match.index), `plain-${String(lastIndex)}`, allowLinks),
      );
    const fullMatch = match[0];
    const [linkText, linkUrl, target, boldText, italicText] = allowLinks
      ? match.slice(1)
      : [undefined, undefined, undefined, ...match.slice(1)];
    if (linkText !== undefined && linkUrl !== undefined) {
      const href = safePublicLinkUrl(linkUrl);
      nodes.push(
        href
          ? React.createElement(
              "a",
              {
                href,
                key: `link-${String(keyIndex++)}`,
                rel: "noopener noreferrer",
                target: target === "_self" ? undefined : "_blank",
              },
              ...parseInlineTokens(markdownLinkLabel(linkText), depth + 1, false),
            )
          : fullMatch,
      );
    } else if (boldText !== undefined) {
      nodes.push(
        React.createElement(
          "strong",
          { key: `bold-${String(keyIndex++)}` },
          ...parseInlineTokens(boldText, depth + 1, allowLinks),
        ),
      );
    } else if (italicText !== undefined) {
      nodes.push(
        React.createElement(
          "em",
          { key: `italic-${String(keyIndex++)}` },
          ...parseInlineTokens(italicText, depth + 1, allowLinks),
        ),
      );
    }
    lastIndex = match.index + fullMatch.length;
  }
  if (lastIndex < text.length)
    nodes.push(...inlineText(text.slice(lastIndex), `plain-${String(lastIndex)}`, allowLinks));
  return nodes.length > 0 ? nodes : [text];
}
