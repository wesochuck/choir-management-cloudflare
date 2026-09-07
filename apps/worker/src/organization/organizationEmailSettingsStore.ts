import { z } from "zod";
import {
  organizationEmailDomainDnsRecordSchema,
  organizationEmailSettingsUpdateRequestSchema,
  type OrganizationEmailDomainDnsRecord,
  type OrganizationEmailSettings,
} from "@choir/contracts";

import type { SqlStorageValue } from "@cloudflare/workers-types";

import {
  commitEmailDomainVerificationInputSchema,
  computeEmailDomainConfigurationId,
  normalizeEmailDomain,
  verificationRecordKey,
  type CommitEmailDomainVerificationResult,
  type PrepareEmailDomainVerificationResult,
} from "./emailDomainVerification";

export interface EmailVerificationStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): { readonly toArray: () => T[] };
  };
  transactionSync<T>(fn: () => T): T;
}

const fallbackEmailSettings: OrganizationEmailSettings = {
  customDomain: null,
  customDomainStatus: "none",
  dnsRecords: [],
  fromName: null,
  lastCheckedAt: null,
  replyToEmail: null,
  verifiedAt: null,
};

type EmailSettingsRow = Record<string, SqlStorageValue> & {
  readonly custom_domain: string | null;
  readonly custom_domain_status: "none" | "pending" | "active" | "degraded";
  readonly dns_records_json: string;
  readonly from_name: string | null;
  readonly last_checked_at: string | null;
  readonly organization_id: string;
  readonly reply_to_email: string | null;
  readonly updated_at: string;
  readonly verified_at: string | null;
};

export function generateRequiredDnsRecords(
  domain: string,
): readonly OrganizationEmailDomainDnsRecord[] {
  const normalized = domain.trim().toLowerCase();
  return [
    {
      name: normalized,
      purpose: "spf",
      status: "pending",
      type: "TXT",
      value: "v=spf1 include:_spf.cloudflare.com ~all",
    },
    {
      name: `cf._domainkey.${normalized}`,
      purpose: "dkim",
      status: "pending",
      type: "TXT",
      value: "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3...",
    },
    {
      name: `cf-bounce.${normalized}`,
      priority: 10,
      purpose: "return_path",
      status: "pending",
      type: "MX",
      value: "inbound-smtp.cloudflare.net",
    },
    {
      name: `_dmarc.${normalized}`,
      purpose: "dmarc",
      status: "pending",
      type: "TXT",
      value: "v=DMARC1; p=none;",
    },
  ];
}

function parseStoredDnsRecords(jsonString: string): OrganizationEmailDomainDnsRecord[] {
  try {
    const parsed: unknown = JSON.parse(jsonString || "[]");
    return z.array(organizationEmailDomainDnsRecordSchema).parse(parsed);
  } catch {
    return [];
  }
}

export function readOrganizationEmailSettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string,
): Response {
  const row = storage.sql
    .exec<EmailSettingsRow>(
      `SELECT organization_id, from_name, reply_to_email, custom_domain,
              custom_domain_status, dns_records_json, verified_at, last_checked_at, updated_at
       FROM organization_email_settings
       WHERE organization_id = ?
       LIMIT 1`,
      organizationId,
    )
    .toArray()
    .at(0);

  if (!row) {
    return Response.json({ settings: fallbackEmailSettings });
  }

  const dnsRecords = parseStoredDnsRecords(row.dns_records_json);
  const settings: OrganizationEmailSettings = {
    customDomain: row.custom_domain,
    customDomainStatus: row.custom_domain_status,
    dnsRecords,
    fromName: row.from_name,
    lastCheckedAt: row.last_checked_at,
    replyToEmail: row.reply_to_email,
    verifiedAt: row.verified_at,
  };

  return Response.json({ settings });
}

interface ResolvedDomainDraft {
  readonly newDnsRecordsJson: string;
  readonly newDomain: string | null;
  readonly newStatus: "none" | "pending" | "active" | "degraded";
  readonly verifiedAt: string | null;
}

