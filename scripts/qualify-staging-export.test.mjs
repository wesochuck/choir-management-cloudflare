import { describe, expect, it } from "vitest";

import {
  exportArchiveMatches,
  exportBoundaryResponseSafe,
  exportDownloadHeadersMatch,
  exportQualificationPlan,
  exportStatusSnapshotsMatch,
  safeExportQualificationSummary,
} from "./qualify-staging-export.mjs";

const exportId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const payload = {
  exportVersion: 1,
  exportedAt: "2026-08-14T00:00:00.000Z",
  files: [],
  metadata: { organizationId },
  organizationId,
  records: { profiles: [] },
};
const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

describe("staging Organization-export qualification helpers", () => {
  it("requires explicit creation or an existing export ID", () => {
    const plan = exportQualificationPlan().join(" ");
    expect(plan).toContain("STAGING_EXPORT_CREATE=1");
    expect(plan).toContain("existing export");
    expect(plan).toContain("wrong Organization host");
  });

  it("matches the tenant-bound payload and its checksum metadata", async () => {
    const checksum = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", payloadBytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const archive = {
      manifest: {
        byteCount: payloadBytes.byteLength,
        checksumSha256: checksum,
        exportVersion: 1,
        organizationId,
      },
      payload,
    };
    expect(
      exportArchiveMatches(archive, {
        byteCount: payloadBytes.byteLength,
        checksumSha256: checksum,
        exportId,
        organizationId,
      }),
    ).toBe(true);
    expect(
      exportArchiveMatches(archive, {
        byteCount: payloadBytes.byteLength,
        checksumSha256: "wrong",
        exportId,
        organizationId,
      }),
    ).toBe(false);
    expect(
      exportArchiveMatches(archive, {
        byteCount: payloadBytes.byteLength,
        checksumSha256: checksum,
        exportId,
        organizationId: "33333333-3333-4333-8333-333333333333",
      }),
    ).toBe(false);
  });

  it("requires private no-store download headers", () => {
    const headers = new Headers({
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="organization-export-${exportId}.json"`,
      "content-length": "12",
      "content-type": "application/json; charset=utf-8",
      "x-export-checksum-sha256": "checksum",
    });
    expect(exportDownloadHeadersMatch(headers, exportId, "checksum", 12)).toBe(true);
    expect(exportDownloadHeadersMatch(headers, exportId, "wrong", 12)).toBe(false);
    expect(exportDownloadHeadersMatch(headers, exportId, "checksum", 13)).toBe(false);
  });

  it("accepts only a rejected or target-absent wrong-host response", () => {
    expect(exportBoundaryResponseSafe({ body: { code: "not_found" }, status: 404 }, exportId)).toBe(
      true,
    );
    expect(exportBoundaryResponseSafe({ body: { exportId: "other" }, status: 200 }, exportId)).toBe(
      true,
    );
    expect(exportBoundaryResponseSafe({ body: { exportId }, status: 200 }, exportId)).toBe(false);
    expect(exportBoundaryResponseSafe({ body: null, status: 503 }, exportId)).toBe(false);
  });

  it("compares replay status without request IDs", () => {
    const first = {
      byteCount: 12,
      checksumSha256: "checksum",
      downloadUrl: `/api/organization/export/${exportId}/download`,
      errorCode: null,
      exportId,
      requestId: "44444444-4444-4444-8444-444444444444",
      status: "completed",
    };
    expect(
      exportStatusSnapshotsMatch(first, {
        ...first,
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
    ).toBe(true);
    expect(exportStatusSnapshotsMatch(first, { ...first, checksumSha256: "changed" })).toBe(false);
  });

  it("redacts archive contents from the summary", () => {
    expect(
      safeExportQualificationSummary({
        archiveVerified: true,
        checksumSha256: "checksum",
        created: true,
        crossOrganizationRejected: true,
        downloadHeadersVerified: true,
        exportId,
        replayStable: true,
        secretArchiveContent: "must-not-be-returned",
      }),
    ).toEqual({
      archiveVerified: true,
      checksumSha256: "checksum",
      created: true,
      crossOrganizationRejected: true,
      downloadHeadersVerified: true,
      exportId,
      replayStable: true,
    });
  });
});
