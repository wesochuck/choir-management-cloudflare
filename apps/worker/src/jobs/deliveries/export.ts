import { buildOrganizationExportArchive } from "../../organization/organizationExport";
import { organizationExportKey } from "../../organization/exportStore";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import { organizationExportJobSchema, organizationExportSnapshotSchema } from "./shared";

const EXPORT_FILE_PAGE_SIZE = 1_000;

async function listOrganizationExportFiles(
  bucket: R2Bucket,
  prefix: string,
): Promise<{ readonly objects: readonly R2Object[]; readonly truncated: boolean }> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  for (;;) {
    const options = cursor
      ? { cursor, limit: EXPORT_FILE_PAGE_SIZE, prefix }
      : { limit: EXPORT_FILE_PAGE_SIZE, prefix };
    const page = await bucket.list(options);
    objects.push(...page.objects);
    if (!page.truncated || !page.cursor || objects.length > 5_000) {
      return { objects, truncated: page.truncated || objects.length > 5_000 };
    }
    cursor = page.cursor;
  }
}

function assertExportSafety(
  exportId: string,
  organizationId: string,
  safety: {
    readonly fileCount: number;
    readonly maxRowsPerTable: number;
    readonly tableCounts: Readonly<Record<string, number>>;
    readonly tooLarge: boolean;
  },
): void {
  if (!safety.tooLarge) return;
  console.error(
    JSON.stringify({
      event: "organization_export_too_large",
      exportId,
      fileCount: safety.fileCount,
      maxRowsPerTable: safety.maxRowsPerTable,
      organizationId,
      tableCounts: safety.tableCounts,
    }),
  );
  throw new Error("export_too_large");
}

async function readExportFiles(
  bucket: R2Bucket,
  organizationId: string,
  snapshot: {
    readonly files: readonly {
      readonly checksums: Readonly<Record<string, string>>;
      readonly contentType: string;
      readonly fileName: string;
      readonly id: string;
      readonly sizeBytes: number;
      readonly storageKey: string;
      readonly uploadedAt: string | null;
    }[];
    readonly safety: { readonly fileCount: number };
  },
): Promise<typeof snapshot.files> {
  const prefix = `organizations/${organizationId}/private/`;
  const fileObjects = await listOrganizationExportFiles(bucket, prefix);
  if (fileObjects.truncated || fileObjects.objects.length !== snapshot.safety.fileCount) {
    throw new Error("export_file_set_changed");
  }
  const fileChecksums = new Map(
    fileObjects.objects.map((object) => [
      object.key,
      Object.fromEntries(Object.entries(object.checksums.toJSON())),
    ]),
  );
  if (snapshot.files.some((file) => !fileChecksums.has(file.storageKey))) {
    throw new Error("export_file_set_changed");
  }
  return snapshot.files.map((file) => ({
    ...file,
    checksums: fileChecksums.get(file.storageKey) ?? file.checksums,
  }));
}

async function reconcileExportFailure(
  env: JobConsumerEnv,
  objectStub: DurableObjectStub,
  exportJob: {
    readonly actorType: string;
    readonly actorUserId: string;
    readonly requestId: string;
  },
  job: DeliveryJob,
  archiveKey: string | null,
  error: unknown,
): Promise<void> {
  if (archiveKey) {
    try {
      await env.ORGANIZATION_FILES.delete(archiveKey);
    } catch (cleanupError: unknown) {
      console.error(
        JSON.stringify({
          errorType: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
          event: "organization_export_archive_cleanup_failed",
          exportId: job.jobId,
          organizationId: job.organizationId,
        }),
      );
    }
  }
  const failureResponse = await objectStub.fetch(
    "https://organization.internal/internal/export/fail",
    {
      body: JSON.stringify({
        actorType: exportJob.actorType,
        actorUserId: exportJob.actorUserId,
        errorCode:
          error instanceof Error && error.message === "export_too_large"
            ? "export_too_large"
            : "export_generation_failed",
        exportId: job.jobId,
        organizationId: job.organizationId,
        requestId: exportJob.requestId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!failureResponse.ok) {
    throw new Error("export_failure_reconciliation_failed", { cause: error });
  }
  if (error instanceof Error && error.message === "export_too_large") return;
  throw error;
}

export async function deliverOrganizationExportJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const objectStub = env.ORGANIZATION_STORE.get(
    env.ORGANIZATION_STORE.idFromName(job.organizationId),
  );
  const jobUrl = new URL("https://organization.internal/internal/export/job");
  jobUrl.searchParams.set("organizationId", job.organizationId);
  jobUrl.searchParams.set("exportId", job.jobId);
  const jobResponse = await objectStub.fetch(jobUrl);
  const exportJob = organizationExportJobSchema.safeParse(
    await jobResponse.json().catch(() => null),
  );
  if (!jobResponse.ok || !exportJob.success) {
    throw new Error("The Organization export job is unavailable.");
  }
  if (exportJob.data.status === "completed") return;

  let archiveKey: string | null = null;
  try {
    const snapshotUrl = new URL("https://organization.internal/internal/export/snapshot");
    snapshotUrl.searchParams.set("organizationId", job.organizationId);
    const snapshotResponse = await objectStub.fetch(snapshotUrl);
    const snapshot = organizationExportSnapshotSchema.safeParse(
      await snapshotResponse.json().catch(() => null),
    );
    if (!snapshotResponse.ok || !snapshot.success) {
      throw new Error("The Organization export snapshot is unavailable.");
    }
    assertExportSafety(job.jobId, job.organizationId, snapshot.data.safety);
    const files = await readExportFiles(env.ORGANIZATION_FILES, job.organizationId, snapshot.data);
    const archive = await buildOrganizationExportArchive({
      files,
      organizationId: job.organizationId,
      snapshot: snapshot.data,
    });
    archiveKey = organizationExportKey(job.organizationId, job.jobId);
    await env.ORGANIZATION_FILES.put(archiveKey, archive.archive, {
      customMetadata: {
        exportId: job.jobId,
        organizationId: job.organizationId,
      },
      httpMetadata: { contentType: "application/json" },
    });
    const completeResponse = await objectStub.fetch(
      "https://organization.internal/internal/export/complete",
      {
        body: JSON.stringify({
          actorType: exportJob.data.actorType,
          actorUserId: exportJob.data.actorUserId,
          archiveKey,
          byteCount: archive.byteCount,
          checksumSha256: archive.checksumSha256,
          exportId: job.jobId,
          organizationId: job.organizationId,
          requestId: exportJob.data.requestId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!completeResponse.ok) throw new Error("The Organization export completion was rejected.");
  } catch (error: unknown) {
    await reconcileExportFailure(env, objectStub, exportJob.data, job, archiveKey, error);
  }
}
