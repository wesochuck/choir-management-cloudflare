import { describe, expect, it, vi } from "vitest";

import type { OrganizationEmailDomainDnsRecord } from "@choir/contracts";

import {
  normalizeDnsName,
  normalizeTxtPayload,
  parseMxAnswerData,
  resolveEmailDomainDnsRecords,
  type EmailDomainDnsFetcher,
} from "./emailDomainDns";
import { generateRequiredDnsRecords } from "../organization/organizationEmailSettingsStore";

const DOMAIN = "mail.example.org";
const EXPECTED = [...generateRequiredDnsRecords(DOMAIN)];

function expectedRecord(purpose: string): OrganizationEmailDomainDnsRecord {
  const record = EXPECTED.find((item) => item.purpose === purpose);
  if (record === undefined) throw new Error(`Missing expected record for ${purpose}`);
  return record;
}

function dohResponse(
  answer: readonly { readonly data: string; readonly name: string; readonly type: number }[],
  status = 0,
): unknown {
  return { Answer: [...answer], Status: status };
}

function fetcherFor(
  handler: (name: string, type: string) => unknown,
  calls: { count: number; keys: string[] } = { count: 0, keys: [] },
): EmailDomainDnsFetcher {
  return vi.fn((input: string) => {
    const url = new URL(input);
    const name = url.searchParams.get("name") ?? "";
    const type = url.searchParams.get("type") ?? "";
    calls.count += 1;
    calls.keys.push(`${name}|${type}`);
    return Promise.resolve(Response.json(handler(name, type)));
  });
}

function txtAnswer(
  name: string,
  payload: string,
): { readonly data: string; readonly name: string; readonly type: number } {
  return { data: `"${payload}"`, name, type: 16 };
}

describe("emailDomainDns normalization", () => {
  it("normalizes owner case and trailing dots", () => {
    expect(normalizeDnsName("Mail.Example.ORG.")).toBe("mail.example.org");
    expect(normalizeDnsName("  CF._DOMAINKEY.Mail.Example.Org ")).toBe(
      "cf._domainkey.mail.example.org",
    );
  });

  it("reconstructs quoted and split TXT payloads while preserving spaces", () => {
    expect(normalizeTxtPayload('"v=spf1 include:_spf.cloudflare.com ~all"')).toBe(
      "v=spf1 include:_spf.cloudflare.com ~all",
    );
    expect(normalizeTxtPayload('"v=DKIM1; k=rsa;" " p=abc"')).toBe("v=DKIM1; k=rsa; p=abc");
    expect(normalizeTxtPayload("v=DMARC1; p=none;")).toBe("v=DMARC1; p=none;");
  });

  it("parses MX priority and exchange targets", () => {
    expect(parseMxAnswerData("10 inbound-smtp.cloudflare.net")).toEqual({
      exchange: "inbound-smtp.cloudflare.net",
      priority: 10,
    });
    expect(parseMxAnswerData("10 INBOUND-SMTP.CLOUDFLARE.NET.")).toEqual({
      exchange: "inbound-smtp.cloudflare.net",
      priority: 10,
    });
    expect(parseMxAnswerData("not-a-mx")).toBeNull();
    expect(parseMxAnswerData("10")).toBeNull();
  });
});

