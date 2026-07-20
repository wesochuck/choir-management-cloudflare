import type { Env } from "../env";

export type PlatformEmailKind =
  "email-one-time-code" | "organization-invitation" | "password-reset";

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
  env: Pick<Env, "PLATFORM_EMAIL_MODE">,
  message: PlatformEmailMessage,
): Promise<void> {
  if (env.PLATFORM_EMAIL_MODE === "disabled") {
    return Promise.resolve();
  }
  if (env.PLATFORM_EMAIL_MODE === "capture") {
    captureMessage(message);
    return Promise.resolve();
  }

  return Promise.reject(new Error("The platform email sandbox transport is not configured."));
}

export function clearCapturedPlatformEmailsForTest(): void {
  capturedMessages.length = 0;
}

export function readCapturedPlatformEmailsForTest(): readonly PlatformEmailMessage[] {
  return capturedMessages.map((message) => ({ ...message }));
}
