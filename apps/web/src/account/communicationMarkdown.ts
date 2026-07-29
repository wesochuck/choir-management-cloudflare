function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

export function renderCommunicationMarkdownPreview(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("### ")) return `<h5>${renderInline(trimmed.slice(4))}</h5>`;
      if (trimmed.startsWith("## ")) return `<h4>${renderInline(trimmed.slice(3))}</h4>`;
      if (trimmed.startsWith("# ")) return `<h3>${renderInline(trimmed.slice(2))}</h3>`;
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        return `<li>${renderInline(trimmed.slice(2))}</li>`;
      }
      return trimmed ? `<p>${renderInline(trimmed)}</p>` : "<br />";
    })
    .join("")
    .replace(/(<li>.*?<\/li>)+/g, (list) => `<ul>${list}</ul>`);
}
