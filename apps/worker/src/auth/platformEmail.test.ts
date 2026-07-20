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

describe("platform email delivery", () => {
  beforeEach(() => {
    clearCapturedPlatformEmailsForTest();
  });

  it("captures fake messages in memory without mutating the caller's object", async () => {
    await sendPlatformEmail({ PLATFORM_EMAIL_MODE: "capture" }, message);

    expect(readCapturedPlatformEmailsForTest()).toEqual([message]);
    expect(readCapturedPlatformEmailsForTest()[0]).not.toBe(message);
  });

  it("does not retain disabled messages", async () => {
    await sendPlatformEmail({ PLATFORM_EMAIL_MODE: "disabled" }, message);

    expect(readCapturedPlatformEmailsForTest()).toEqual([]);
  });

  it("fails closed when sandbox delivery has not been configured", async () => {
    await expect(sendPlatformEmail({ PLATFORM_EMAIL_MODE: "sandbox" }, message)).rejects.toThrow(
      "not configured",
    );
    expect(readCapturedPlatformEmailsForTest()).toEqual([]);
  });
});