function resolveDomainDraft(
  existing: EmailSettingsRow | undefined,
  customDomain: string | null | undefined,
): ResolvedDomainDraft {
  if (customDomain === undefined) {
    return {
      newDnsRecordsJson: existing?.dns_records_json ?? "[]",
      newDomain: existing?.custom_domain ?? null,
      newStatus: existing?.custom_domain_status ?? "none",
      verifiedAt: existing?.verified_at ?? null,
    };
  }
  if (customDomain === null || customDomain === "") {
    return {
      newDnsRecordsJson: "[]",
      newDomain: null,
      newStatus: "none",
      verifiedAt: null,
    };
  }
  const normalized = customDomain.trim().toLowerCase();
  if (normalized !== existing?.custom_domain) {
    return {
      newDnsRecordsJson: JSON.stringify(generateRequiredDnsRecords(normalized)),
      newDomain: normalized,
      newStatus: "pending",
      verifiedAt: null,
    };
  }
  return {
    newDnsRecordsJson: existing.dns_records_json,
    newDomain: existing.custom_domain,
    newStatus: existing.custom_domain_status,
    verifiedAt: existing.verified_at,
  };
}

export async function updateOrganizationEmailSettingsInStore(
  storage: DurableObjectStorage,
  organizationId: string,
  request: Request,
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = organizationEmailSettingsUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: "invalid_email_settings" }, { status: 400 });
  }

  const { customDomain, fromName, replyToEmail } = parsed.data;
  const now = new Date().toISOString();

  const existing = storage.sql
    .exec<EmailSettingsRow>(
      `SELECT organization_id, from_name, reply_to_email, custom_domain,
              custom_domain_status, dns_records_json, verified_at, last_checked_at, updated_at
       FROM organization_email_settings
       WHERE organization_id = ?
       LIMIT 1`,
      organizationId,
    )
    .toArray()
    .at(0);

  const domainDraft = resolveDomainDraft(existing, customDomain);
  const updatedFromName = fromName !== undefined ? fromName : (existing?.from_name ?? null);
  const updatedReplyTo =
    replyToEmail !== undefined ? replyToEmail : (existing?.reply_to_email ?? null);

  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO organization_email_settings (
        organization_id, from_name, reply_to_email, custom_domain,
        custom_domain_status, dns_records_json, verified_at, last_checked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        from_name = excluded.from_name,
        reply_to_email = excluded.reply_to_email,
        custom_domain = excluded.custom_domain,
        custom_domain_status = excluded.custom_domain_status,
        dns_records_json = excluded.dns_records_json,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at`,
      organizationId,
      updatedFromName,
      updatedReplyTo,
      domainDraft.newDomain,
      domainDraft.newStatus,
      domainDraft.newDnsRecordsJson,
      domainDraft.verifiedAt,
      existing?.last_checked_at ?? null,
      now,
    );
  });

  return readOrganizationEmailSettingsFromStore(storage, organizationId);
}

function storedEmailDomainOrganizationId(storage: EmailVerificationStorage): string | undefined {
  return storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
}

function readEmailSettingsRow(
  storage: EmailVerificationStorage,
  organizationId: string,
): EmailSettingsRow | undefined {
  return storage.sql
    .exec<EmailSettingsRow>(
      `SELECT organization_id, from_name, reply_to_email, custom_domain,
              custom_domain_status, dns_records_json, verified_at, last_checked_at, updated_at
       FROM organization_email_settings
       WHERE organization_id = ?
       LIMIT 1`,
      organizationId,
    )
    .toArray()
    .at(0);
}

export async function prepareEmailDomainVerificationInStore(
  storage: EmailVerificationStorage,
  organizationId: string,
): Promise<PrepareEmailDomainVerificationResult> {
  if (storedEmailDomainOrganizationId(storage) !== organizationId) {
    return { code: "organization_identity_conflict", ok: false, status: 409 };
  }
  const existing = readEmailSettingsRow(storage, organizationId);
  const rawDomain = existing?.custom_domain?.trim() ?? "";
  if (!rawDomain) {
    return { code: "no_custom_domain_configured", ok: false, status: 400 };
  }
  const customDomain = normalizeEmailDomain(rawDomain);
  const expectedRecords = [...generateRequiredDnsRecords(customDomain)];
  const configurationId = await computeEmailDomainConfigurationId(customDomain, expectedRecords);
  return { configurationId, customDomain, dnsRecords: expectedRecords, ok: true };
}

function submittedRecordsMatchExpected(
  expectedRecords: readonly OrganizationEmailDomainDnsRecord[],
  dnsRecords: readonly OrganizationEmailDomainDnsRecord[],
): boolean {
  if (dnsRecords.length !== expectedRecords.length) return false;
  const expectedKeys = new Set<string>();
  for (const expected of expectedRecords) {
    expectedKeys.add(verificationRecordKey(expected));
  }
  for (const submitted of dnsRecords) {
    const key = verificationRecordKey(submitted);
    if (!expectedKeys.has(key)) return false;
    expectedKeys.delete(key);
  }
  return expectedKeys.size === 0;
}

function nextVerificationStatus(
  allValid: boolean,
  currentStatus: "none" | "pending" | "active" | "degraded",
): "active" | "degraded" | "pending" {
  if (allValid) return "active";
  if (currentStatus === "active" || currentStatus === "degraded") return "degraded";
  return "pending";
}

export async function commitEmailDomainVerificationInStore(
  storage: EmailVerificationStorage,
  input: {
    readonly checkedAt: string;
    readonly configurationId: string;
    readonly dnsRecords: readonly OrganizationEmailDomainDnsRecord[];
    readonly organizationId: string;
  },
): Promise<CommitEmailDomainVerificationResult> {
  const parsed = commitEmailDomainVerificationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { code: "invalid_verification_payload", ok: false, status: 400 };
  }
  const { checkedAt, configurationId, dnsRecords, organizationId } = parsed.data;
  if (storedEmailDomainOrganizationId(storage) !== organizationId) {
    return { code: "organization_identity_conflict", ok: false, status: 409 };
  }
  const existing = readEmailSettingsRow(storage, organizationId);
  const rawDomain = existing?.custom_domain?.trim() ?? "";
  if (!rawDomain) {
    return { code: "stale_email_domain_verification", ok: false, status: 409 };
  }
  const customDomain = normalizeEmailDomain(rawDomain);
  const expectedRecords = [...generateRequiredDnsRecords(customDomain)];
  const currentConfigurationId = await computeEmailDomainConfigurationId(
    customDomain,
    expectedRecords,
  );
  if (currentConfigurationId !== configurationId) {
    return { code: "stale_email_domain_verification", ok: false, status: 409 };
  }
  if (!submittedRecordsMatchExpected(expectedRecords, dnsRecords)) {
    return { code: "invalid_verification_result", ok: false, status: 400 };
  }

  const allValid = dnsRecords.every((record) => record.status === "valid");
  const nextStatus = nextVerificationStatus(allValid, existing?.custom_domain_status ?? "pending");
  const nextVerifiedAt = allValid ? checkedAt : (existing?.verified_at ?? null);
  const submittedJson = JSON.stringify([...dnsRecords]);

  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE organization_email_settings
       SET custom_domain_status = ?,
           dns_records_json = ?,
           verified_at = ?,
           last_checked_at = ?,
           updated_at = ?
       WHERE organization_id = ?`,
      nextStatus,
      submittedJson,
      nextVerifiedAt,
      checkedAt,
      checkedAt,
      organizationId,
    );
  });

  return {
    allValid,
    customDomain,
    dnsRecords: [...dnsRecords],
    lastCheckedAt: checkedAt,
    ok: true,
    status: nextStatus,
    verifiedAt: nextVerifiedAt,
  };
}
