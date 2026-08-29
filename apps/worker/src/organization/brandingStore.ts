import type { OrganizationBranding } from "@choir/contracts";
import { z } from "zod";

interface MetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly logoFileId: string | null;
  readonly organizationId: string;
  readonly organizationName: string;
}

export function readBrandingFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const row = storage.sql
    .exec<MetadataRow>(
      `SELECT organization_id AS organizationId, name AS organizationName,
        logo_file_id AS logoFileId
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
  };
  return Response.json(result);
}

const updateBrandingSchema = z.object({
  logoFileId: z.uuid().nullable(),
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
  storage.sql.exec(
    "UPDATE organization_metadata SET logo_file_id = ?, updated_at = ? WHERE organization_id = ?",
    parsed.data.logoFileId,
    now,
    organizationId,
  );
  return readBrandingFromStore(storage, organizationId);
}
