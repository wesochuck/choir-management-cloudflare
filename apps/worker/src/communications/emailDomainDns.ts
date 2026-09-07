import type { OrganizationEmailDomainDnsRecord } from "@choir/contracts";
import { z } from "zod";

// Worker-side DNS-over-HTTPS verification. This module performs external
// network I/O and must never be imported by OrganizationStore or any module in
// its runtime dependency closure.

export const EMAIL_DOMAIN_DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
export const EMAIL_DOMAIN_DNS_TIMEOUT_MS = 5_000;
export const EMAIL_DOMAIN_DNS_MAX_QUERIES = 16;
export const EMAIL_DOMAIN_DNS_MAX_RECORDS = 32;
export const EMAIL_DOMAIN_DNS_MAX_ANSWERS = 100;
export const EMAIL_DOMAIN_DNS_MAX_RESPONSE_BYTES = 64 * 1_024;

export type EmailDomainDnsFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface EmailDomainDnsResolutionSuccess {
  readonly conclusive: true;
  readonly records: readonly OrganizationEmailDomainDnsRecord[];
}

export type EmailDomainDnsInconclusiveReason =
  | "http_error"
  | "invalid_response"
  | "network_error"
  | "oversized_response"
  | "server_failure"
  | "timeout"
  | "too_many_answers"
  | "too_many_records";

export interface EmailDomainDnsResolutionInconclusive {
  readonly conclusive: false;
  readonly reason: EmailDomainDnsInconclusiveReason;
}

export type EmailDomainDnsResolutionResult =
  EmailDomainDnsResolutionInconclusive | EmailDomainDnsResolutionSuccess;

export function normalizeDnsName(name: string): string {
  return name.trim().toLowerCase().replace(/\.+$/, "");
}

export function normalizeTxtPayload(raw: string): string {
  const trimmed = raw.trim();
  const segments: string[] = [];
  const quotedPattern = /"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = quotedPattern.exec(trimmed)) !== null) {
    const inner = match[1] ?? "";
    segments.push(inner.replace(/\\(.)/g, "$1"));
  }
  if (segments.length > 0) {
    return segments.join("");
  }
  return trimmed;
}

export function parseMxAnswerData(
  data: string,
): { readonly exchange: string; readonly priority: number } | null {
  const parts = data.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const priorityRaw = parts[0];
  const exchangeRaw = parts[1];
  if (priorityRaw === undefined || exchangeRaw === undefined) return null;
  const priority = Number(priorityRaw);
  if (!Number.isInteger(priority) || priority < 0 || priority > 65_535) return null;
  const exchange = normalizeDnsName(exchangeRaw);
  if (exchange.length === 0) return null;
  return { exchange, priority };
}

const dohAnswerSchema = z.object({
  data: z.string().min(1).max(4_096),
  name: z.string().min(1).max(253),
  type: z.number().int().min(0).max(65_535),
});

const dohResponseSchema = z.object({
  Answer: z.array(dohAnswerSchema).optional(),
  Status: z.number().int().min(0).max(15),
});

type DohResponse = z.infer<typeof dohResponseSchema>;

const DNS_TYPE_NUMBERS: Readonly<Record<string, number>> = {
  CNAME: 5,
  MX: 15,
  TXT: 16,
};

function dnsTypeNumber(type: string): number | null {
  return DNS_TYPE_NUMBERS[type] ?? null;
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "TimeoutError";
  if (typeof error === "object" && error !== null && "name" in error) {
    return (error as { readonly name?: unknown }).name === "TimeoutError";
  }
  return false;
}

interface DohQueryOutcome {
  readonly inconclusive?: EmailDomainDnsInconclusiveReason | undefined;
  readonly response?: DohResponse | undefined;
}

