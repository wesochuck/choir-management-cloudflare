import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
  sendPlatformEmail,
  type PlatformEmailMessage,
} from "./platformEmail";

const message: PlatformEmailMessage = {
  kind: "email-one-time-code",
  recipient: "member@example.test",
  subject: "Test subject",
  text: "Sensitive test content",
};

const inactiveEmailEnvironment = {
  PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
  PLATFORM_EMAIL_FROM: "auth@example.test",
};

describe("platform email delivery", () => {
  beforeEach(() => {
    clearCapturedPlatformEmailsForTest();
  });

  it("captures fake messages in memory without mutating the caller's object", async () => {
    await sendPlatformEmail(
      { ...inactiveEmailEnvironment, PLATFORM_EMAIL_MODE: "capture" },
      message,
    );

    expect(readCapturedPlatformEmailsForTest()).toEqual([message]);
    expect(readCapturedPlatformEmailsForTest()[0]).not.toBe(message);
  });

  it("does not retain disabled messages", async () => {
    await sendPlatformEmail(
      { ...inactiveEmailEnvironment, PLATFORM_EMAIL_MODE: "disabled" },
      message,
    );

    expect(readCapturedPlatformEmailsForTest()).toEqual([]);
  });

  it("fails closed when sandbox delivery has not been configured", async () => {
    await expect(
      sendPlatformEmail(
        {
          ...inactiveEmailEnvironment,
          PLATFORM_EMAIL_ALLOWED_RECIPIENTS: message.recipient,
          PLATFORM_EMAIL_MODE: "sandbox",
        },
        message,
      ),
    ).rejects.toThrow("not configured");
    expect(readCapturedPlatformEmailsForTest()).toEqual([]);
  });

  it("fails closed for a recipient outside the staging allowlist", async () => {
    await expect(
      sendPlatformEmail(
        {
          ...inactiveEmailEnvironment,
          PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "someone-else@example.test",
          PLATFORM_EMAIL_MODE: "sandbox",
        },
        message,
      ),
    ).rejects.toThrow("not allowlisted");
  });

  it("sends an allowlisted message through the native binding", async () => {
    const delivered: EmailMessageBuilder[] = [];
    const email: SendEmail = {
      send(candidate: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
        if ("subject" in candidate) delivered.push(candidate);
        return Promise.resolve({ messageId: "test-message" });
      },
    };
    await sendPlatformEmail(
      {
        PLATFORM_EMAIL: email,
        PLATFORM_EMAIL_ALLOWED_RECIPIENTS: ` OTHER@example.test,${message.recipient.toUpperCase()} `,
        PLATFORM_EMAIL_FROM: "auth@mail.example.test",
        PLATFORM_EMAIL_MODE: "sandbox",
      },
      message,
    );
    expect(delivered).toEqual([
      {
        from: "auth@mail.example.test",
        subject: message.subject,
        text: message.text,
        to: message.recipient,
      },
    ]);
  });
});
