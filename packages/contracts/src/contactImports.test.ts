import { describe, expect, it } from "vitest";

import {
  CONTACT_IMPORT_LISTS_MAX,
  contactImportErrorCsvResponseSchema,
  contactImportJobStatusResponseSchema,
  contactImportMappingRequestSchema,
  contactImportPreviewResponseSchema,
  contactImportUploadResponseSchema,
} from "@choir/contracts";

function uuidFor(index: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${index.toString(16).padStart(12, "0")}`;
}

const requestId = uuidFor(1);
const importId = uuidFor(2);

describe("Contact import contracts", () => {
  it("parses an upload analysis response", () => {
    expect(
      contactImportUploadResponseSchema.parse({
        headers: ["First Name", "Email"],
        importId,
        invalidRowCount: 1,
        probableDuplicateCount: 0,
        requestId,
        rowCount: 10,
        sampleRows: [["Jane", "jane@example.com"]],
        status: "staged",
      }),
    ).toMatchObject({ importId, rowCount: 10, status: "staged" });
  });

  it("rejects uploads with too many headers or sample rows", () => {
    const base = {
      importId,
      invalidRowCount: 0,
      probableDuplicateCount: 0,
      requestId,
      rowCount: 0,
      sampleRows: [],
      status: "staged" as const,
    };
    expect(
      contactImportUploadResponseSchema.safeParse({
        ...base,
        headers: Array.from({ length: 65 }, (_, index) => `Column ${String(index)}`),
      }).success,
    ).toBe(false);
    expect(
      contactImportUploadResponseSchema.safeParse({
        ...base,
        headers: ["Email"],
        sampleRows: Array.from({ length: 6 }, () => ["a@example.com"]),
      }).success,
    ).toBe(false);
  });

  it("requires at least one target list and bounded unique lists", () => {
    const mapping = ["firstName", "email"];
    expect(contactImportMappingRequestSchema.safeParse({ listIds: [], mapping }).success).toBe(
      false,
    );
    const duplicated = [uuidFor(3), uuidFor(3)];
    expect(
      contactImportMappingRequestSchema.safeParse({ listIds: duplicated, mapping }).success,
    ).toBe(false);
    const oversized = Array.from({ length: CONTACT_IMPORT_LISTS_MAX + 1 }, (_, index) =>
      uuidFor(100 + index),
    );
    expect(
      contactImportMappingRequestSchema.safeParse({ listIds: oversized, mapping }).success,
    ).toBe(false);
    expect(
      contactImportMappingRequestSchema.safeParse({ listIds: [uuidFor(3)], mapping }).success,
    ).toBe(true);
  });

  it("rejects unknown mapping targets and oversized mappings", () => {
    expect(
      contactImportMappingRequestSchema.safeParse({
        listIds: [uuidFor(3)],
        mapping: ["email", "bogus"],
      }).success,
    ).toBe(false);
    expect(
      contactImportMappingRequestSchema.safeParse({
        listIds: [uuidFor(3)],
        mapping: Array.from({ length: 65 }, () => "ignore" as const),
      }).success,
    ).toBe(false);
  });

  it("parses preview and job-status progress shapes", () => {
    const counts = {
      contactsCreated: 0,
      contactsUpdated: 0,
      existingMatches: 1,
      inFileDuplicates: 0,
      invalidRows: 0,
      membershipsAdded: 0,
      newContacts: 2,
      rowsRead: 3,
      suppressedPreserved: 0,
    };
    expect(
      contactImportPreviewResponseSchema.parse({
        ...counts,
        importId,
        requestId,
        status: "staged",
      }),
    ).toMatchObject({ newContacts: 2 });
    for (const status of [
      "staged",
      "confirmed",
      "processing",
      "completed",
      "failed",
      "cancelled",
    ]) {
      expect(
        contactImportJobStatusResponseSchema.parse({
          ...counts,
          errorCode: null,
          hasErrorCsv: false,
          importId,
          processedRows: 3,
          requestId,
          status,
        }).status,
      ).toBe(status);
    }
  });

  it("verifies nullable and omitted error codes on job status", () => {
    const base = {
      contactsCreated: 0,
      contactsUpdated: 0,
      existingMatches: 0,
      hasErrorCsv: false,
      importId,
      inFileDuplicates: 0,
      invalidRows: 0,
      membershipsAdded: 0,
      newContacts: 0,
      processedRows: 0,
      requestId,
      rowsRead: 0,
      status: "failed" as const,
      suppressedPreserved: 0,
    };
    expect(
      contactImportJobStatusResponseSchema.parse({ ...base, errorCode: null }).errorCode,
    ).toBeNull();
    expect(
      contactImportJobStatusResponseSchema.parse({ ...base, errorCode: "processing_failed" })
        .errorCode,
    ).toBe("processing_failed");
    expect(
      contactImportJobStatusResponseSchema.safeParse({ ...base, errorCode: undefined }).success,
    ).toBe(false);
  });

  it("bounds the downloadable error CSV", () => {
    expect(
      contactImportErrorCsvResponseSchema.parse({
        csv: '"Row","Error"\n"2","Bad email"',
        importId,
        requestId,
        rowCount: 1,
      }).downloadName,
    ).toBe("contact-import-errors.csv");
    expect(
      contactImportErrorCsvResponseSchema.safeParse({
        csv: "x",
        downloadName: "",
        importId,
        requestId,
        rowCount: 0,
      }).success,
    ).toBe(false);
  });
});
