import type { PublishedOrganizationProjection } from "@choir/contracts";

export function mediaUrl(projection: PublishedOrganizationProjection, fileId: string): string {
  return `/api/public/media/${String(projection.version)}/${encodeURIComponent(fileId)}`;
}
