import type { OrganizationBranding } from "@choir/contracts";
import { z } from "zod";

interface MetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly logoFileId: string | null;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly physicalAddress: string | null;
}

export function readBrandingFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const row = storage.sql
    .exec<MetadataRow>(
      `SELECT organization_id AS organizationId, name AS organizationName,
        logo_file_id AS logoFileId, physical_address AS physicalAddress
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

const updateBrandingSchema = z.object({
  logoFileId: z.uuid().nullable().optional(),
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
  const now = new Date().toISOString();
  if ("logoFileId" in parsed.data && "physicalAddress" in parsed.data) {
    storage.sql.exec(
      "UPDATE organization_metadata SET logo_file_id = ?, physical_address = ?, updated_at = ? WHERE organization_id = ?",
      parsed.data.logoFileId ?? null,
      parsed.data.physicalAddress ? parsed.data.physicalAddress.trim() : "",
      now,
      organizationId,
    );
  } else if ("logoFileId" in parsed.data) {
    storage.sql.exec(
      "UPDATE organization_metadata SET logo_file_id = ?, updated_at = ? WHERE organization_id = ?",
      parsed.data.logoFileId ?? null,
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
