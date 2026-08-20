import { z } from "zod";
import {
  organizationEmailDomainDnsRecordSchema,
  organizationEmailSettingsUpdateRequestSchema,
  type OrganizationEmailDomainDnsRecord,
  type OrganizationEmailSettings,
} from "@choir/contracts";

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

async function checkSingleDnsRecord(
  record: OrganizationEmailDomainDnsRecord,
  fakeMode: boolean,
): Promise<OrganizationEmailDomainDnsRecord> {
  if (fakeMode) {
    return { ...record, status: "valid" };
  }
  try {
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(record.name)}&type=${encodeURIComponent(record.type)}`;
    const dohResponse = await fetch(dohUrl, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5_000),
    });

    if (!dohResponse.ok) {
      return { ...record, status: "invalid" };
    }

    const dohData: unknown = await dohResponse.json().catch(() => null);
    const hasAnswer =
      typeof dohData === "object" &&
      dohData !== null &&
      "Answer" in dohData &&
      Array.isArray(dohData.Answer) &&
      dohData.Answer.length > 0;

    return {
      ...record,
      status: hasAnswer ? "valid" : "pending",
    };
  } catch {
    return { ...record, status: "pending" };
  }
}

export async function verifyOrganizationEmailDomainInStore(
  storage: DurableObjectStorage,
  organizationId: string,
  fakeMode = false,
): Promise<Response> {
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

  if (!existing?.custom_domain) {
    return Response.json({ code: "no_custom_domain_configured" }, { status: 400 });
  }

  const baseRecords = parseStoredDnsRecords(existing.dns_records_json);
  const records =
    baseRecords.length > 0 ? baseRecords : [...generateRequiredDnsRecords(existing.custom_domain)];

  const now = new Date().toISOString();
  const verifiedRecords = await Promise.all(
    records.map((record) => checkSingleDnsRecord(record, fakeMode)),
  );

  const allValid = verifiedRecords.every((r) => r.status === "valid");
  const newStatus = allValid ? "active" : "pending";
  const verifiedAt = allValid ? now : existing.verified_at;

  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE organization_email_settings
       SET custom_domain_status = ?,
           dns_records_json = ?,
           verified_at = ?,
           last_checked_at = ?,
           updated_at = ?
       WHERE organization_id = ?`,
      newStatus,
      JSON.stringify(verifiedRecords),
      verifiedAt,
      now,
      now,
      organizationId,
    );
  });

  return Response.json({
    allValid,
    dnsRecords: verifiedRecords,
    status: newStatus,
  });
}
