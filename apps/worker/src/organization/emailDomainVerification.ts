import {
  organizationEmailDomainDnsRecordSchema,
  type OrganizationEmailDomainDnsRecord,
} from "@choir/contracts";
import { z } from "zod";

// Pure verification-configuration helpers. This module must stay free of
// Worker providers, network calls, timers, sockets, alarms, and queue work so
// it is safe to import from the Organization Durable Object runtime graph.

export const EMAIL_DOMAIN_VERIFICATION_MAX_RECORDS = 32;

export function normalizeEmailDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, "");
}

export function normalizeVerificationDnsName(name: string): string {
  return name.trim().toLowerCase().replace(/\.+$/, "");
}

function normalizeVerificationValue(
  record: Pick<OrganizationEmailDomainDnsRecord, "type" | "value">,
): string {
  if (record.type === "MX" || record.type === "CNAME") {
    return normalizeVerificationDnsName(record.value);
  }
  return record.value;
}

export interface CanonicalVerificationRecord {
  readonly name: string;
  readonly priority?: number | undefined;
  readonly purpose: OrganizationEmailDomainDnsRecord["purpose"];
  readonly type: OrganizationEmailDomainDnsRecord["type"];
  readonly value: string;
}

export function toCanonicalVerificationRecords(
  records: readonly OrganizationEmailDomainDnsRecord[],
): CanonicalVerificationRecord[] {
  const canonical = records.map((record) => {
    const base = {
      name: normalizeVerificationDnsName(record.name),
      purpose: record.purpose,
      type: record.type,
      value: normalizeVerificationValue(record),
    };
    return record.type === "MX" && record.priority !== undefined
      ? { ...base, priority: record.priority }
      : base;
  });
  canonical.sort((a: CanonicalVerificationRecord, b: CanonicalVerificationRecord) => {
    const priorityA = "priority" in a && a.priority !== undefined ? String(a.priority) : "";
    const priorityB = "priority" in b && b.priority !== undefined ? String(b.priority) : "";
    const keyA = `${a.type}|${a.name}|${a.purpose}|${a.value}|${priorityA}`;
    const keyB = `${b.type}|${b.name}|${b.purpose}|${b.value}|${priorityB}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
  return canonical;
}

export function buildCanonicalVerificationPayload(
  domain: string,
  records: readonly OrganizationEmailDomainDnsRecord[],
): string {
  const normalizedDomain = normalizeEmailDomain(domain);
  const canonicalRecords = toCanonicalVerificationRecords(records);
  return JSON.stringify({ domain: normalizedDomain, records: canonicalRecords });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeEmailDomainConfigurationId(
  domain: string,
  records: readonly OrganizationEmailDomainDnsRecord[],
): Promise<string> {
  const canonical = buildCanonicalVerificationPayload(domain, records);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return toHex(new Uint8Array(digest));
}

export function verificationRecordKey(
  record: Pick<
    OrganizationEmailDomainDnsRecord,
    "name" | "priority" | "purpose" | "type" | "value"
  >,
): string {
  const name = normalizeVerificationDnsName(record.name);
  const value =
    record.type === "MX" || record.type === "CNAME"
      ? normalizeVerificationDnsName(record.value)
      : record.value;
  const priority =
    record.type === "MX" && record.priority !== undefined ? String(record.priority) : "";
  return `${record.type}|${name}|${record.purpose}|${value}|${priority}`;
}

export const prepareEmailDomainVerificationInputSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

export const commitEmailDomainVerificationInputSchema = z.object({
  checkedAt: z.iso.datetime(),
  configurationId: z.string().min(1).max(128),
  dnsRecords: z.array(organizationEmailDomainDnsRecordSchema).min(1).max(32),
  organizationId: z.string().min(1).max(128),
});

export type PrepareEmailDomainVerificationInput = z.infer<
  typeof prepareEmailDomainVerificationInputSchema
>;

export type CommitEmailDomainVerificationInput = z.infer<
  typeof commitEmailDomainVerificationInputSchema
>;

export interface PreparedEmailDomainVerification {
  readonly configurationId: string;
  readonly customDomain: string;
  readonly dnsRecords: readonly OrganizationEmailDomainDnsRecord[];
}

export type PrepareEmailDomainVerificationResult =
  | (PreparedEmailDomainVerification & { readonly ok: true })
  | {
      readonly code: "no_custom_domain_configured" | "organization_identity_conflict";
      readonly ok: false;
      readonly status: 400 | 409;
    };

export interface CommittedEmailDomainVerification {
  readonly allValid: boolean;
  readonly customDomain: string;
  readonly dnsRecords: readonly OrganizationEmailDomainDnsRecord[];
  readonly lastCheckedAt: string;
  readonly ok: true;
  readonly status: "active" | "degraded" | "pending";
  readonly verifiedAt: string | null;
}

export type CommitEmailDomainVerificationResult =
  | CommittedEmailDomainVerification
  | {
      readonly code:
        | "invalid_verification_payload"
        | "invalid_verification_result"
        | "no_custom_domain_configured"
        | "organization_identity_conflict"
        | "stale_email_domain_verification";
      readonly ok: false;
      readonly status: 400 | 409;
    };
