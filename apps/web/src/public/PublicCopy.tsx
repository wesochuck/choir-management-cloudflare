import { parseWebsiteContentImage } from "@choir/domain";
import { parseInlineMarkdown } from "./markdownParser";

export function PublicCopy({
  text,
  imageUrl,
}: {
  readonly text?: string | null | undefined;
  readonly imageUrl?: ((fileId: string) => string | null) | undefined;
}) {
  if (!text?.trim()) return null;
  return (
    <div className="public-copy">
      {text
        .replace(/\r\n?/g, "\n")
        .trim()
        .split(/\n(?:[ \t]*\n)+/)
        .map((block, index) => {
          const normalized = block.trim();
          const image = imageUrl ? parseWebsiteContentImage(normalized) : null;
          if (image && imageUrl) {
            const src = imageUrl(image.fileId);
            return src ? (
              <figure className="public-content-image" key={index}>
                <img alt={image.alt} src={src} loading="lazy" decoding="async" />
                {image.caption ? <figcaption>{image.caption}</figcaption> : null}
              </figure>
            ) : (
              <p key={index}>Image unavailable.</p>
            );
          }
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
