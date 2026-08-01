import { z } from "zod";

const reconciliationOrganizationIdSchema = z.string().min(1).max(128);

const expiredPaidTicketSchema = z.object({
  expiredAt: z.string().nullable(),
  paymentAttemptStatus: z.string().nullable(),
  purchaseId: z.string(),
  providerPaymentId: z.string(),
  providerSessionId: z.string(),
});

const inconsistentPaymentAttemptSchema = z.object({
  attemptId: z.string(),
  attemptStatus: z.string(),
  paymentType: z.string(),
  resourceId: z.string(),
  resourceStatus: z.string().nullable(),
});

const orphanedExportArchiveSchema = z.object({
  archiveKey: z.string(),
  exportId: z.string(),
  status: z.string(),
});

const terminalJobSchema = z.object({
  attempt: z.number(),
  failedAt: z.string().nullable(),
  jobId: z.string(),
  kind: z.string(),
  status: z.string(),
  terminalAt: z.string().nullable(),
});

export const reconciliationReportSchema = z.object({
  completedExportArchiveKeys: z.array(z.string()),
  expiredPaidTickets: z.array(expiredPaidTicketSchema),
  inconsistentPaymentAttempts: z.array(inconsistentPaymentAttemptSchema),
  organizationId: z.string(),
  orphanedExportArchives: z.array(orphanedExportArchiveSchema),
  terminalJobs: z.array(terminalJobSchema),
});

export type ReconciliationReport = z.infer<typeof reconciliationReportSchema>;

interface OrganizationIdRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface ExpiredPaidTicketRow {
  readonly [column: string]: SqlStorageValue;
  readonly expiredAt: string | null;
  readonly paymentAttemptStatus: string | null;
  readonly purchaseId: string;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
}

interface InconsistentPaymentAttemptRow {
  readonly [column: string]: SqlStorageValue;
  readonly attemptId: string;
  readonly attemptStatus: string;
  readonly paymentType: string;
  readonly resourceId: string;
  readonly resourceStatus: string | null;
}

interface ExportArchiveRow {
  readonly [column: string]: SqlStorageValue;
  readonly archiveKey: string;
  readonly exportId: string;
  readonly status: string;
}

interface TerminalJobRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempt: number;
  readonly failedAt: string | null;
  readonly jobId: string;
  readonly kind: string;
  readonly status: string;
  readonly terminalAt: string | null;
}

function readIdentity(storage: DurableObjectStorage): string | null {
  return (
    storage.sql
      .exec<OrganizationIdRow>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId ?? null
  );
}

export function readOrganizationReconciliationReport(
  storage: DurableObjectStorage,
  organizationId: string,
): Response {
  const parsedOrganizationId = reconciliationOrganizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success || readIdentity(storage) !== parsedOrganizationId.data) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  const expiredPaidTickets = storage.sql
    .exec<ExpiredPaidTicketRow>(
      `SELECT p.id AS purchaseId, p.provider_session_id AS providerSessionId,
        p.provider_payment_id AS providerPaymentId, p.expired_at AS expiredAt,
        pa.status AS paymentAttemptStatus
       FROM ticket_purchases p
       LEFT JOIN payment_attempts pa
         ON pa.resource_id = p.id AND pa.payment_type IN ('ticket', 'bundle')
       WHERE p.status = 'paid' AND p.expired_at IS NOT NULL
       ORDER BY p.expired_at DESC, p.id
       LIMIT 500`,
    )
    .toArray();

  const inconsistentPaymentAttempts = storage.sql
    .exec<InconsistentPaymentAttemptRow>(
      `SELECT pa.id AS attemptId, pa.payment_type AS paymentType,
        pa.resource_id AS resourceId, pa.status AS attemptStatus,
        p.status AS resourceStatus
       FROM payment_attempts pa
       LEFT JOIN ticket_purchases p
         ON pa.payment_type IN ('ticket', 'bundle') AND p.id = pa.resource_id
       WHERE pa.payment_type IN ('ticket', 'bundle')
         AND (p.id IS NULL OR p.status != pa.status)
       UNION ALL
       SELECT pa.id, pa.payment_type, pa.resource_id, pa.status,
         CASE WHEN de.donation_id IS NOT NULL AND d.status = 'pending'
              THEN 'expired' ELSE d.status END
       FROM payment_attempts pa
       LEFT JOIN donations d
         ON pa.payment_type = 'donation' AND d.id = pa.resource_id
       LEFT JOIN donation_expirations de ON de.donation_id = d.id
       WHERE pa.payment_type = 'donation'
         AND (
           d.id IS NULL OR
           (CASE WHEN de.donation_id IS NOT NULL AND d.status = 'pending'
                 THEN 'expired' ELSE d.status END) != pa.status
         )
       UNION ALL
       SELECT pa.id, pa.payment_type, pa.resource_id, pa.status,
         CASE WHEN de.dues_id IS NOT NULL AND d.status = 'pending'
              THEN 'expired' ELSE d.status END
       FROM payment_attempts pa
       LEFT JOIN dues d
         ON pa.payment_type = 'dues' AND d.id = pa.resource_id
       LEFT JOIN dues_expirations de ON de.dues_id = d.id
       WHERE pa.payment_type = 'dues'
         AND (
           d.id IS NULL OR
           (CASE WHEN de.dues_id IS NOT NULL AND d.status = 'pending'
                 THEN 'expired' ELSE d.status END) != pa.status
         )
       ORDER BY attemptId
       LIMIT 500`,
    )
    .toArray();

  const exportArchives = storage.sql
    .exec<ExportArchiveRow>(
      `SELECT id AS exportId, archive_key AS archiveKey, status
       FROM organization_exports
       WHERE archive_key IS NOT NULL
       ORDER BY updated_at DESC, id
       LIMIT 500`,
    )
    .toArray();
  const completedExportArchiveKeys = exportArchives
    .filter((row) => row.status === "completed")
    .map((row) => row.archiveKey);
  const orphanedExportArchives = exportArchives.filter((row) => row.status !== "completed");

  const terminalJobs = storage.sql
    .exec<TerminalJobRow>(
      `SELECT job_id AS jobId, kind, status, attempt, failed_at AS failedAt
          , terminal_at AS terminalAt
       FROM job_ledger WHERE status = 'failed' AND terminal_at IS NOT NULL
       ORDER BY terminal_at DESC, job_id
       LIMIT 500`,
    )
    .toArray();

  const report: ReconciliationReport = {
    completedExportArchiveKeys,
    expiredPaidTickets,
    inconsistentPaymentAttempts,
    organizationId: parsedOrganizationId.data,
    orphanedExportArchives,
    terminalJobs,
  };
  return Response.json(reconciliationReportSchema.parse(report));
}
