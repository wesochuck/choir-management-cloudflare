export function buildMusicPublisherSearchUrl(template: string, catalogId: string): string | null {
  const trimmedTemplate = template.trim();
  const trimmedCatalogId = catalogId.trim();
  if (!trimmedTemplate || !trimmedCatalogId || !trimmedTemplate.includes("{catalogId}")) {
    return null;
  }
  const candidate = trimmedTemplate.replaceAll("{catalogId}", encodeURIComponent(trimmedCatalogId));
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
