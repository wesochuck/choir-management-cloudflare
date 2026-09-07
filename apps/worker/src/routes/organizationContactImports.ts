import {
  CONTACT_IMPORT_LISTS_MAX,
  CONTACT_IMPORT_MAPPING_MAX,
  contactImportMappingRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { CONTACT_IMPORT_MAX_BYTES, ContactImportError, parseContactImportCsv } from "@choir/domain";
import { z } from "zod";
import { ContactStoreError, type ContactStoreErrorCode } from "../organization/contactStore";
import { organizationStoreStub } from "../organization/rpc/client";

import type { Context, Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

/**
 * Phase 5 staged CSV contact-import API surface.
 *
 * Tenancy: the Organization is resolved from the validated canonical
 * hostname inside `authorizeCalendarRoute` before any membership check, and
 * only that server-resolved Organization ID selects the Durable Object via
 * `organizationStoreStub`. Staged import rows live in the Organization's own
 * Durable Object tables (never R2), so a foreign import ID resolves to
 * not-found and foreign list IDs fail the same-organization existence check.
 * Every route requires an Organization Owner or Administrator.
 *
 * Only confirmation enqueues async work. Upload, mapping, preview, and
 * cancel never mutate contacts; the queue consumer drains confirmed imports
 * in bounded batches. This module never logs contact values and maps store
 * failures to typed `ProblemDetails` without raw SQLite text.
 */

const CSV_CONTENT_TYPES = new Set([
  "",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

type ImportStoreErrorCode =
  ContactStoreErrorCode | "contact_import_not_found" | "contact_import_conflict";

function matchImportStoreErrorCode(value: string): ImportStoreErrorCode | null {
  switch (value) {
    case "organization_identity_conflict":
    case "contact_not_found":
    case "contact_duplicate_email":
    case "contact_missing_identity":
    case "contact_profile_not_found":
    case "contact_list_not_found":
    case "contact_import_not_found":
    case "contact_import_conflict":
    case "validation_failed":
      return value;
    default:
      return null;
  }
}

/**
 * Durable Object RPC does not preserve the `ContactStoreError` prototype, so
 * route-side mapping reads the typed error code instead of `instanceof`.
 * `ContactStoreError` always prefixes its message with `${code}: `, which
 * lets the boundary preserve the code without leaking storage details.
 */
function importStoreErrorCode(error: unknown): ImportStoreErrorCode | null {
  if (error instanceof ContactStoreError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code: unknown = error.code;
    if (typeof code === "string") {
      const matched = matchImportStoreErrorCode(code);
      if (matched !== null) return matched;
    }
  }
  if (error instanceof Error) {
    const prefix = error.message.split(":", 1)[0]?.trim() ?? "";
    return matchImportStoreErrorCode(prefix);
  }
  return null;
}

function importProblem(
  error: unknown,
  requestId: string,
  fallbackMessage: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 404 | 409 | 413 | 503 } {
  if (error instanceof ContactImportError) {
    if (error.code === "too_large") {
      return {
        problem: { code: "validation_failed", message: error.message, requestId },
        status: 413,
      };
    }
    const row = error.row === null ? "" : ` (row ${String(error.row)})`;
    return {
      problem: { code: "validation_failed", message: `${error.message}${row}`, requestId },
      status: 400,
    };
  }
  const code = importStoreErrorCode(error);
  if (code !== null) {
    switch (code) {
      case "contact_import_not_found":
        return {
          problem: {
            code,
            message: "The contact import was not found in this organization.",
            requestId,
          },
          status: 404,
        };
      case "contact_list_not_found":
        return {
          problem: {
            code,
            message: "A target contact list was not found in this organization.",
            requestId,
          },
          status: 404,
        };
      case "contact_import_conflict":
        return {
          problem: {
            code,
            message: "The contact import is not in a state that allows this action.",
            requestId,
          },
          status: 409,
        };
      case "organization_identity_conflict":
        return {
          problem: {
            code,
            message: "The organization context was rejected.",
            requestId,
          },
          status: 409,
        };
      case "contact_not_found":
      case "contact_duplicate_email":
      case "contact_missing_identity":
      case "contact_profile_not_found":
      case "validation_failed":
        return {
          problem: {
            code: "validation_failed",
            message: "The contact import request was not valid.",
            requestId,
          },
          status: 400,
        };
    }
  }
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      event: "contact_import_route_error",
      requestId,
    }),
  );
  return {
    problem: {
      code: "service_unavailable",
      message: fallbackMessage,
      requestId,
    } satisfies ProblemDetails,
    status: 503,
  };
}

function validationProblem(message: string, requestId: string): ProblemDetails {
  return { code: "validation_failed", message, requestId };
}

function parseRouteUuid(value: string): string | null {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sanitizeFileName(raw: string | null): string {
  const trimmed = (raw ?? "").trim().slice(0, 255);
  const basename = trimmed.split(/[\\/]/).at(-1) ?? "";
  return basename || "contacts.csv";
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/contact-imports", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const contentType =
      context.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!CSV_CONTENT_TYPES.has(contentType)) {
      return context.json(
        { ...validationProblem("Contact imports require a CSV upload.", context.get("requestId")) },
        400,
      );
    }
    const declaredLength = Number(context.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > CONTACT_IMPORT_MAX_BYTES) {
      return context.json(
        {
          code: "validation_failed",
          message: "Contact CSV files may not exceed 5 MB.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        413,
      );
    }
    try {
      const csv = await context.req.text();
      if (new TextEncoder().encode(csv).byteLength > CONTACT_IMPORT_MAX_BYTES) {
        return context.json(
          {
            code: "validation_failed",
            message: "Contact CSV files may not exceed 5 MB.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          413,
        );
      }
      // Step 1 upload validation + Step 2 analysis share one safe parse so the
      // wizard reports file-level problems before anything is staged.
      const parsed = parseContactImportCsv(csv);
      const requestUrl = new URL(context.req.url);
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const importId = crypto.randomUUID();
      const created = await stub.createContactImport({
        actorUserId: authorization.userId,
        byteCount: new TextEncoder().encode(csv).byteLength,
        fileName: sanitizeFileName(requestUrl.searchParams.get("filename")),
        headers: [...parsed.headers],
        importId,
        malformedRows: parsed.malformedRows.map((entry) => ({
          cells: [...entry.cells],
          error: entry.error,
          rowNumber: entry.rowNumber,
        })),
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
        rows: parsed.dataRows.map((entry) => ({
          cells: [...entry.cells],
          rowNumber: entry.rowNumber,
        })),
      });
      const summary = await stub.getContactImport({
        importId,
        organizationId: authorization.organizationId,
      });
      return context.json(
        {
          headers: summary.headers,
          importId: created.importId,
          invalidRowCount: summary.invalidRows,
          probableDuplicateCount: created.probableDuplicateCount,
          requestId: context.get("requestId"),
          rowCount: created.rowCount,
          sampleRows: summary.sampleRows.map((row) => [...row]),
          status: "staged" as const,
        },
        201,
      );
    } catch (error: unknown) {
      const result = importProblem(
        error,
        context.get("requestId"),
        "The contact CSV could not be uploaded.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.get("/api/organization/contact-imports/:importId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const importId = parseRouteUuid(context.req.param("importId"));
    if (!importId) {
      return context.json(
        { ...validationProblem("A valid contact import is required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const summary = await stub.getContactImport({
        importId,
        organizationId: authorization.organizationId,
      });
      return context.json(jobStatusBody(context, summary));
    } catch (error: unknown) {
      const result = importProblem(
        error,
        context.get("requestId"),
        "The contact import is temporarily unavailable.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.put("/api/organization/contact-imports/:importId/mapping", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const importId = parseRouteUuid(context.req.param("importId"));
    if (!importId) {
      return context.json(
        { ...validationProblem("A valid contact import is required.", context.get("requestId")) },
        400,
      );
    }
    const parsedBody = contactImportMappingRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      const oversized = parsedBody.error.issues.some((issue) => issue.code === "too_big");
      return context.json(
        {
          ...validationProblem(
            oversized
              ? `Map at most ${String(CONTACT_IMPORT_MAPPING_MAX)} columns to at most ${String(CONTACT_IMPORT_LISTS_MAX)} lists.`
              : "A column mapping and at least one target list are required.",
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const updated = await stub.updateContactImportMapping({
        actorUserId: authorization.userId,
        importId,
        listIds: [...parsedBody.data.listIds],
        mapping: [...parsedBody.data.mapping],
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({
        importId: updated.importId,
        listIds: [...updated.listIds],
        mapping: updated.mapping ? [...updated.mapping] : [],
        requestId: context.get("requestId"),
        status: "staged" as const,
      });
    } catch (error: unknown) {
      const result = importProblem(
        error,
        context.get("requestId"),
        "The column mapping could not be saved.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.get("/api/organization/contact-imports/:importId/preview", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const importId = parseRouteUuid(context.req.param("importId"));
    if (!importId) {
      return context.json(
        { ...validationProblem("A valid contact import is required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const previewed = await stub.previewContactImport({
        importId,
        organizationId: authorization.organizationId,
      });
      return context.json({
        contactsCreated: 0,
        contactsUpdated: 0,
        existingMatches: previewed.preview.existingMatches,
        importId: previewed.importId,
        inFileDuplicates: previewed.preview.inFileDuplicates,
        invalidRows: previewed.preview.invalidRows,
        membershipsAdded: 0,
        newContacts: previewed.preview.newContacts,
        requestId: context.get("requestId"),
        rowsRead: previewed.preview.rowsRead,
        status: "staged" as const,
        suppressedPreserved: previewed.preview.suppressedPreserved,
      });
    } catch (error: unknown) {
      const result = importProblem(
        error,
        context.get("requestId"),
        "The contact import preview is temporarily unavailable.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.post("/api/organization/contact-imports/:importId/confirm", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const importId = parseRouteUuid(context.req.param("importId"));
    if (!importId) {
      return context.json(
        { ...validationProblem("A valid contact import is required.", context.get("requestId")) },
        400,
      );
    }
    try {
      // Only confirmation starts the mutation job; the store enqueues one
      // idempotent outbox delivery and wakes the scheduler alarm.
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const confirmed = await stub.confirmContactImport({
        actorUserId: authorization.userId,
        importId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({
        idempotencyKey: confirmed.idempotencyKey,
        importId: confirmed.importId,
        requestId: context.get("requestId"),
        status: confirmed.status,
      });
    } catch (error: unknown) {
      const result = importProblem(
        error,
        context.get("requestId"),
        "The contact import could not be confirmed.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.post("/api/organization/contact-imports/:importId/cancel", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const importId = parseRouteUuid(context.req.param("importId"));
    if (!importId) {
      return context.json(
        { ...validationProblem("A valid contact import is required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const cancelled = await stub.cancelContactImport({
        actorUserId: authorization.userId,
        importId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({
        importId: cancelled.importId,
        requestId: context.get("requestId"),
        status: cancelled.status,
      });
    } catch (error: unknown) {
      const result = importProblem(
        error,
        context.get("requestId"),
        "The contact import could not be cancelled.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.get("/api/organization/contact-imports/:importId/errors", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const importId = parseRouteUuid(context.req.param("importId"));
    if (!importId) {
      return context.json(
        { ...validationProblem("A valid contact import is required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const exported = await stub.contactImportErrorCsv({
        importId,
        organizationId: authorization.organizationId,
      });
      return context.json({
        csv: exported.csv,
        downloadName: `contact-import-errors-${importId.slice(0, 8)}.csv`,
        importId,
        requestId: context.get("requestId"),
        rowCount: exported.rowCount,
      });
    } catch (error: unknown) {
      const result = importProblem(
        error,
        context.get("requestId"),
        "The contact import errors are temporarily unavailable.",
      );
      return context.json(result.problem, result.status);
    }
  });
}

interface ImportSummaryLike {
  readonly contactsCreated: number;
  readonly contactsUpdated: number;
  readonly errorCode: string | null;
  readonly existingMatches: number;
  readonly hasErrorCsv: boolean;
  readonly importId: string;
  readonly inFileDuplicates: number;
  readonly invalidRows: number;
  readonly membershipsAdded: number;
  readonly newContacts: number;
  readonly processedRows: number;
  readonly rowCount: number;
  readonly status: string;
  readonly suppressedPreserved: number;
}

function jobStatusBody(
  context: Context<WorkerHonoEnvironment>,
  summary: ImportSummaryLike,
): Record<string, unknown> {
  return {
    contactsCreated: summary.contactsCreated,
    contactsUpdated: summary.contactsUpdated,
    errorCode: summary.errorCode,
    existingMatches: summary.existingMatches,
    hasErrorCsv: summary.hasErrorCsv,
    importId: summary.importId,
    inFileDuplicates: summary.inFileDuplicates,
    invalidRows: summary.invalidRows,
    membershipsAdded: summary.membershipsAdded,
    newContacts: summary.newContacts,
    processedRows: summary.processedRows,
    requestId: context.get("requestId"),
    rowsRead: summary.rowCount,
    status: summary.status,
    suppressedPreserved: summary.suppressedPreserved,
  };
}
