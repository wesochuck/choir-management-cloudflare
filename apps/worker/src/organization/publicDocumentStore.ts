import {
  publicDocumentContentTypeSchema,
  publicWebsiteDocumentSchema,
  type PublicDocumentContentType,
  type PublicWebsiteDocument,
} from "@choir/contracts";
import {
  MAX_PUBLIC_DOCUMENT_BYTES,
  MAX_PUBLIC_DOCUMENTS_PER_ORGANIZATION,
  parsePublicDocumentIdentifier,
  publicDocumentPath,
  publicDocumentSlugBase,
} from "@choir/domain";
import type { DurableObjectStorage, SqlStorageValue } from "@cloudflare/workers-types";
import { z } from "zod";

export type PublicDocumentStoreErrorCode =
  | "organization_identity_conflict"
  | "document_not_found"
  | "document_limit_exceeded"
  | "document_file_not_found"
  | "document_file_invalid_type"
  | "document_file_oversized"
  | "document_file_name_invalid"
  | "validation_failed";

export class PublicDocumentStoreError extends Error {
  readonly code: PublicDocumentStoreErrorCode;

  constructor(code: PublicDocumentStoreErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "PublicDocumentStoreError";
    this.code = code;
  }
}

export interface PublicWebsiteDocumentDownload {
  readonly contentType: PublicDocumentContentType;
  readonly fileId: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly slug: string;
  readonly storageKey: string;
  readonly title: string;
  readonly updatedAt: string;
}

interface DocumentRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentType: string;
  readonly createdAt: string;
  readonly fileId: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly slug: string;
  readonly sortOrder: number;
  readonly title: string;
  readonly updatedAt: string;
}

interface DocumentDownloadRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentType: string;
  readonly fileId: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly slug: string;
  readonly storageKey: string;
  readonly title: string;
  readonly updatedAt: string;
}

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface PrivateFileRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentType: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly status: string;
}

const DOCUMENT_COLUMNS = `id, slug, title, file_id AS fileId, file_name AS fileName,
  content_type AS contentType, size_bytes AS sizeBytes, sort_order AS sortOrder,
  created_at AS createdAt, updated_at AS updatedAt`;

function assertOrganization(storage: DurableObjectStorage, organizationId: string): void {
  const storedId = storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (!storedId || storedId !== organizationId) {
    throw new PublicDocumentStoreError(
      "organization_identity_conflict",
      "Organization identity does not match metadata.",
    );
  }
}

function validateFile(
  storage: DurableObjectStorage,
  fileId: string,
): {
  readonly contentType: PublicDocumentContentType;
  readonly fileName: string;
  readonly sizeBytes: number;
} {
  const row = storage.sql
    .exec<PrivateFileRow>(
      "SELECT id, file_name AS fileName, content_type AS contentType, size_bytes AS sizeBytes, status FROM private_files WHERE id = ? LIMIT 1",
      fileId,
    )
    .toArray()
    .at(0);

  if (row?.status !== "ready") {
    throw new PublicDocumentStoreError(
      "document_file_not_found",
      "Backing private file was not found or is not ready.",
    );
  }

  const parsedType = publicDocumentContentTypeSchema.safeParse(row.contentType);
  if (!parsedType.success) {
    throw new PublicDocumentStoreError(
      "document_file_invalid_type",
      "Only PDF and Word (.docx) files are supported for public website documents.",
    );
  }

  if (row.sizeBytes <= 0 || row.sizeBytes > MAX_PUBLIC_DOCUMENT_BYTES) {
    throw new PublicDocumentStoreError(
      "document_file_oversized",
      "Public website documents must not exceed 5 MB.",
    );
  }

  const lowerName = row.fileName.toLowerCase();
  if (
    (parsedType.data === "application/pdf" && !lowerName.endsWith(".pdf")) ||
    (parsedType.data ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
      !lowerName.endsWith(".docx"))
  ) {
    throw new PublicDocumentStoreError(
      "document_file_name_invalid",
      "File extension must match its MIME type (.pdf or .docx).",
    );
  }

  return {
    contentType: parsedType.data,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
  };
}

function parseDocument(row: DocumentRow): PublicWebsiteDocument {
  const contentType = publicDocumentContentTypeSchema.parse(row.contentType);
  const downloadPath = publicDocumentPath({
    contentType,
    slug: row.slug,
  });
  return publicWebsiteDocumentSchema.parse({
    contentType,
    createdAt: row.createdAt,
    downloadPath,
    fileId: row.fileId,
    fileName: row.fileName,
    id: row.id,
    sizeBytes: row.sizeBytes,
    slug: row.slug,
    sortOrder: row.sortOrder,
    title: row.title,
    updatedAt: row.updatedAt,
  });
}

export function listPublicWebsiteDocumentsInStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string },
): readonly PublicWebsiteDocument[] {
  assertOrganization(storage, input.organizationId);
  const rows = storage.sql
    .exec<DocumentRow>(
      `SELECT ${DOCUMENT_COLUMNS} FROM public_website_documents ORDER BY sort_order, title COLLATE NOCASE, id LIMIT ${String(MAX_PUBLIC_DOCUMENTS_PER_ORGANIZATION)}`,
    )
    .toArray();
  return rows.map(parseDocument);
}

export function createPublicWebsiteDocumentInStore(
  storage: DurableObjectStorage,
  input: {
    readonly actorUserId: string;
    readonly documentId: string;
    readonly fileId: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly title: string;
  },
): PublicWebsiteDocument {
  assertOrganization(storage, input.organizationId);

  const cleanTitle = input.title.trim();
  if (!cleanTitle || cleanTitle.length > 300) {
    throw new PublicDocumentStoreError("validation_failed", "Invalid document title.");
  }
  if (!z.uuid().safeParse(input.documentId).success) {
    throw new PublicDocumentStoreError("validation_failed", "Invalid documentId.");
  }
  if (!z.uuid().safeParse(input.fileId).success) {
    throw new PublicDocumentStoreError("validation_failed", "Invalid fileId.");
  }

  return storage.transactionSync(() => {
    const count = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        "SELECT COUNT(*) AS count FROM public_website_documents",
      )
      .one().count;

    if (count >= MAX_PUBLIC_DOCUMENTS_PER_ORGANIZATION) {
      throw new PublicDocumentStoreError(
        "document_limit_exceeded",
        `Organizations may host at most ${String(MAX_PUBLIC_DOCUMENTS_PER_ORGANIZATION)} public documents.`,
      );
    }

    const file = validateFile(storage, input.fileId);

    const base = publicDocumentSlugBase(cleanTitle);
    const slugSuffixRow = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly maxSuffix: number | null }>(
        "SELECT MAX(suffix) AS maxSuffix FROM public_website_document_slugs WHERE base = ?",
        base,
      )
      .one();
    const suffix = (slugSuffixRow.maxSuffix ?? 0) + 1;
    const slug = suffix === 1 ? base : `${base}-${String(suffix)}`;

    const nextSortOrder = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly nextSortOrder: number }>(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextSortOrder FROM public_website_documents",
      )
      .one().nextSortOrder;

    const now = new Date().toISOString();

    storage.sql.exec(
      "INSERT INTO public_website_document_slugs (document_id, slug, base, suffix) VALUES (?, ?, ?, ?)",
      input.documentId,
      slug,
      base,
      suffix,
    );

    storage.sql.exec(
      `INSERT INTO public_website_documents
        (id, slug, title, file_id, file_name, content_type, size_bytes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.documentId,
      slug,
      cleanTitle,
      input.fileId,
      file.fileName,
      file.contentType,
      file.sizeBytes,
      nextSortOrder,
      now,
      now,
    );

    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'organization.public_document.created', 'public_website_document', ?, ?, ?, ?)`,
      `public_document:create:${input.requestId}`,
      input.actorUserId,
      input.documentId,
      input.requestId,
      JSON.stringify({
        contentType: file.contentType,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        slug,
        title: cleanTitle,
      }),
      now,
    );

    const row = storage.sql
      .exec<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM public_website_documents WHERE id = ? LIMIT 1`,
        input.documentId,
      )
      .toArray()
      .at(0);

    if (!row) {
      throw new PublicDocumentStoreError(
        "document_not_found",
        "Failed to retrieve created document.",
      );
    }

    return parseDocument(row);
  });
}

export function updatePublicWebsiteDocumentInStore(
  storage: DurableObjectStorage,
  input: {
    readonly actorUserId: string;
    readonly documentId: string;
    readonly fileId: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly title: string;
  },
): { readonly document: PublicWebsiteDocument; readonly previousFileId: string | null } {
  assertOrganization(storage, input.organizationId);

  const cleanTitle = input.title.trim();
  if (!cleanTitle || cleanTitle.length > 300) {
    throw new PublicDocumentStoreError("validation_failed", "Invalid document title.");
  }
  if (!z.uuid().safeParse(input.documentId).success) {
    throw new PublicDocumentStoreError("validation_failed", "Invalid documentId.");
  }
  if (!z.uuid().safeParse(input.fileId).success) {
    throw new PublicDocumentStoreError("validation_failed", "Invalid fileId.");
  }

  return storage.transactionSync(() => {
    const existing = storage.sql
      .exec<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM public_website_documents WHERE id = ? LIMIT 1`,
        input.documentId,
      )
      .toArray()
      .at(0);

    if (!existing) {
      throw new PublicDocumentStoreError("document_not_found", "Public document not found.");
    }

    const file = validateFile(storage, input.fileId);
    const now = new Date().toISOString();
    const previousFileId = existing.fileId !== input.fileId ? existing.fileId : null;

    storage.sql.exec(
      `UPDATE public_website_documents
       SET title = ?, file_id = ?, file_name = ?, content_type = ?, size_bytes = ?, updated_at = ?
       WHERE id = ?`,
      cleanTitle,
      input.fileId,
      file.fileName,
      file.contentType,
      file.sizeBytes,
      now,
      input.documentId,
    );

    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'organization.public_document.updated', 'public_website_document', ?, ?, ?, ?)`,
      `public_document:update:${input.requestId}`,
      input.actorUserId,
      input.documentId,
      input.requestId,
      JSON.stringify({
        contentType: file.contentType,
        fileChanged: Boolean(previousFileId),
        fileName: file.fileName,
        previousFileId,
        sizeBytes: file.sizeBytes,
        title: cleanTitle,
      }),
      now,
    );

    const updatedRow = storage.sql
      .exec<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM public_website_documents WHERE id = ? LIMIT 1`,
        input.documentId,
      )
      .toArray()
      .at(0);

    if (!updatedRow) {
      throw new PublicDocumentStoreError(
        "document_not_found",
        "Failed to retrieve updated document.",
      );
    }

    return {
      document: parseDocument(updatedRow),
      previousFileId,
    };
  });
}

