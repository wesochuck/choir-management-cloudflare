import type { Env } from "../env";
import {
  attachEmailProviderMessage,
  isEmailProviderSuppressed,
  markEmailProviderRouteUnknown,
  prepareEmailProviderRoute,
} from "../communications/emailFeedback";

export type PlatformEmailKind =
  "communication-test" | "email-one-time-code" | "organization-invitation" | "password-reset";

export interface PlatformEmailMessage {
  readonly kind: PlatformEmailKind;
  readonly html?: string;
  readonly organizationId?: string;
  readonly recipient: string;
  readonly sourceId?: string;
  readonly subject: string;
  readonly text: string;
}

const MAX_CAPTURED_MESSAGES = 50;
const capturedMessages: PlatformEmailMessage[] = [];

function captureMessage(message: PlatformEmailMessage): void {
  capturedMessages.push({ ...message });
  if (capturedMessages.length > MAX_CAPTURED_MESSAGES) {
    capturedMessages.splice(0, capturedMessages.length - MAX_CAPTURED_MESSAGES);
  }
}

async function stablePlatformSourceId(message: PlatformEmailMessage): Promise<string> {
  const input = new TextEncoder().encode(
    [message.kind, message.recipient.trim().toLowerCase(), message.subject, message.text].join(
      "\n",
    ),
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  return `platform:${message.kind}:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// eslint-disable-next-line complexity -- coordinates capture, suppression, route reservation, and provider acceptance.
export async function sendPlatformEmail(
  env: Pick<
    Env,
    | "PLATFORM_EMAIL"
    | "PLATFORM_EMAIL_ALLOWED_RECIPIENTS"
    | "PLATFORM_EMAIL_FROM"
    | "PLATFORM_EMAIL_MODE"
  > &
    Partial<Pick<Env, "CONTROL_DB">>,
  message: PlatformEmailMessage,
): Promise<void> {
  if (env.PLATFORM_EMAIL_MODE === "disabled") {
    return Promise.resolve();
  }
  if (env.PLATFORM_EMAIL_MODE === "capture") {
    captureMessage(message);
    return Promise.resolve();
  }

  const recipient = message.recipient.trim().toLowerCase();
  const allowedRecipients = new Set(
    (env.PLATFORM_EMAIL_ALLOWED_RECIPIENTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowedRecipients.has(recipient)) {
    return Promise.reject(new Error("The platform email recipient is not allowlisted."));
  }
  if (env.CONTROL_DB && (await isEmailProviderSuppressed(env.CONTROL_DB, recipient))) {
    return Promise.resolve();
  }
  if (!env.PLATFORM_EMAIL) {
    return Promise.reject(new Error("The platform email sandbox transport is not configured."));
  }
  const controlDatabase = env.CONTROL_DB;
  const sourceId =
    message.sourceId ?? (controlDatabase ? await stablePlatformSourceId(message) : undefined);
  const routeInput = controlDatabase
    ? {
        destination: recipient,
        organizationId: message.organizationId ?? null,
        sourceId: sourceId ?? crypto.randomUUID(),
        sourceKind:
          message.kind === "communication-test"
            ? ("test_email" as const)
            : ("platform_auth" as const),
      }
    : null;
  const route =
    routeInput && controlDatabase
      ? await prepareEmailProviderRoute(controlDatabase, routeInput)
      : null;
  if (route?.alreadyAccepted) return Promise.resolve();
  let result: Awaited<ReturnType<SendEmail["send"]>>;
  try {
    result = await env.PLATFORM_EMAIL.send({
      from: { email: env.PLATFORM_EMAIL_FROM, name: "Choir Management" },
      ...(message.html ? { html: message.html } : {}),
      subject: message.subject,
      text: message.text,
      to: recipient,
    });
  } catch (error: unknown) {
    if (routeInput && controlDatabase) {
      await markEmailProviderRouteUnknown(controlDatabase, routeInput).catch(() => undefined);
    }
    throw error;
  }
  if (routeInput && controlDatabase) {
    await attachEmailProviderMessage(controlDatabase, routeInput, result.messageId).catch(
      async (error: unknown) => {
        await markEmailProviderRouteUnknown(controlDatabase, routeInput).catch(() => undefined);
        console.error(
          JSON.stringify({
            errorType: error instanceof Error ? error.name : "UnknownError",
            event: "email_provider_route_attach_failed",
            sourceId: routeInput.sourceId,
            sourceKind: routeInput.sourceKind,
          }),
        );
      },
    );
  }
  return undefined;
}

export function clearCapturedPlatformEmailsForTest(): void {
  capturedMessages.length = 0;
}

export function readCapturedPlatformEmailsForTest(): readonly PlatformEmailMessage[] {
  return capturedMessages.map((message) => ({ ...message }));
}
