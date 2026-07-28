import type { Env } from "../env";

export type PlatformEmailKind =
  "communication-test" | "email-one-time-code" | "organization-invitation" | "password-reset";

export interface PlatformEmailMessage {
  readonly kind: PlatformEmailKind;
  readonly recipient: string;
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

export function sendPlatformEmail(
  env: Pick<
    Env,
    | "PLATFORM_EMAIL"
    | "PLATFORM_EMAIL_ALLOWED_RECIPIENTS"
    | "PLATFORM_EMAIL_FROM"
    | "PLATFORM_EMAIL_MODE"
  >,
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
  if (!env.PLATFORM_EMAIL) {
    return Promise.reject(new Error("The platform email sandbox transport is not configured."));
  }
  return env.PLATFORM_EMAIL.send({
    from: env.PLATFORM_EMAIL_FROM,
    subject: message.subject,
    text: message.text,
    to: recipient,
  }).then(() => undefined);
}

export function clearCapturedPlatformEmailsForTest(): void {
  capturedMessages.length = 0;
}

export function readCapturedPlatformEmailsForTest(): readonly PlatformEmailMessage[] {
  return capturedMessages.map((message) => ({ ...message }));
}