describe("resolveEmailDomainDnsRecords exact matching", () => {
  it("marks exact SPF and DKIM TXT answers valid", async () => {
    const spf = expectedRecord("spf");
    const fetcher = fetcherFor((name) => {
      if (name === spf.name) return dohResponse([txtAnswer(spf.name, spf.value)]);
      return dohResponse([]);
    });
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) {
      expect(result.records[0]?.status).toBe("valid");
    }
  });

  it("marks exact DKIM TXT answer valid", async () => {
    const dkim = expectedRecord("dkim");
    const fetcher = fetcherFor(() => dohResponse([txtAnswer(dkim.name, dkim.value)]));
    const result = await resolveEmailDomainDnsRecords([dkim], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("valid");
  });

  it("marks TXT owner or value mismatches invalid", async () => {
    const spf = expectedRecord("spf");
    const fetcher = fetcherFor(() =>
      dohResponse([txtAnswer(spf.name, "v=spf1 include:other ~all")]),
    );
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("invalid");
  });

  it("ignores unrelated TXT records when the exact value is present", async () => {
    const spf = expectedRecord("spf");
    const fetcher = fetcherFor(() =>
      dohResponse([txtAnswer(spf.name, "some unrelated value"), txtAnswer(spf.name, spf.value)]),
    );
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("valid");
  });

  it("does not accept an answer for an unrelated owner", async () => {
    const spf = expectedRecord("spf");
    const fetcher = fetcherFor(() =>
      dohResponse([{ data: `"${spf.value}"`, name: "other.example.org", type: 16 }]),
    );
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("pending");
  });

  it("treats no-answer NODATA as pending", async () => {
    const spf = expectedRecord("spf");
    const fetcher = fetcherFor(() => dohResponse([]));
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("pending");
  });

  it("treats NXDOMAIN as pending", async () => {
    const spf = expectedRecord("spf");
    const fetcher = fetcherFor(() => ({ Status: 3 }));
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("pending");
  });

  it("does not use substring matching for SPF values", async () => {
    const spf = expectedRecord("spf");
    const fetcher = fetcherFor(() =>
      dohResponse([txtAnswer(spf.name, `prefix ${spf.value} suffix`)]),
    );
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("invalid");
  });

  it("matches exact MX priority and exchange", async () => {
    const mx = expectedRecord("return_path");
    const priority = mx.priority ?? 10;
    const fetcher = fetcherFor(() =>
      dohResponse([{ data: `${String(priority)} ${mx.value}`, name: mx.name, type: 15 }]),
    );
    const result = await resolveEmailDomainDnsRecords([mx], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("valid");
  });

  it("rejects correct MX exchange at the wrong priority", async () => {
    const mx = expectedRecord("return_path");
    const wrongPriority = (mx.priority ?? 10) + 10;
    const fetcher = fetcherFor(() =>
      dohResponse([{ data: `${String(wrongPriority)} ${mx.value}`, name: mx.name, type: 15 }]),
    );
    const result = await resolveEmailDomainDnsRecords([mx], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("invalid");
  });

  it("compares CNAME targets case-insensitively with trailing dots", async () => {
    const record: OrganizationEmailDomainDnsRecord = {
      name: "connect.example.org",
      purpose: "spf",
      status: "pending",
      type: "CNAME",
      value: "target.example.net",
    };
    const fetcher = fetcherFor(() =>
      dohResponse([{ data: "TARGET.EXAMPLE.NET.", name: record.name, type: 5 }]),
    );
    const result = await resolveEmailDomainDnsRecords([record], { fetcher });
    expect(result.conclusive).toBe(true);
    if (result.conclusive) expect(result.records[0]?.status).toBe("valid");
  });

  it("deduplicates identical name and type queries", async () => {
    const spf = expectedRecord("spf");
    const duplicate: OrganizationEmailDomainDnsRecord = { ...spf, purpose: "spf" };
    const calls = { count: 0, keys: [] as string[] };
    const fetcher = fetcherFor(() => dohResponse([txtAnswer(spf.name, spf.value)]), calls);
    const result = await resolveEmailDomainDnsRecords([spf, duplicate], { fetcher });
    expect(result.conclusive).toBe(true);
    expect(calls.count).toBe(1);
  });

  it("treats timeout as inconclusive", async () => {
    const spf = expectedRecord("spf");
    const fetcher: EmailDomainDnsFetcher = () => {
      throw new DOMException("Timeout", "TimeoutError");
    };
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result).toEqual({ conclusive: false, reason: "timeout" });
  });

  it("treats network errors as inconclusive", async () => {
    const spf = expectedRecord("spf");
    const fetcher: EmailDomainDnsFetcher = () => {
      throw new Error("boom");
    };
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result).toEqual({ conclusive: false, reason: "network_error" });
  });

  it("treats non-success HTTP as inconclusive", async () => {
    const spf = expectedRecord("spf");
    const fetcher: EmailDomainDnsFetcher = () =>
      Promise.resolve(new Response("error", { status: 500 }));
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result).toEqual({ conclusive: false, reason: "http_error" });
  });

  it("treats malformed JSON as inconclusive", async () => {
    const spf = expectedRecord("spf");
    const fetcher: EmailDomainDnsFetcher = () =>
      Promise.resolve(new Response("not-json", { status: 200 }));
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result).toEqual({ conclusive: false, reason: "invalid_response" });
  });

  it("treats oversized responses as inconclusive", async () => {
    const spf = expectedRecord("spf");
    const fetcher: EmailDomainDnsFetcher = () =>
      Promise.resolve(
        new Response(`{"Status":0,"Answer":[]}${" ".repeat(70_000)}`, { status: 200 }),
      );
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result).toEqual({ conclusive: false, reason: "oversized_response" });
  });

  it("treats resolver server failure as inconclusive", async () => {
    const spf = expectedRecord("spf");
    const fetcher = fetcherFor(() => ({ Status: 2 }));
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result).toEqual({ conclusive: false, reason: "server_failure" });
  });

  it("bounds excessive answer counts", async () => {
    const spf = expectedRecord("spf");
    const answers = Array.from({ length: 101 }, () => txtAnswer(spf.name, "other"));
    const fetcher = fetcherFor(() => dohResponse(answers));
    const result = await resolveEmailDomainDnsRecords([spf], { fetcher });
    expect(result).toEqual({ conclusive: false, reason: "too_many_answers" });
  });
});
