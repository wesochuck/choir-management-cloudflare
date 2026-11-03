import {
  checkoutReminderTemplates,
  checkoutReminderPlaceholderTags,
  extractCommunicationPlaceholders,
} from "@choir/domain";
import { communicationTemplateSchema, type CommunicationTemplate } from "@choir/contracts";
import type { z } from "zod";

import type {
  deleteTemplateOperationSchema,
  resetTemplateToSystemDefaultOperationSchema,
  saveTemplateOperationSchema,
  updateTemplateOperationSchema,
  TemplateRow,
} from "./contracts";
import { audit } from "./shared";
import { getSystemCommunicationTemplateDefault } from "../schema/templates";

function readParsedTemplate(
  storage: DurableObjectStorage,
  templateId: string,
): CommunicationTemplate {
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      templateId,
    )
    .one();
  return communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 });
}

export function saveTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveTemplateOperationSchema>,
  now: string,
): Response {
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      operation.templateId,
      operation.template.title,
      operation.template.channel,
      operation.template.subject,
      operation.template.contentMarkdown,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.saved",
      operation.templateId,
      { channel: operation.template.channel, title: operation.template.title },
      now,
      "communication_template",
    );
  });
  return Response.json(readParsedTemplate(storage, operation.templateId));
}

export function updateTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof updateTemplateOperationSchema>,
  now: string,
): Response {
  const reminder = checkoutReminderTemplates.find(
    (template) => template.id === operation.templateId,
  );
  if (reminder) {
    const allowed = new Set(checkoutReminderPlaceholderTags(reminder.kind));
    const tags = extractCommunicationPlaceholders(
      `${operation.template.subject}\n${operation.template.contentMarkdown}`,
    );
    if (operation.template.channel !== "Email" || tags.some((tag) => !allowed.has(tag))) {
      return Response.json(
        {
          code: "invalid_reminder_template",
          message: "Use Email and the supported checkout reminder placeholders.",
        },
        { status: 400 },
      );
    }
  }
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ?`,
      operation.template.title,
      operation.template.channel,
      operation.template.subject,
      operation.template.contentMarkdown,
      now,
      operation.templateId,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.updated",
      operation.templateId,
      { channel: operation.template.channel, title: operation.template.title },
      now,
      "communication_template",
    );
  });
  return Response.json(readParsedTemplate(storage, operation.templateId));
}

export function resetTemplateToSystemDefault(
  storage: DurableObjectStorage,
  operation: z.infer<typeof resetTemplateToSystemDefaultOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly isSystem: number }>(
      "SELECT is_system AS isSystem FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  if (found.isSystem !== 1) {
    return Response.json({ code: "communication_template_not_system" }, { status: 409 });
  }

  const template = getSystemCommunicationTemplateDefault(operation.templateId);
  if (!template) {
    return Response.json(
      { code: "communication_system_template_default_not_found" },
      { status: 409 },
    );
  }

  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ? AND is_system = 1`,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      operation.templateId,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.reset_to_system_default",
      operation.templateId,
      { channel: template.channel, title: template.title },
      now,
      "communication_template",
    );
  });

  return Response.json(readParsedTemplate(storage, operation.templateId));
}

export function deleteTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deleteTemplateOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly isSystem: number }>(
      "SELECT is_system AS isSystem FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  if (found.isSystem === 1)
    return Response.json({ code: "communication_system_template_protected" }, { status: 409 });
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM communication_templates WHERE id = ?", operation.templateId);
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.deleted",
      operation.templateId,
      {},
      now,
      "communication_template",
    );
  });
  return Response.json({ id: operation.templateId, status: "deleted" });
}
