import type { PublicDomainValidationRecord } from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";

export type CustomDomainProviderEnv = Pick<Env, "CUSTOM_DOMAIN_PROVIDER_MODE"> &
  Partial<Pick<Env, "CLOUDFLARE_API_TOKEN" | "CLOUDFLARE_CUSTOM_HOSTNAMES_ZONE_ID">>;

const cloudflareErrorSchema = z.object({
  message: z.string().min(1).max(500),
});

const cloudflareEnvelopeSchema = z.object({
  errors: z.array(cloudflareErrorSchema).default([]),
  result: z.unknown().optional(),
  success: z.boolean(),
});

const cloudflareValidationRecordSchema = z.object({
  http_body: z.string().optional(),
  http_url: z.string().optional(),
  txt_name: z.string().optional(),
  txt_value: z.string().optional(),
});

const cloudflareHostnameSchema = z.object({
  hostname: z.string().min(1).max(253),
  id: z.string().min(1).max(128),
  ssl: z
    .object({
      status: z.string().min(1).max(64).optional(),
      validation_records: z.array(cloudflareValidationRecordSchema).optional(),
    })
    .optional(),
  status: z.string().min(1).max(64),
  validation_records: z.array(cloudflareValidationRecordSchema).optional(),
});
const cloudflareHostnameListSchema = z.array(cloudflareHostnameSchema);

type CustomDomainProviderStatus = "active" | "error" | "not_configured" | "pending";

export interface CustomDomainProviderState {
  readonly providerHostnameId: string;
  readonly providerSslStatus: string | null;
  readonly providerStatus: CustomDomainProviderStatus;
  readonly validationRecords: readonly PublicDomainValidationRecord[];
}

export class CustomDomainProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CustomDomainProviderError";
  }
}

function providerStatus(status: string, sslStatus: string | null): CustomDomainProviderStatus {
  const normalizedStatus = status.toLowerCase();
  const normalizedSslStatus = sslStatus?.toLowerCase() ?? null;
  if (normalizedStatus === "active" && normalizedSslStatus === "active") return "active";
  if (/(?:blocked|error|expired|inactive|timeout|deleted)/.test(normalizedStatus)) return "error";
  if (
    normalizedSslStatus &&
    /(?:blocked|error|expired|inactive|timeout|deleted)/.test(normalizedSslStatus)
  ) {
    return "error";
  }
  return "pending";
}

function validationRecords(
  records: readonly z.infer<typeof cloudflareValidationRecordSchema>[],
): readonly PublicDomainValidationRecord[] {
  const normalized: PublicDomainValidationRecord[] = [];
  for (const record of records) {
    if (record.txt_name && record.txt_value) {
      normalized.push({ name: record.txt_name, type: "txt", value: record.txt_value });
    }
    if (record.http_url && record.http_body) {
      normalized.push({ name: record.http_url, type: "http", value: record.http_body });
    }
  }
  return normalized.slice(0, 10);
}

function parseHostnameResult(result: unknown): CustomDomainProviderState {
  const parsed = cloudflareHostnameSchema.safeParse(result);
  if (!parsed.success) {
    throw new CustomDomainProviderError("Cloudflare returned an invalid custom-hostname response.");
  }
  const sslStatus = parsed.data.ssl?.status ?? null;
  const records = [
    ...(parsed.data.validation_records ?? []),
    ...(parsed.data.ssl?.validation_records ?? []),
  ];
  return {
    providerHostnameId: parsed.data.id,
    providerSslStatus: sslStatus,
    providerStatus: providerStatus(parsed.data.status, sslStatus),
    validationRecords: validationRecords(records),
  };
}

function cloudflareConfiguration(env: CustomDomainProviderEnv): {
  readonly token: string;
  readonly zoneId: string;
} {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId = env.CLOUDFLARE_CUSTOM_HOSTNAMES_ZONE_ID?.trim();
  if (!token || !zoneId) {
    throw new CustomDomainProviderError(
      "Cloudflare for SaaS custom-hostname credentials are not configured.",
    );
  }
  return { token, zoneId };
}

async function cloudflareRequest(
  env: CustomDomainProviderEnv,
  path: string,
  init: RequestInit,
  allowNotFound = false,
): Promise<unknown> {
  const { token, zoneId } = cloudflareConfiguration(env);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new CustomDomainProviderError(
      "The Cloudflare custom-hostname request could not be completed.",
      true,
    );
  }
  if (allowNotFound && response.status === 404) return null;
  const body = cloudflareEnvelopeSchema.safeParse(await response.json().catch(() => null));
  if (!body.success) {
    throw new CustomDomainProviderError(
      "Cloudflare returned an invalid custom-hostname response.",
      response.status >= 500 || response.status === 429,
    );
  }
  if (!response.ok || !body.data.success) {
    const message =
      body.data.errors[0]?.message ?? "Cloudflare rejected the custom-hostname request.";
    throw new CustomDomainProviderError(message, response.status >= 500 || response.status === 429);
  }
  return body.data.result;
}

function fakeState(hostname: string): CustomDomainProviderState {
  return {
    providerHostnameId: `fake-${hostname.replaceAll(".", "-")}`,
    providerSslStatus: "active",
    providerStatus: "active",
    validationRecords: [],
  };
}

export async function ensureCustomHostname(
  env: CustomDomainProviderEnv,
  input: {
    readonly hostname: string;
    readonly providerHostnameId: string | null;
  },
): Promise<CustomDomainProviderState> {
  if (env.CUSTOM_DOMAIN_PROVIDER_MODE === "fake") return fakeState(input.hostname);
  if (env.CUSTOM_DOMAIN_PROVIDER_MODE !== "cloudflare") {
    throw new CustomDomainProviderError("Custom public-domain onboarding is disabled.");
  }

  let result: unknown;
  if (input.providerHostnameId) {
    result = await cloudflareRequest(
      env,
      `/custom_hostnames/${encodeURIComponent(input.providerHostnameId)}`,
      { method: "GET" },
    );
  } else {
    const existingResult = await cloudflareRequest(
      env,
      `/custom_hostnames?hostname=${encodeURIComponent(input.hostname)}`,
      { method: "GET" },
    );
    const existing = cloudflareHostnameListSchema.safeParse(existingResult);
    if (!existing.success) {
      throw new CustomDomainProviderError("Cloudflare returned an invalid custom-hostname list.");
    }
    result =
      existing.data.find((hostname) => hostname.hostname === input.hostname) ??
      (await cloudflareRequest(env, "/custom_hostnames", {
        body: JSON.stringify({
          hostname: input.hostname,
          ssl: { method: "txt", type: "dv" },
        }),
        method: "POST",
      }));
  }
  return parseHostnameResult(result);
}

export async function deleteCustomHostname(
  env: CustomDomainProviderEnv,
  providerHostnameId: string | null,
): Promise<void> {
  if (!providerHostnameId || env.CUSTOM_DOMAIN_PROVIDER_MODE === "fake") return;
  if (env.CUSTOM_DOMAIN_PROVIDER_MODE !== "cloudflare") {
    throw new CustomDomainProviderError("Custom public-domain onboarding is disabled.");
  }
  await cloudflareRequest(
    env,
    `/custom_hostnames/${encodeURIComponent(providerHostnameId)}`,
    { method: "DELETE" },
    true,
  );
}