export function deletePublicWebsiteDocumentInStore(
  storage: DurableObjectStorage,
  input: {
    readonly actorUserId: string;
    readonly documentId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): { readonly deleted: true; readonly fileId: string } {
  assertOrganization(storage, input.organizationId);

  if (!z.uuid().safeParse(input.documentId).success) {
    throw new PublicDocumentStoreError("validation_failed", "Invalid documentId.");
  }

  return storage.transactionSync(() => {
    const existing = storage.sql
      .exec<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM public_website_documents WHERE id = ? LIMIT 1`,
        input.documentId,
      )
      .toArray()
      .at(0);

    if (!existing) {
      throw new PublicDocumentStoreError("document_not_found", "Public document not found.");
    }

    const now = new Date().toISOString();

    storage.sql.exec("DELETE FROM public_website_documents WHERE id = ?", input.documentId);

    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'organization.public_document.deleted', 'public_website_document', ?, ?, ?, ?)`,
      `public_document:delete:${input.requestId}`,
      input.actorUserId,
      input.documentId,
      input.requestId,
      JSON.stringify({
        fileId: existing.fileId,
        slug: existing.slug,
        title: existing.title,
      }),
      now,
    );

    return {
      deleted: true,
      fileId: existing.fileId,
    };
  });
}

export function getPublicWebsiteDocumentForDownloadFromStore(
  storage: DurableObjectStorage,
  input: { readonly identifier: string; readonly organizationId: string },
): PublicWebsiteDocumentDownload | null {
  assertOrganization(storage, input.organizationId);

  const parsed = parsePublicDocumentIdentifier(input.identifier);
  if (!parsed) {
    return null;
  }

  const query = `
    SELECT
      d.id,
      d.slug,
      d.title,
      d.file_id AS fileId,
      d.file_name AS fileName,
      d.content_type AS contentType,
      d.size_bytes AS sizeBytes,
      d.updated_at AS updatedAt,
      f.storage_key AS storageKey
    FROM public_website_documents d
    INNER JOIN private_files f ON f.id = d.file_id AND f.status = 'ready'
    WHERE ${parsed.kind === "id" ? "d.id = ?" : "d.slug = ?"}
    LIMIT 1
  `;

  const row = storage.sql.exec<DocumentDownloadRow>(query, parsed.value).toArray().at(0);

  if (!row) {
    return null;
  }

  const contentType = publicDocumentContentTypeSchema.parse(row.contentType);

  return {
    contentType,
    fileId: row.fileId,
    fileName: row.fileName,
    id: row.id,
    sizeBytes: row.sizeBytes,
    slug: row.slug,
    storageKey: row.storageKey,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}
