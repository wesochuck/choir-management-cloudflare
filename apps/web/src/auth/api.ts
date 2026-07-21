import {
  accountOrganizationsResponseSchema,
  authSessionListSchema,
  currentAuthSessionSchema,
  platformContextResponseSchema,
  platformMfaEnrollmentResponseSchema,
  platformMfaStatusResponseSchema,
  platformRecoveryCodesResponseSchema,
  problemDetailsSchema,
  type AccountOrganization,
  type AuthSession,
  type CurrentAuthSession,
  type PlatformContextResponse,
  type PlatformMfaEnrollmentResponse,
  type PlatformMfaStatusResponse,
} from "@choir/contracts";

export class AuthApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

async function responseError(response: Response): Promise<AuthApiError> {
  const body: unknown = await response.json().catch(() => null);
  const problem = problemDetailsSchema.safeParse(body);
  return new AuthApiError(
    problem.success ? problem.data.message : "The account service could not complete the request.",
    response.status,
  );
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  return response;
}

export async function getCurrentSession(signal?: AbortSignal): Promise<CurrentAuthSession> {
  const response = await request("/api/auth/get-session", { signal: signal ?? null });
  return currentAuthSessionSchema.parse(await response.json());
}

export async function requestSignInCode(email: string): Promise<void> {
  await request("/api/auth/email-otp/send-verification-otp", {
    body: JSON.stringify({ email, type: "sign-in" }),
    method: "POST",
  });
}

export async function signInWithCode(email: string, otp: string): Promise<void> {
  await request("/api/auth/sign-in/email-otp", {
    body: JSON.stringify({ email, otp }),
    method: "POST",
  });
}

export async function signOut(): Promise<void> {
  await request("/api/auth/sign-out", { method: "POST" });
}

export async function listActiveSessions(signal?: AbortSignal): Promise<readonly AuthSession[]> {
  const response = await request("/api/auth/list-sessions", { signal: signal ?? null });
  return authSessionListSchema.parse(await response.json());
}

export async function revokeSession(token: string): Promise<void> {
  await request("/api/auth/revoke-session", {
    body: JSON.stringify({ token }),
    method: "POST",
  });
}

export async function listAccountOrganizations(
  signal?: AbortSignal,
): Promise<readonly AccountOrganization[]> {
  const response = await request("/api/account/organizations", { signal: signal ?? null });
  return accountOrganizationsResponseSchema.parse(await response.json()).organizations;
}

export async function getPlatformMfaStatus(
  signal?: AbortSignal,
): Promise<PlatformMfaStatusResponse> {
  const response = await request("/api/platform/mfa/status", { signal: signal ?? null });
  return platformMfaStatusResponseSchema.parse(await response.json());
}

export async function beginPlatformMfaEnrollment(): Promise<PlatformMfaEnrollmentResponse> {
  const response = await request("/api/auth/two-factor/enable", {
    body: JSON.stringify({}),
    method: "POST",
  });
  return platformMfaEnrollmentResponseSchema.parse(await response.json());
}

export async function verifyPlatformTotpEnrollment(code: string): Promise<void> {
  await request("/api/auth/two-factor/verify-totp", {
    body: JSON.stringify({ code, trustDevice: false }),
    method: "POST",
  });
}

export async function regeneratePlatformRecoveryCodes(): Promise<readonly string[]> {
  const response = await request("/api/auth/two-factor/generate-backup-codes", {
    body: JSON.stringify({}),
    method: "POST",
  });
  return platformRecoveryCodesResponseSchema.parse(await response.json()).backupCodes;
}

export async function confirmPlatformMfaEnrollment(): Promise<void> {
  await request("/api/platform/mfa/confirm-enrollment", {
    body: JSON.stringify({}),
    method: "POST",
  });
}

export async function verifyPlatformMfa(
  method: "recovery_code" | "totp",
  code: string,
): Promise<void> {
  await request("/api/platform/mfa/verify", {
    body: JSON.stringify({ code, method }),
    method: "POST",
  });
}

export async function getPlatformContext(): Promise<PlatformContextResponse> {
  const response = await request("/api/platform/context");
  return platformContextResponseSchema.parse(await response.json());
}