async function querySingleDohRecord(
  name: string,
  type: string,
  fetcher: EmailDomainDnsFetcher,
): Promise<DohQueryOutcome> {
  const url = `${EMAIL_DOMAIN_DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(EMAIL_DOMAIN_DNS_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    return { inconclusive: isTimeoutError(error) ? "timeout" : "network_error" };
  }
  if (!response.ok) {
    return { inconclusive: "http_error" };
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { inconclusive: "network_error" };
  }
  if (text.length > EMAIL_DOMAIN_DNS_MAX_RESPONSE_BYTES) {
    return { inconclusive: "oversized_response" };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return { inconclusive: "invalid_response" };
  }
  const parsed = dohResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { inconclusive: "invalid_response" };
  }
  const answers = parsed.data.Answer ?? [];
  if (answers.length > EMAIL_DOMAIN_DNS_MAX_ANSWERS) {
    return { inconclusive: "too_many_answers" };
  }
  // Status 0 (NOERROR) and 3 (NXDOMAIN) are conclusive record-absence or
  // answer signals. Any other RCODE indicates the resolver could not provide
  // a trustworthy answer for this name/type.
  if (parsed.data.Status !== 0 && parsed.data.Status !== 3) {
    return { inconclusive: "server_failure" };
  }
  return { response: parsed.data };
}

function expectedRecordMatchesAnswer(
  expected: OrganizationEmailDomainDnsRecord,
  answerData: string,
): boolean {
  if (expected.type === "TXT") {
    return normalizeTxtPayload(answerData) === expected.value;
  }
  if (expected.type === "MX") {
    const parsed = parseMxAnswerData(answerData);
    if (!parsed || expected.priority === undefined) return false;
    return (
      parsed.priority === expected.priority && parsed.exchange === normalizeDnsName(expected.value)
    );
  }
  // CNAME: exact normalized target comparison.
  return normalizeDnsName(answerData) === normalizeDnsName(expected.value);
}

function evaluateExpectedRecord(
  expected: OrganizationEmailDomainDnsRecord,
  response: DohResponse,
): OrganizationEmailDomainDnsRecord {
  const expectedTypeNumber = dnsTypeNumber(expected.type);
  const expectedName = normalizeDnsName(expected.name);
  const answers = (response.Answer ?? []).filter((answer) => {
    if (expectedTypeNumber !== null && answer.type !== expectedTypeNumber) return false;
    return normalizeDnsName(answer.name) === expectedName;
  });
  if (answers.length === 0) {
    return { ...expected, status: "pending" };
  }
  const matched = answers.some((answer) => expectedRecordMatchesAnswer(expected, answer.data));
  return { ...expected, status: matched ? "valid" : "invalid" };
}

export async function resolveEmailDomainDnsRecords(
  records: readonly OrganizationEmailDomainDnsRecord[],
  options?: { readonly fetcher?: EmailDomainDnsFetcher | undefined },
): Promise<EmailDomainDnsResolutionResult> {
  if (records.length === 0 || records.length > EMAIL_DOMAIN_DNS_MAX_RECORDS) {
    return { conclusive: false, reason: "too_many_records" };
  }
  const fetcher = options?.fetcher ?? globalThis.fetch.bind(globalThis);

  const queryKeys = new Map<string, { readonly name: string; readonly type: string }>();
  for (const record of records) {
    const key = `${normalizeDnsName(record.name)}|${record.type}`;
    if (!queryKeys.has(key)) {
      queryKeys.set(key, { name: normalizeDnsName(record.name), type: record.type });
    }
  }
  if (queryKeys.size > EMAIL_DOMAIN_DNS_MAX_QUERIES) {
    return { conclusive: false, reason: "too_many_records" };
  }

  const entries = [...queryKeys.entries()];
  const outcomes = await Promise.all(
    entries.map(async ([key, query]) => {
      const outcome = await querySingleDohRecord(query.name, query.type, fetcher);
      return { key, outcome, query };
    }),
  );
  for (const { outcome } of outcomes) {
    if (outcome.inconclusive) {
      return { conclusive: false, reason: outcome.inconclusive };
    }
  }

  const responsesByKey = new Map<string, DohResponse>();
  for (const { key, outcome } of outcomes) {
    if (outcome.response) responsesByKey.set(key, outcome.response);
  }

  const resolved = records.map((record) => {
    const key = `${normalizeDnsName(record.name)}|${record.type}`;
    const response = responsesByKey.get(key);
    if (!response) {
      return { ...record, status: "pending" as const };
    }
    return evaluateExpectedRecord(record, response);
  });
  return { conclusive: true, records: resolved };
}
