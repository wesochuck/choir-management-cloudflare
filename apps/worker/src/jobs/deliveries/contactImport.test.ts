import { describe, expect, it, vi } from "vitest";

import type { DeliveryJob } from "../contracts";
import { drainContactImport } from "./contactImport";

const IMPORT_ID = "11111111-1111-4111-8111-111111111111";

const job: DeliveryJob = {
  attempt: 1,
  idempotencyKey: `contact-import:${IMPORT_ID}`,
  jobId: IMPORT_ID,
  kind: "contact_import",
  organizationId: "organization-alpha",
  version: 1,
};

function summaryWith(status: "completed" | "failed" | "cancelled" | "processing") {
  return { actorUserId: "user-admin", importId: IMPORT_ID, status };
}

function batchWith(completed: boolean, status: "completed" | "processing") {
  return { completed, processedThisBatch: completed ? 0 : 200, summary: summaryWith(status) };
}

function fakeStub(
  summaryStatus: "completed" | "failed" | "cancelled" | "processing",
  batches: ReturnType<typeof batchWith>[] = [],
) {
  const processContactImportBatch = vi.fn();
  for (const batch of batches) processContactImportBatch.mockResolvedValueOnce(batch);
  return {
    getContactImport: vi.fn().mockResolvedValue(summaryWith(summaryStatus)),
    processContactImportBatch,
  };
}

describe("contact import delivery", () => {
  it("ignores duplicate queue delivery of a completed import", async () => {
    const stub = fakeStub("completed");
    await drainContactImport(stub, job);
    expect(stub.processContactImportBatch).not.toHaveBeenCalled();
  });

  it("treats failed and cancelled imports as terminal without reprocessing", async () => {
    for (const status of ["failed", "cancelled"] as const) {
      const stub = fakeStub(status);
      await drainContactImport(stub, job);
      expect(stub.processContactImportBatch).not.toHaveBeenCalled();
    }
  });

  it("drains bounded batches with the stored actor until completion", async () => {
    const stub = fakeStub("processing", [
      batchWith(false, "processing"),
      batchWith(false, "processing"),
      batchWith(true, "completed"),
    ]);
    await drainContactImport(stub, job);
    expect(stub.processContactImportBatch).toHaveBeenCalledTimes(3);
    expect(stub.processContactImportBatch).toHaveBeenCalledWith({
      actorUserId: "user-admin",
      batchSize: 200,
      importId: IMPORT_ID,
      organizationId: "organization-alpha",
      requestId: IMPORT_ID,
    });
  });

  it("fails visibly when the bounded delivery budget is exhausted", async () => {
    const stub = fakeStub(
      "processing",
      Array.from({ length: 60 }, () => batchWith(false, "processing")),
    );
    await expect(drainContactImport(stub, job)).rejects.toThrow(/bounded delivery budget/);
    expect(stub.processContactImportBatch).toHaveBeenCalledTimes(60);
  });
});
