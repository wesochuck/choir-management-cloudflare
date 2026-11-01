import type { PublishedOrganizationProjection } from "@choir/contracts";
import { PublicCopy } from "./PublicCopy";
import { mediaUrl } from "./publicMedia";

export function WebsiteCopy({
  text,
  projection,
}: {
  readonly text: string;
  readonly projection: PublishedOrganizationProjection;
}) {
  const files = new Set(projection.payload.mediaFileIds);
  return (
    <PublicCopy
      text={text}
      imageUrl={(fileId) => (files.has(fileId) ? mediaUrl(projection, fileId) : null)}
    />
  );
}
export function DraftWebsiteCopy({ text }: { readonly text: string }) {
  return <PublicCopy text={text} imageUrl={(fileId) => `/api/organization/files/${fileId}`} />;
}
