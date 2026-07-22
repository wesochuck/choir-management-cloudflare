import { betterAuth } from "better-auth";
import { emailOTP, organization, twoFactor } from "better-auth/plugins";

import type { Env } from "../env";
import { sendPlatformEmail } from "./platformEmail";

export const authenticationPolicy = {
  allowPublicRegistration: false,
  organizationMfaRequired: false,
  platformAdministratorMfaRequired: true,
  primarySignInMethod: "email-one-time-code",
  userManagedPasswords: true,
} as const;

export type AuthenticationPolicy = typeof authenticationPolicy;

export interface AuthRequestContext {
  readonly env: Env;
  readonly requestUrl: URL;
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function crossSubdomainCookieOptions(
  appEnvironment: Env["APP_ENV"],
  productBaseDomain: string,
): { readonly domain?: string; readonly enabled: boolean } {
  const domain = normalizeHostname(productBaseDomain);
  return appEnvironment !== "local" && !domain.endsWith(".workers.dev")
    ? { domain: `.${domain}`, enabled: true }
    : { enabled: false };
}

export function isCanonicalAuthHost(hostname: string, productBaseDomain: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedBaseDomain = normalizeHostname(productBaseDomain);

  return (
    normalizedHostname === normalizedBaseDomain ||
    normalizedHostname.endsWith(`.${normalizedBaseDomain}`)
  );
}

export function isProductBaseHost(hostname: string, productBaseDomain: string): boolean {
  return normalizeHostname(hostname) === normalizeHostname(productBaseDomain);
}

function canonicalOrganizationOrigin(env: Env, slug: string): string {
  const baseDomain = normalizeHostname(env.PRODUCT_BASE_DOMAIN);
  const hostname = baseDomain.endsWith(".workers.dev") ? baseDomain : `${slug}.${baseDomain}`;
  const protocol = env.APP_ENV === "local" ? "http" : "https";
  return `${protocol}://${hostname}`;
}

export function createAuth(context: AuthRequestContext) {
  const { env, requestUrl, waitUntil } = context;
  const origin = requestUrl.origin;

  return betterAuth({
    advanced: {
      backgroundTasks: { handler: waitUntil },
      cookiePrefix: "choir-management",
      crossSubDomainCookies: crossSubdomainCookieOptions(env.APP_ENV, env.PRODUCT_BASE_DOMAIN),
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: env.APP_ENV !== "local",
    },
    appName: "Choir Management",
    basePath: "/api/auth",
    baseURL: origin,
    database: env.CONTROL_DB,
    disabledPaths: ["/sign-up/email"],
    emailAndPassword: {
      disableSignUp: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: async ({ token, user }) => {
        const resetUrl = new URL("/reset-password", origin);
        resetUrl.hash = new URLSearchParams({ token }).toString();
        await sendPlatformEmail(env, {
          kind: "password-reset",
          recipient: user.email,
          subject: "Reset your Choir Management password",
          text: `Use this link to reset your password: ${resetUrl.toString()}`,
        });
      },
    },
    plugins: [
      emailOTP({
        allowedAttempts: 5,
        disableSignUp: true,
        expiresIn: 10 * 60,
        otpLength: 6,
        rateLimit: { max: 3, window: 60 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          const purpose = type === "sign-in" ? "sign in" : "verify your email";
          await sendPlatformEmail(env, {
            kind: "email-one-time-code",
            recipient: email,
            subject: "Your Choir Management code",
            text: `Use ${otp} to ${purpose}. This code expires in 10 minutes.`,
          });
        },
        storeOTP: "hashed",
      }),
      organization({
        allowUserToCreateOrganization: false,
        cancelPendingInvitationsOnReInvite: true,
        disableOrganizationDeletion: true,
        invitationExpiresIn: 48 * 60 * 60,
        requireEmailVerificationOnInvitation: true,
        schema: {
          organization: {
            fields: { createdAt: "created_at" },
            modelName: "organizations",
          },
        },
        sendInvitationEmail: async ({ email, id, organization: invitedOrganization }) => {
          const invitationUrl = new URL(
            "/accept-invitation",
            canonicalOrganizationOrigin(env, invitedOrganization.slug),
          );
          invitationUrl.searchParams.set("id", id);
          await sendPlatformEmail(env, {
            kind: "organization-invitation",
            recipient: email,
            subject: `Invitation to ${invitedOrganization.name}`,
            text: `Accept your invitation: ${invitationUrl.toString()}`,
          });
        },
      }),
      twoFactor({
        accountLockout: {
          durationSeconds: 15 * 60,
          enabled: true,
          maxFailedAttempts: 8,
        },
        allowPasswordless: true,
        backupCodeOptions: {
          allowPasswordless: true,
          amount: 10,
          length: 12,
          storeBackupCodes: "encrypted",
        },
        issuer: "Choir Management",
        totpOptions: {
          allowPasswordless: true,
          digits: 6,
          period: 30,
        },
        trustDeviceMaxAge: 14 * 24 * 60 * 60,
        twoFactorCookieMaxAge: 10 * 60,
      }),
    ],
    rateLimit: {
      enabled: true,
      max: 100,
      storage: "database",
      window: 60,
    },
    secret: env.BETTER_AUTH_SECRET,
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    telemetry: { enabled: false },
    trustedOrigins: [origin],
  });
}
