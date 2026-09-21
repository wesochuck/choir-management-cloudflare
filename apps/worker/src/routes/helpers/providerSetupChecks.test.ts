import { describe, expect, it } from "vitest";

import { providerSetupChecks } from "./routeContracts";

const mockEmailBinding: SendEmail = {
  send(): Promise<EmailSendResult> {
    return Promise.resolve({ messageId: "test-message" });
  },
};

const baseEnv = {
  BREVO_API_KEY: "test_brevo_key",
  BREVO_SMS_ALLOWED_RECIPIENTS: "",
  BREVO_SMS_SENDER: "ChoirAlerts",
  EXTERNAL_EFFECTS_MODE: "sandbox" as const,
  PLATFORM_EMAIL: mockEmailBinding,
  PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
  PLATFORM_EMAIL_FROM: "notifications@example.com",
  PLATFORM_EMAIL_MODE: "sandbox" as const,
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_V2_EVENT_DESTINATION_SECRET: undefined,
  STRIPE_WEBHOOK_SECRET: "whsec_123",
};

describe("providerSetupChecks", () => {
  describe("Stripe platform configuration", () => {
    it("reports ok when both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are configured in sandbox/normal mode", () => {
      const result = providerSetupChecks(baseEnv, "sandbox");

      expect(result.stripe).toEqual({
        detail:
          "Stripe Connect platform credentials and webhook verification are configured. Organization Stripe Connect onboarding is available.",
        status: "ok",
      });
    });

    it("reports error when STRIPE_SECRET_KEY is missing", () => {
      const result = providerSetupChecks(
        {
          ...baseEnv,
          STRIPE_SECRET_KEY: "",
        },
        "sandbox",
      );

      expect(result.stripe).toEqual({
        detail: "Add STRIPE_SECRET_KEY for Stripe Connect onboarding.",
        status: "error",
      });
    });

    it("reports error when STRIPE_WEBHOOK_SECRET is missing", () => {
      const result = providerSetupChecks(
        {
          ...baseEnv,
          STRIPE_WEBHOOK_SECRET: "",
        },
        "sandbox",
      );

      expect(result.stripe).toEqual({
        detail: "Add STRIPE_WEBHOOK_SECRET for signed payment webhook verification.",
        status: "error",
      });
    });

    it("reports error when STRIPE_WEBHOOK_SECRET is missing even if STRIPE_V2_EVENT_DESTINATION_SECRET is configured", () => {
      const result = providerSetupChecks(
        {
          ...baseEnv,
          STRIPE_V2_EVENT_DESTINATION_SECRET: "we_sec_v2_123",
          STRIPE_WEBHOOK_SECRET: "",
        },
        "sandbox",
      );

      expect(result.stripe).toEqual({
        detail: "Add STRIPE_WEBHOOK_SECRET for signed payment webhook verification.",
        status: "error",
      });
    });

    it("reports error when both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are missing", () => {
      const result = providerSetupChecks(
        {
          ...baseEnv,
          STRIPE_SECRET_KEY: "",
          STRIPE_WEBHOOK_SECRET: "",
        },
        "sandbox",
      );

      expect(result.stripe).toEqual({
        detail:
          "Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET for Stripe Connect onboarding and signed webhook verification.",
        status: "error",
      });
    });

    it("reports attention in fake mode when platform credentials are configured", () => {
      const result = providerSetupChecks(baseEnv, "fake");

      expect(result.stripe).toEqual({
        detail:
          "Stripe Connect platform credentials are configured, but checkout remains simulated in fake mode.",
        status: "attention",
      });
    });

    it("reports attention in fake mode when platform credentials are not configured", () => {
      const result = providerSetupChecks(
        {
          ...baseEnv,
          STRIPE_SECRET_KEY: "",
          STRIPE_WEBHOOK_SECRET: "",
        },
        "fake",
      );

      expect(result.stripe).toEqual({
        detail:
          "Fake mode is active. Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET before enabling Stripe Connect payments.",
        status: "attention",
      });
    });

    it("reports attention in disabled mode", () => {
      const result = providerSetupChecks(baseEnv, "disabled");

      expect(result.stripe).toEqual({
        detail:
          "Stripe checkout is disabled for this environment. A webhook secret alone does not enable live Organization payments.",
        status: "attention",
      });
    });
  });

  describe("Brevo communications configuration", () => {
    it("reports ok with full detail when email binding, API key, and SMS sender are present", () => {
      const result = providerSetupChecks(baseEnv, "sandbox");

      expect(result.brevo).toEqual({
        detail:
          "Email sends through the Cloudflare Email Sending binding. SMS delivery is configured via Brevo.",
        status: "ok",
      });
    });

    it("reports ok advising BREVO_SMS_SENDER when API key is set but SMS sender is omitted", () => {
      const result = providerSetupChecks(
        {
          ...baseEnv,
          BREVO_SMS_SENDER: "",
        },
        "sandbox",
      );

      expect(result.brevo).toEqual({
        detail:
          "Email sends through the Cloudflare Email Sending binding. Set BREVO_SMS_SENDER if transactional SMS is needed.",
        status: "ok",
      });
    });

    it("reports error when PLATFORM_EMAIL binding is missing", () => {
      const result = providerSetupChecks(
        {
          ...baseEnv,
          PLATFORM_EMAIL: undefined,
        },
        "sandbox",
      );

      expect(result.brevo.status).toBe("error");
    });
  });
});
