import {
  organizationResourceOrderRequestSchema,
  organizationResourceRequestSchema,
  organizationResourceSchema,
  type OrganizationResource,
} from "@choir/contracts";
import { z } from "zod";

const contextSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const operationSchema = z.discriminatedUnion("action", [
  contextSchema.extend({
    action: z.literal("create"),
    resource: organizationResourceRequestSchema,
    resourceId: z.uuid(),
  }),
  contextSchema.extend({
    action: z.literal("update"),
    resource: organizationResourceRequestSchema,
    resourceId: z.uuid(),
  }),
  contextSchema.extend({ action: z.literal("delete"), resourceId: z.uuid() }),
  contextSchema.extend({
    action: z.literal("reorder"),
    ...organizationResourceOrderRequestSchema.shape,
  }),
]);

interface ResourceRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly fileId: string | null;
  readonly id: string;
  readonly sortOrder: number;
  readonly title: string;
  readonly updatedAt: string;
  readonly url: string | null;
}

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}
const columns =
  "id, title, file_id AS fileId, url, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt";

function identityMatches(storage: DurableObjectStorage, organizationId: string): boolean {
  return (
    storage.sql
      .exec<IdentityRow>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId === organizationId
  );
}

function parseRow(row: ResourceRow): OrganizationResource {
  return organizationResourceSchema.parse(row);
}

function readResource(
  storage: DurableObjectStorage,
  resourceId: string,
): OrganizationResource | null {
  const row = storage.sql
    .exec<ResourceRow>(
      `SELECT ${columns} FROM organization_resources WHERE id = ? LIMIT 1`,
      resourceId,
    )
    .toArray()
    .at(0);
  return row ? parseRow(row) : null;
}

function audit(
  storage: DurableObjectStorage,
  operation: z.infer<typeof operationSchema>,
  action: string,
  targetId: string,
  summary: unknown,
  occurredAt: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, 'organization_resource', ?, ?, ?, ?)`,
    `resource:${action}:${operation.requestId}`,
    operation.actorUserId,
    action,
    targetId,
    operation.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

function validateFile(storage: DurableObjectStorage, fileId: string | null): Response | null {
  if (!fileId) return null;
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM private_files WHERE id = ? AND status = 'ready'",
      fileId,
    )
    .one().count;
  return found === 1 ? null : Response.json({ code: "resource_file_not_found" }, { status: 409 });
}

export function listResourcesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const rows = storage.sql
    .exec<ResourceRow>(
      `SELECT ${columns} FROM organization_resources ORDER BY sort_order, title COLLATE NOCASE, id LIMIT 500`,
    )
    .toArray();
  const resources: OrganizationResource[] = [];
  for (const row of rows) {
    const parsed = organizationResourceSchema.safeParse(row);
    if (!parsed.success) {
      return Response.json({ code: "resource_data_invalid" }, { status: 500 });
    }
    resources.push(parsed.data);
  }
  return Response.json({ resources });
}

function reorderResources(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof operationSchema>, { readonly action: "reorder" }>,
  occurredAt: string,
): Response {
  const existing = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM organization_resources ORDER BY id",
    )
    .toArray()
    .map(({ id }) => id);
  const supplied = [...operation.resourceIds].sort();
  if (
    new Set(supplied).size !== supplied.length ||
    existing.length !== supplied.length ||
    existing.some((id, index) => id !== supplied[index])
  ) {
    return Response.json({ code: "resource_order_mismatch" }, { status: 409 });
  }
  storage.transactionSync(() => {
    operation.resourceIds.forEach((id, index) =>
      storage.sql.exec(
        "UPDATE organization_resources SET sort_order = ?, updated_at = ? WHERE id = ?",
        index,
        occurredAt,
        id,
      ),
    );
    audit(
      storage,
      operation,
      "organization.resource.reordered",
      operation.organizationId,
      { resourceIds: operation.resourceIds },
      occurredAt,
    );
  });
  return Response.json({ resources: operation.resourceIds.map((id) => readResource(storage, id)) });
}

export async function manageResourceInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = operationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_resource_operation" }, { status: 400 });
  const operation = parsed.data;
  if (!identityMatches(storage, operation.organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const occurredAt = new Date().toISOString();

  if (operation.action === "reorder") return reorderResources(storage, operation, occurredAt);

  const existing = readResource(storage, operation.resourceId);
  if (operation.action === "delete") {
    if (!existing) return Response.json({ code: "resource_not_found" }, { status: 404 });
    storage.transactionSync(() => {
      storage.sql.exec("DELETE FROM organization_resources WHERE id = ?", operation.resourceId);
      audit(
        storage,
        operation,
        "organization.resource.deleted",
        operation.resourceId,
        { fileId: existing.fileId, title: existing.title },
        occurredAt,
      );
    });
    return Response.json(existing);
  }
  if (operation.action === "update" && !existing)
    return Response.json({ code: "resource_not_found" }, { status: 404 });
  if (
    operation.action === "update" &&
    existing &&
    (existing.fileId !== operation.resource.fileId || existing.url !== operation.resource.url)
  ) {
    return Response.json({ code: "resource_target_immutable" }, { status: 409 });
  }
  const fileError = validateFile(storage, operation.resource.fileId);
  if (fileError) return fileError;
  storage.transactionSync(() => {
    if (operation.action === "create") {
      storage.sql.exec(
        "INSERT INTO organization_resources (id, title, file_id, url, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        operation.resourceId,
        operation.resource.title,
        operation.resource.fileId,
        operation.resource.url,
        operation.resource.sortOrder,
        occurredAt,
        occurredAt,
      );
    } else {
      storage.sql.exec(
        "UPDATE organization_resources SET title = ?, file_id = ?, url = ?, sort_order = ?, updated_at = ? WHERE id = ?",
        operation.resource.title,
        operation.resource.fileId,
        operation.resource.url,
        operation.resource.sortOrder,
        occurredAt,
        operation.resourceId,
      );
    }
    audit(
      storage,
      operation,
      `organization.resource.${operation.action === "create" ? "created" : "updated"}`,
      operation.resourceId,
      {
        fileId: operation.resource.fileId,
        title: operation.resource.title,
        url: operation.resource.url,
      },
      occurredAt,
    );
  });
  return Response.json(readResource(storage, operation.resourceId));
}
