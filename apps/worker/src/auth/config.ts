import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP, organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

import type { Env } from "../env";
import {
  buildOneTimeCodeEmail,
  buildOrganizationInvitationEmail,
  buildPasswordResetEmail,
} from "./emailTemplates";
import { sendPlatformEmail } from "./platformEmail";
import { readOrganizationEmailSenderConfig } from "../jobs/deliveries/shared";
import { resolveRpId } from "./passkeyConfig";

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

export function trustedAuthOrigins(
  appEnvironment: Env["APP_ENV"],
  productBaseDomain: string,
  currentOrigin: string,
): string[] {
  const baseDomain = normalizeHostname(productBaseDomain);
  const protocol = appEnvironment === "local" ? "http" : "https";
  const origins = new Set<string>([currentOrigin]);
  if (baseDomain === "localhost") {
    origins.add("http://localhost");
    origins.add("http://localhost:5173");
    origins.add("http://localhost:8787");
    origins.add("http://*.localhost:5173");
    origins.add("http://*.localhost:8787");
  } else {
    origins.add(`${protocol}://${baseDomain}`);
    origins.add(`${protocol}://*.${baseDomain}`);
  }
  return Array.from(origins);
}

function canonicalOrganizationOrigin(env: Env, slug: string): string {
  const baseDomain = normalizeHostname(env.PRODUCT_BASE_DOMAIN);
  const hostname = baseDomain.endsWith(".workers.dev") ? baseDomain : `${slug}.${baseDomain}`;
  const protocol = env.APP_ENV === "local" ? "http" : "https";
  return `${protocol}://${hostname}`;
}

function parsePasskeyReturnedSession(
  returned: unknown,
): { readonly id: string; readonly userId: string } | null {
  if (
    typeof returned === "object" &&
    returned !== null &&
    "session" in returned &&
    typeof returned.session === "object" &&
    returned.session !== null &&
    "id" in returned.session &&
    typeof returned.session.id === "string" &&
    "userId" in returned.session &&
    typeof returned.session.userId === "string"
  ) {
    return { id: returned.session.id, userId: returned.session.userId };
  }
  return null;
}

export function createAuth(context: AuthRequestContext) {
  const { env, requestUrl, waitUntil } = context;
  const origin = requestUrl.origin;
  const rpID = resolveRpId(env.PRODUCT_BASE_DOMAIN, requestUrl);

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
        const content = buildPasswordResetEmail(resetUrl.toString());
        await sendPlatformEmail(env, {
          kind: "password-reset",
          html: content.html,
          recipient: user.email,
          subject: content.subject,
          text: content.text,
        });
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/passkey/verify-authentication") {
          const session = parsePasskeyReturnedSession(ctx.context.returned);
          if (session) {
            const now = Date.now();
            await env.CONTROL_DB.prepare(
              `INSERT INTO session_auth_assurance (session_id, user_id, method, verified_at)
               VALUES (?, ?, 'passkey', ?)
               ON CONFLICT(session_id) DO UPDATE SET
                 user_id = excluded.user_id,
                 method = excluded.method,
                 verified_at = excluded.verified_at`,
            )
              .bind(session.id, session.userId, now)
              .run();
          }
        }
      }),
    },
    plugins: [
      emailOTP({
        allowedAttempts: 5,
        disableSignUp: true,
        expiresIn: 10 * 60,
        otpLength: 6,
        rateLimit: { max: 3, window: 60 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          const content = buildOneTimeCodeEmail(
            otp,
            type === "sign-in" ? "sign-in" : "verify-email",
          );
          await sendPlatformEmail(env, {
            kind: "email-one-time-code",
            html: content.html,
            recipient: email,
            subject: content.subject,
            text: content.text,
          });
        },
        storeOTP: "hashed",
      }),
      organization({
        allowUserToCreateOrganization: false,
        cancelPendingInvitationsOnReInvite: true,
        disableOrganizationDeletion: true,
        invitationExpiresIn: 8 * 24 * 60 * 60,
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
          const content = buildOrganizationInvitationEmail(
            invitationUrl.toString(),
            invitedOrganization.name,
          );
          const senderConfig = await readOrganizationEmailSenderConfig(env, invitedOrganization.id);
          await sendPlatformEmail(env, {
            fromName: senderConfig.fromName ?? invitedOrganization.name,
            html: content.html,
            kind: "organization-invitation",
            organizationId: invitedOrganization.id,
            recipient: email,
            ...(senderConfig.replyTo ? { replyTo: senderConfig.replyTo } : {}),
            ...(senderConfig.sendingDomain ? { sendingDomain: senderConfig.sendingDomain } : {}),
            sourceId: id,
            subject: content.subject,
            text: content.text,
          });
        },
      }),
      passkey({
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw new Error("WebAuthn user verification is required.");
            }
          },
        },
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
        origin,
        rpID,
        rpName: "Choir Management",
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
    trustedOrigins: trustedAuthOrigins(env.APP_ENV, env.PRODUCT_BASE_DOMAIN, origin),
  });
}
