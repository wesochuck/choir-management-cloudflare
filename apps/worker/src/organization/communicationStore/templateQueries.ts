import { communicationTemplateSchema } from "@choir/contracts";
import { z } from "zod";

import { type TemplateRow } from "./contracts";
import { identityMatches } from "./shared";

interface TemplateCursor {
  readonly id: string;
  readonly isSystem: number;
  readonly title: string;
}

function parseTemplateCursor(cursor: string | null): TemplateCursor | null {
  if (!cursor || cursor.length > 512) return null;
  const parts = cursor.split("|");
  if (parts.length !== 3) return null;
  const isSystemStr = parts[0];
  const encodedTitle = parts[1];
  const id = parts[2];
  if (!isSystemStr || !encodedTitle || !id) return null;
  const isSystem = Number(isSystemStr);
  if (isSystem !== 0 && isSystem !== 1) return null;
  if (id.length > 128) return null;
  try {
    const title = decodeURIComponent(encodedTitle);
    return { id, isSystem, title };
  } catch {
    return null;
  }
}

function queryTemplateRows(
  storage: DurableObjectStorage,
  cursor: TemplateCursor | null,
  limit: number,
): readonly TemplateRow[] {
  if (cursor) {
    return storage.sql
      .exec<TemplateRow>(
        `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
          is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
         FROM communication_templates
         WHERE is_system < ?
           OR (is_system = ? AND (
             title COLLATE NOCASE > ?
             OR (title COLLATE NOCASE = ? AND id > ?)
           ))
         ORDER BY is_system DESC, title COLLATE NOCASE ASC, id ASC
         LIMIT ?`,
        cursor.isSystem,
        cursor.isSystem,
        cursor.title,
        cursor.title,
        cursor.id,
        limit + 1,
      )
      .toArray();
  }
  return storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates
       ORDER BY is_system DESC, title COLLATE NOCASE ASC, id ASC
       LIMIT ?`,
      limit + 1,
    )
    .toArray();
}

function parseTemplatesInput(
  input:
    | string
    | null
    | {
        readonly cursor?: string | null;
        readonly limit?: string | number | null;
        readonly organizationId: string | null;
      },
): {
  readonly cursor: TemplateCursor | null;
  readonly limit: number;
  readonly organizationId: string | null;
} {
  if (typeof input === "string" || input === null) {
    return { cursor: null, limit: 50, organizationId: input };
  }
  const rawLimit = Number(input.limit ?? 50);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  const cursor = parseTemplateCursor(input.cursor ?? null);
  return { cursor, limit, organizationId: input.organizationId };
}

export function listCommunicationTemplatesFromStore(
  storage: DurableObjectStorage,
  input:
    | string
    | null
    | {
        readonly cursor?: string | null;
        readonly limit?: string | number | null;
        readonly organizationId: string | null;
      },
): Response {
  const { cursor, limit, organizationId } = parseTemplatesInput(input);
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }

  const rows = queryTemplateRows(storage, cursor, limit);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const templates = pageRows.map((row) =>
    communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }),
  );

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? `${lastRow.isSystem ? "1" : "0"}|${encodeURIComponent(lastRow.title)}|${lastRow.id}`
      : null;

  return Response.json({
    nextCursor,
    templates,
  });
}

export function readCommunicationTemplateFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  templateId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsedId = z.uuid().safeParse(templateId);
  if (!parsedId.success) {
    return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
         is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      parsedId.data,
    )
    .toArray()
    .at(0);
  return row
    ? Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }))
    : Response.json({ code: "communication_template_not_found" }, { status: 404 });
}
