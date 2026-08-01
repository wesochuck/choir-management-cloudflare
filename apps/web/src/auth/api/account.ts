import {
  accountOrganizationsResponseSchema,
  accountSecurityResponseSchema,
  authSessionListSchema,
  currentAuthSessionSchema,
  platformMfaEnrollmentResponseSchema,
  platformRecoveryCodesResponseSchema,
  type AccountOrganization,
  type AccountPasswordRequest,
  type AccountSecurityResponse,
  type AuthSession,
  type CurrentAuthSession,
  type PlatformMfaEnrollmentResponse,
} from "@choir/contracts";

import { optionalPasswordBody, request } from "./client";

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

export type PasswordSignInResult = "signed_in" | "two_factor_required";

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<PasswordSignInResult> {
  const response = await request("/api/auth/sign-in/email", {
    body: JSON.stringify({ email, password }),
    method: "POST",
  });
  const body: unknown = await response.json();
  return typeof body === "object" &&
    body !== null &&
    "twoFactorRedirect" in body &&
    body.twoFactorRedirect === true
    ? "two_factor_required"
    : "signed_in";
}

export async function verifyPasswordSignInSecondFactor(
  method: "recovery_code" | "totp",
  code: string,
): Promise<void> {
  const path =
    method === "totp"
      ? "/api/auth/two-factor/verify-totp"
      : "/api/auth/two-factor/verify-backup-code";
  await request(path, {
    body: JSON.stringify({ code, trustDevice: false }),
    method: "POST",
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await request("/api/auth/request-password-reset", {
    body: JSON.stringify({ email }),
    method: "POST",
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await request("/api/auth/reset-password", {
    body: JSON.stringify({ newPassword, token }),
    method: "POST",
  });
}

export async function signOut(): Promise<void> {
  await request("/api/auth/sign-out", { method: "POST" });
}

export async function listActiveSessions(signal?: AbortSignal): Promise<readonly AuthSession[]> {
  const response = await request("/api/account/sessions", { signal: signal ?? null });
  return authSessionListSchema.parse(await response.json());
}

export async function revokeSession(sessionId: string): Promise<void> {
  await request("/api/account/sessions/revoke", {
    body: JSON.stringify({ sessionId }),
    method: "POST",
  });
}

export async function listAccountOrganizations(
  signal?: AbortSignal,
): Promise<readonly AccountOrganization[]> {
  const response = await request("/api/account/organizations", { signal: signal ?? null });
  return accountOrganizationsResponseSchema.parse(await response.json()).organizations;
}

export async function getAccountSecurity(signal?: AbortSignal): Promise<AccountSecurityResponse> {
  const response = await request("/api/account/security", { signal: signal ?? null });
  return accountSecurityResponseSchema.parse(await response.json());
}

export async function updateAccountPassword(
  password: AccountPasswordRequest,
): Promise<AccountSecurityResponse> {
  const response = await request("/api/account/password", {
    body: JSON.stringify(password),
    method: "PUT",
  });
  return accountSecurityResponseSchema.parse(await response.json());
}

export async function beginAccountMfaEnrollment(
  password = "",
): Promise<PlatformMfaEnrollmentResponse> {
  const response = await request("/api/auth/two-factor/enable", {
    body: JSON.stringify(optionalPasswordBody(password)),
    method: "POST",
  });
  return platformMfaEnrollmentResponseSchema.parse(await response.json());
}

export async function verifyAccountTotpEnrollment(code: string): Promise<void> {
  await request("/api/auth/two-factor/verify-totp", {
    body: JSON.stringify({ code, trustDevice: false }),
    method: "POST",
  });
}

export async function regenerateAccountRecoveryCodes(password = ""): Promise<readonly string[]> {
  const response = await request("/api/auth/two-factor/generate-backup-codes", {
    body: JSON.stringify(optionalPasswordBody(password)),
    method: "POST",
  });
  return platformRecoveryCodesResponseSchema.parse(await response.json()).backupCodes;
}
