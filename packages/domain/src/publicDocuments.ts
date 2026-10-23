export const MAX_PUBLIC_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PUBLIC_DOCUMENTS_PER_ORGANIZATION = 50;

export const PUBLIC_DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type PublicDocumentContentType = (typeof PUBLIC_DOCUMENT_CONTENT_TYPES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function publicDocumentSlugBase(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  if (!normalized) {
    return "document";
  }

  // Prevent collision with UUID lookups when identifier only contains hex chars & hyphens
  const result = /^[0-9a-f-]+$/.test(normalized) ? `doc-${normalized}` : normalized;
  return result.slice(0, 80).replace(/-+$/g, "");
}

export function publicDocumentExtension(contentType: PublicDocumentContentType): "pdf" | "docx" {
  return contentType === "application/pdf" ? "pdf" : "docx";
}

export function publicDocumentPath(doc: {
  readonly contentType: PublicDocumentContentType;
  readonly slug: string;
}): string {
  return `/api/public/documents/${doc.slug}.${publicDocumentExtension(doc.contentType)}`;
}

export function parsePublicDocumentIdentifier(
  raw: string,
): { readonly kind: "id" | "slug"; readonly value: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed.replace(/\.(?:pdf|docx)$/i, "");
  if (!cleaned) {
    return null;
  }

  if (UUID_PATTERN.test(cleaned)) {
    return { kind: "id", value: cleaned.toLowerCase() };
  }

  const lowerSlug = cleaned.toLowerCase();
  if (SLUG_PATTERN.test(lowerSlug)) {
    return { kind: "slug", value: lowerSlug };
  }

  return null;
}
