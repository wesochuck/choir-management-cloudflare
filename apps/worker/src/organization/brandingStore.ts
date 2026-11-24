import type { OrganizationBranding } from "@choir/contracts";
import { z } from "zod";

interface MetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly logoFileId: string | null;
  readonly logoVerifiedContentType: string | null;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly physicalAddress: string | null;
}

export function readVerifiedLogoFromStore(
  storage: DurableObjectStorage,
  organizationId: string,
): {
  readonly logoFileId: string | null;
  readonly logoVerifiedContentType: string | null;
} {
  const row = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly logoFileId: string | null;
      readonly logoVerifiedContentType: string | null;
      readonly organizationId: string;
    }>(
      `SELECT organization_id AS organizationId, logo_file_id AS logoFileId,
        logo_verified_content_type AS logoVerifiedContentType
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
  if (row?.organizationId !== organizationId) {
    return { logoFileId: null, logoVerifiedContentType: null };
  }
  return {
    logoFileId: row.logoFileId,
    logoVerifiedContentType: row.logoVerifiedContentType,
  };
}

export function readBrandingFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const row = storage.sql
    .exec<MetadataRow>(
      `SELECT organization_id AS organizationId, name AS organizationName,
        logo_file_id AS logoFileId, logo_verified_content_type AS logoVerifiedContentType,
        physical_address AS physicalAddress
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
  if (!row || (organizationId && row.organizationId !== organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const result: OrganizationBranding = {
    logoFileId: row.logoFileId,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    physicalAddress: row.physicalAddress ? row.physicalAddress.trim() : null,
  };
  return Response.json(result);
}

const verifiedLogoMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);

const updateBrandingSchema = z.object({
  logoFileId: z.uuid().nullable().optional(),
  logoVerifiedContentType: verifiedLogoMimeSchema.nullable().optional(),
  physicalAddress: z.string().max(2_000).nullable().optional(),
});

export async function updateBrandingInStore(
  storage: DurableObjectStorage,
  organizationId: string,
  request: Request,
): Promise<Response> {
  const body: unknown = await request.json();
  const parsed = updateBrandingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: "validation_failed", message: "Invalid branding update payload." },
      { status: 400 },
    );
  }
  const hasLogoUpdate = "logoFileId" in parsed.data;
  const nextLogoFileId = parsed.data.logoFileId ?? null;
  const nextVerifiedContentType = nextLogoFileId
    ? (parsed.data.logoVerifiedContentType ?? null)
    : null;
  if (hasLogoUpdate && nextLogoFileId !== null && nextVerifiedContentType === null) {
    return Response.json(
      {
        code: "invalid_logo_image",
        message: "Organization logos must be verified PNG, JPEG, or WebP images.",
      },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  if (hasLogoUpdate && "physicalAddress" in parsed.data) {
    storage.sql.exec(
      `UPDATE organization_metadata
       SET logo_file_id = ?, logo_verified_content_type = ?, physical_address = ?, updated_at = ?
       WHERE organization_id = ?`,
      nextLogoFileId,
      nextVerifiedContentType,
      parsed.data.physicalAddress ? parsed.data.physicalAddress.trim() : "",
      now,
      organizationId,
    );
  } else if (hasLogoUpdate) {
    storage.sql.exec(
      `UPDATE organization_metadata
       SET logo_file_id = ?, logo_verified_content_type = ?, updated_at = ?
       WHERE organization_id = ?`,
      nextLogoFileId,
      nextVerifiedContentType,
      now,
      organizationId,
    );
  } else if ("physicalAddress" in parsed.data) {
    storage.sql.exec(
      "UPDATE organization_metadata SET physical_address = ?, updated_at = ? WHERE organization_id = ?",
      parsed.data.physicalAddress ? parsed.data.physicalAddress.trim() : "",
      now,
      organizationId,
    );
  }
  return readBrandingFromStore(storage, organizationId);
}
