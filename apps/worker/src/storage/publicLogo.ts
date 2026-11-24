import type { Env } from "../env";
import {
  ALLOWED_PUBLIC_LOGO_MIME_TYPES,
  isVerifiedPublicLogoMimeType,
  MAX_PUBLIC_LOGO_BYTES,
  sniffPublicLogoMimeType,
  type VerifiedPublicLogoMimeType,
} from "../routes/helpers/fileHelpers";
import { readPrivateOrganizationFile } from "./privateFiles";

type PublicLogoEnv = Pick<Env, "ORGANIZATION_FILES" | "ORGANIZATION_STORE">;

export type VerifyPublicLogoResult =
  | { readonly ok: false; readonly reason: "invalid_format" | "not_found" | "too_large" }
  | { readonly ok: true; readonly verifiedContentType: VerifiedPublicLogoMimeType };

export interface VerifiedLogoImage {
  readonly bytes: ArrayBuffer;
  readonly etag: string;
  readonly verifiedContentType: VerifiedPublicLogoMimeType;
}

export async function verifyPublicLogoCandidate(
  env: PublicLogoEnv,
  organizationId: string,
  fileId: string,
): Promise<VerifyPublicLogoResult> {
  const file = await readPrivateOrganizationFile(env, organizationId, fileId, "bytes=0-15");
  if (!file) {
    return { ok: false, reason: "not_found" };
  }
  if (file.metadata.sizeBytes > MAX_PUBLIC_LOGO_BYTES) {
    await file.object.body.cancel().catch(() => undefined);
    return { ok: false, reason: "too_large" };
  }
  if (!ALLOWED_PUBLIC_LOGO_MIME_TYPES.has(file.metadata.contentType)) {
    await file.object.body.cancel().catch(() => undefined);
    return { ok: false, reason: "invalid_format" };
  }
  const headerBytes = new Uint8Array(await file.object.arrayBuffer());
  const sniffed = sniffPublicLogoMimeType(headerBytes);
  if (!sniffed || sniffed !== file.metadata.contentType) {
    return { ok: false, reason: "invalid_format" };
  }
  return { ok: true, verifiedContentType: sniffed };
}

export async function readVerifiedLogoImage(
  env: PublicLogoEnv,
  organizationId: string,
  logoFileId: string,
  expectedVerifiedContentType: string | null | undefined,
): Promise<VerifiedLogoImage | null> {
  if (!isVerifiedPublicLogoMimeType(expectedVerifiedContentType)) {
    return null;
  }
  const file = await readPrivateOrganizationFile(env, organizationId, logoFileId);
  if (!file) {
    return null;
  }
  if (
    file.metadata.sizeBytes > MAX_PUBLIC_LOGO_BYTES ||
    file.metadata.contentType !== expectedVerifiedContentType
  ) {
    await file.object.body.cancel().catch(() => undefined);
    return null;
  }
  const bytes = await file.object.arrayBuffer();
  if (bytes.byteLength !== file.metadata.sizeBytes) {
    return null;
  }
  const sniffed = sniffPublicLogoMimeType(new Uint8Array(bytes.slice(0, 16)));
  if (sniffed !== expectedVerifiedContentType) {
    return null;
  }
  return {
    bytes,
    etag: file.object.httpEtag,
    verifiedContentType: expectedVerifiedContentType,
  };
}
