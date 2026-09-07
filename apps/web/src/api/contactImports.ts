import {
  contactImportConfirmResponseSchema,
  contactImportErrorCsvResponseSchema,
  contactImportJobStatusResponseSchema,
  contactImportMappingResponseSchema,
  contactImportPreviewResponseSchema,
  contactImportUploadResponseSchema,
  type ContactImportConfirmResponse,
  type ContactImportErrorCsvResponse,
  type ContactImportJobStatusResponse,
  type ContactImportMappingResponse,
  type ContactImportPreviewResponse,
  type ContactImportTarget,
  type ContactImportUploadResponse,
} from "@choir/contracts";
import { z } from "zod";

import { requestJson } from "./client";
import { contactErrorMessage } from "./contacts";

/**
 * Phase 5 staged CSV contact-import browser client.
 *
 * Tenancy mirrors the contacts client: every path is organization-scoped
 * without a client-supplied Organization identifier. The server resolves the
 * Organization from the validated hostname, so a reused import ID on another
 * hostname resolves to not-found per the existing API policy.
 */

function importPath(importId: string, suffix = ""): string {
  return `/api/organization/contact-imports/${encodeURIComponent(importId)}${suffix}`;
}

export async function uploadContactImportCsv(
  fileName: string,
  csv: string,
  signal?: AbortSignal,
): Promise<ContactImportUploadResponse> {
  const path = `/api/organization/contact-imports?filename=${encodeURIComponent(fileName)}`;
  return requestJson(path, contactImportUploadResponseSchema, {
    body: csv,
    headers: { "content-type": "text/csv;charset=utf-8" },
    method: "POST",
    signal: signal ?? null,
  });
}

export async function saveContactImportMapping(
  importId: string,
  input: { readonly listIds: readonly string[]; readonly mapping: readonly ContactImportTarget[] },
): Promise<ContactImportMappingResponse> {
  return requestJson(importPath(importId, "/mapping"), contactImportMappingResponseSchema, {
    body: JSON.stringify({ listIds: [...input.listIds], mapping: [...input.mapping] }),
    method: "PUT",
  });
}

export async function previewContactImport(
  importId: string,
  signal?: AbortSignal,
): Promise<ContactImportPreviewResponse> {
  return requestJson(importPath(importId, "/preview"), contactImportPreviewResponseSchema, {
    signal: signal ?? null,
  });
}

export async function confirmContactImport(
  importId: string,
): Promise<ContactImportConfirmResponse> {
  return requestJson(importPath(importId, "/confirm"), contactImportConfirmResponseSchema, {
    method: "POST",
  });
}

const cancelImportResponseSchema = z.object({
  importId: z.uuid(),
  requestId: z.uuid(),
  status: z.literal("cancelled"),
});

export async function cancelContactImport(importId: string): Promise<void> {
  await requestJson(importPath(importId, "/cancel"), cancelImportResponseSchema, {
    method: "POST",
  });
}

export async function getContactImportStatus(
  importId: string,
  signal?: AbortSignal,
): Promise<ContactImportJobStatusResponse> {
  return requestJson(importPath(importId), contactImportJobStatusResponseSchema, {
    signal: signal ?? null,
  });
}

export async function downloadContactImportErrors(
  importId: string,
): Promise<ContactImportErrorCsvResponse> {
  return requestJson(importPath(importId, "/errors"), contactImportErrorCsvResponseSchema);
}

/** Triggers a file download for a validated import error payload. No-op without a DOM. */
export function downloadContactImportErrorFile(exported: ContactImportErrorCsvResponse): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([exported.csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", exported.downloadName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function contactImportErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "contact_import_conflict"
  ) {
    return "The contact import is not in a state that allows this action. Refresh and try again.";
  }
  return contactErrorMessage(error, fallback);
}
