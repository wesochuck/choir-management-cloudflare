import { parseInlineMarkdown } from "./markdownParser";

export function PublicCopy({ text }: { readonly text?: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <div className="public-copy">
      {text
        .replace(/\r\n?/g, "\n")
        .trim()
        .split(/\n(?:[ \t]*\n)+/)
        .map((block, index) => {
          const normalized = block.trim();
          if (normalized.startsWith("### ")) {
            return <h4 key={index}>{parseInlineMarkdown(normalized.slice(4))}</h4>;
          }
          if (normalized.startsWith("## ")) {
            return <h3 key={index}>{parseInlineMarkdown(normalized.slice(3))}</h3>;
          }
          if (normalized.startsWith("# ")) {
            return <h2 key={index}>{parseInlineMarkdown(normalized.slice(2))}</h2>;
          }
          return <p key={index}>{parseInlineMarkdown(normalized)}</p>;
        })}
    </div>
  );
}
