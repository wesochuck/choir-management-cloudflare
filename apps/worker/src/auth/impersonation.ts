import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";

export const IMPERSONATION_COOKIE_NAME = "choir_impersonation";
export const IMPERSONATION_DURATION_SECONDS = 60 * 60; // 1 hour

export interface ImpersonationContext {
  readonly active: boolean;
  readonly adminUserId: string | null;
  readonly expiresAt: string | null;
  readonly impersonatedProfileId: string | null;
}

export function readImpersonationCookie(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const cookies = headerValue.split(";");
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.trim().split("=");
    if (name === IMPERSONATION_COOKIE_NAME) {
      return rest.join("=").trim() || null;
    }
  }
  return null;
}

export async function createImpersonationToken(
  secret: string,
  organizationId: string,
  profileId: string,
  adminUserId: string,
  adminSessionId: string,
  now = new Date(),
): Promise<{ readonly expiresAt: string; readonly token: string }> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = nowSeconds + IMPERSONATION_DURATION_SECONDS;
  const token = await issueSignedLink(secret, {
    algorithm: "HS256",
    expiresAt: expiresAtSeconds,
    issuedAt: nowSeconds,
    organizationId,
    purpose: "impersonation",
    resourceId: adminUserId,
    revocation: adminSessionId,
    subjectId: profileId,
    version: 1,
  });
  return {
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    token,
  };
}

export async function verifyImpersonationCookie(
  secret: string,
  organizationId: string,
  adminUserId: string,
  adminSessionId: string | undefined,
  cookieHeader: string | undefined,
  now = new Date(),
): Promise<ImpersonationContext> {
  const token = readImpersonationCookie(cookieHeader);
  if (!token || !adminSessionId) {
    return {
      active: false,
      adminUserId: null,
      expiresAt: null,
      impersonatedProfileId: null,
    };
  }
  const envelope = await verifySignedLinkScope(secret, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "impersonation",
    now,
  });
  if (!envelope) {
    return {
      active: false,
      adminUserId: null,
      expiresAt: null,
      impersonatedProfileId: null,
    };
  }
  if (
    envelope.resourceId !== adminUserId ||
    envelope.revocation !== adminSessionId ||
    !envelope.subjectId
  ) {
    return {
      active: false,
      adminUserId: null,
      expiresAt: null,
      impersonatedProfileId: null,
    };
  }
  return {
    active: true,
    adminUserId,
    expiresAt: new Date(envelope.expiresAt * 1000).toISOString(),
    impersonatedProfileId: envelope.subjectId,
  };
}

export function formatImpersonationSetCookie(
  token: string,
  secure: boolean,
  maxAge = IMPERSONATION_DURATION_SECONDS,
): string {
  const parts = [
    `${IMPERSONATION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${String(maxAge)}`,
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function formatImpersonationClearCookie(secure: boolean): string {
  const parts = [
    `${IMPERSONATION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
