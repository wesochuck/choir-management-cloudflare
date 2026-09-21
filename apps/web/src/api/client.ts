import { problemDetailsSchema } from "@choir/contracts";
import type { z } from "zod";

export interface ProviderErrorDiagnostics {
  readonly code?: string | undefined;
  readonly requestId?: string | undefined;
  readonly requestLogUrl?: string | undefined;
  readonly safeMessage?: string | undefined;
  readonly status?: number | undefined;
}

export class AuthApiError extends Error {
  readonly code: string;
  readonly providerError: ProviderErrorDiagnostics | undefined;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    code: string,
    providerError?: ProviderErrorDiagnostics,
  ) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
    this.status = status;
    this.providerError = providerError;
  }
}

export async function responseError(response: Response): Promise<AuthApiError> {
  const body: unknown = await response.json().catch(() => null);
  const problem = problemDetailsSchema.safeParse(body);
  return new AuthApiError(
    problem.success ? problem.data.message : "The account service could not complete the request.",
    response.status,
    problem.success ? problem.data.code : "unknown",
    problem.success ? problem.data.providerError : undefined,
  );
}

export function optionalPasswordBody(password: string): { readonly password?: string } {
  return password.length > 0 ? { password } : {};
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    cache: init.cache ?? "no-store",
    credentials: "same-origin",
    headers,
  });
  if (!response.ok) throw await responseError(response);
  return response;
}

export async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await request(path, init);
  const json: unknown = await response.json();
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AuthApiError(
      `Invalid response format from ${path}: ${result.error.issues[0]?.message ?? "validation failed"}`,
      response.status,
      "invalid_response_schema",
    );
  }
  return result.data;
}
