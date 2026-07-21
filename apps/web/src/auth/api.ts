import {
  accountOrganizationsResponseSchema,
  accountSecurityResponseSchema,
  authSessionListSchema,
  currentAuthSessionSchema,
  organizationAuthStatusResponseSchema,
  organizationInvitationDetailsSchema,
  organizationInvitationResponseSchema,
  organizationMfaPolicyResponseSchema,
  organizationMfaVerificationResponseSchema,
  organizationProvisionResponseSchema,
  platformContextResponseSchema,
  platformElevationRevocationResponseSchema,
  platformMfaEnrollmentResponseSchema,
  platformMfaStatusResponseSchema,
  platformOrganizationContextResponseSchema,
  platformOrganizationsResponseSchema,
  platformRecoveryCodesResponseSchema,
  problemDetailsSchema,
  type AccountOrganization,
  type AccountPasswordRequest,
  type AccountSecurityResponse,
  type AuthSession,
  type CurrentAuthSession,
  type OrganizationAuthStatusResponse,
  type OrganizationInvitationDetails,
  type OrganizationInvitationRequest,
  type OrganizationInvitationResponse,
  type OrganizationMfaPolicyResponse,
  type OrganizationMfaVerificationResponse,
  type OrganizationProvisionRequest,
  type OrganizationProvisionResponse,
  type PlatformContextResponse,
  type PlatformOrganizationContextResponse,
  type PlatformOrganizationsResponse,
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

export async function getPlatformMfaStatus(
  signal?: AbortSignal,
): Promise<PlatformMfaStatusResponse> {
  const response = await request("/api/platform/mfa/status", { signal: signal ?? null });
  return platformMfaStatusResponseSchema.parse(await response.json());
}

export async function beginAccountMfaEnrollment(): Promise<PlatformMfaEnrollmentResponse> {
  const response = await request("/api/auth/two-factor/enable", {
    body: JSON.stringify({}),
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

export async function regenerateAccountRecoveryCodes(): Promise<readonly string[]> {
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

export async function listPlatformOrganizations(
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<PlatformOrganizationsResponse> {
  const search = new URLSearchParams();
  if (cursor) {
    search.set("cursor", cursor);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const response = await request(`/api/platform/organizations${suffix}`, {
    signal: signal ?? null,
  });
  return platformOrganizationsResponseSchema.parse(await response.json());
}

export async function provisionOrganization(
  organization: OrganizationProvisionRequest,
): Promise<OrganizationProvisionResponse> {
  const response = await request("/api/platform/organizations", {
    body: JSON.stringify(organization),
    method: "POST",
  });
  return organizationProvisionResponseSchema.parse(await response.json());
}

export async function getPlatformOrganizationContext(
  signal?: AbortSignal,
): Promise<PlatformOrganizationContextResponse> {
  const response = await request("/api/platform/organization-context", {
    signal: signal ?? null,
  });
  return platformOrganizationContextResponseSchema.parse(await response.json());
}

export async function createPlatformElevation(
  reason: string,
): Promise<PlatformOrganizationContextResponse> {
  const response = await request("/api/platform/elevations", {
    body: JSON.stringify({ reason }),
    method: "POST",
  });
  return platformOrganizationContextResponseSchema.parse(await response.json());
}

export async function revokePlatformElevation(elevationId: string): Promise<void> {
  const response = await request(`/api/platform/elevations/${encodeURIComponent(elevationId)}`, {
    method: "DELETE",
  });
  platformElevationRevocationResponseSchema.parse(await response.json());
}

export async function getOrganizationAuthStatus(
  signal?: AbortSignal,
): Promise<OrganizationAuthStatusResponse> {
  const response = await request("/api/organization/auth-status", { signal: signal ?? null });
  return organizationAuthStatusResponseSchema.parse(await response.json());
}

export async function setOrganizationMfaPolicy(
  mfaRequired: boolean,
): Promise<OrganizationMfaPolicyResponse> {
  const response = await request("/api/organization/auth-policy", {
    body: JSON.stringify({ mfaRequired }),
    method: "PATCH",
  });
  return organizationMfaPolicyResponseSchema.parse(await response.json());
}

export async function verifyOrganizationMfa(
  method: "recovery_code" | "totp",
  code: string,
): Promise<OrganizationMfaVerificationResponse> {
  const response = await request("/api/organization/mfa/verify", {
    body: JSON.stringify({ code, method }),
    method: "POST",
  });
  return organizationMfaVerificationResponseSchema.parse(await response.json());
}

export async function createOrganizationInvitation(
  invitation: OrganizationInvitationRequest,
): Promise<OrganizationInvitationResponse> {
  const response = await request("/api/organization/invitations", {
    body: JSON.stringify(invitation),
    method: "POST",
  });
  return organizationInvitationResponseSchema.parse(await response.json());
}

export async function getOrganizationInvitation(
  invitationId: string,
  signal?: AbortSignal,
): Promise<OrganizationInvitationDetails> {
  const search = new URLSearchParams({ id: invitationId });
  const response = await request(`/api/auth/organization/get-invitation?${search.toString()}`, {
    signal: signal ?? null,
  });
  return organizationInvitationDetailsSchema.parse(await response.json());
}

export async function acceptOrganizationInvitation(invitationId: string): Promise<void> {
  await request("/api/auth/organization/accept-invitation", {
    body: JSON.stringify({ invitationId }),
    method: "POST",
  });
}
