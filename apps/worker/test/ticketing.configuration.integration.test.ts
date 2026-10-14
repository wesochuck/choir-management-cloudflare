import {
  donationSettingsResponseSchema,
  organizationPaymentSettingsResponseSchema,
  transactionFeeSettingsResponseSchema,
} from "@choir/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  exports,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Organization ticketing configuration", () => {
  it("persists donation levels and serves them on the public Organization host", async () => {
    const cookie = await signIn();
    const initial = donationSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/donation-settings", cookie),
        )
      ).json(),
    );
    expect(initial.levels).toHaveLength(4);

    const updated = {
      buttonText: "Support the next concert",
      description: "Help us bring live choral music to more neighbors.",
      levels: [
        {
          amountCents: 7_500,
          benefit: "Name in the concert program",
          id: "community-friend",
          label: "Community friend",
        },
      ],
    };
    const saved = donationSettingsResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/donation-settings",
          "PUT",
          updated,
          cookie,
        )
      ).json(),
    );
    expect(saved).toMatchObject(updated);

    const publicSettings = donationSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(api("tickets.example.test", "/api/public/donation-settings"))
      ).json(),
    );
    expect(publicSettings).toMatchObject(updated);
  });

  it("persists transaction fees and serves them on the public Organization host", async () => {
    const cookie = await signIn();
    const initial = transactionFeeSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/transaction-fee-settings", cookie),
        )
      ).json(),
    );
    expect(initial).toMatchObject({ fixedCents: 30, passFeeToDonor: false, percentage: 2.9 });

    const updated = { fixedCents: 45, passFeeToDonor: true, percentage: 3.25 };
    const saved = transactionFeeSettingsResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/transaction-fee-settings",
          "PUT",
          updated,
          cookie,
        )
      ).json(),
    );
    expect(saved).toMatchObject(updated);

    const publicSettings = transactionFeeSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("tickets.example.test", "/api/public/transaction-fee-settings"),
        )
      ).json(),
    );
    expect(publicSettings).toMatchObject(updated);
  });

  it("shows payment readiness to managers and keeps activation fail-closed", async () => {
    const cookie = await signIn();
    const settingsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/payment-settings", cookie),
    );
    expect(settingsResponse.status).toBe(200);
    const settings = organizationPaymentSettingsResponseSchema.parse(await settingsResponse.json());
    expect(settings.activations).toEqual({ donations: false, dues: false, tickets: false });
    expect(settings.globalPaymentsEnabled).toBe(false);
    expect(settings.stripe.status).toBe("not_started");

    const notReady = await jsonWrite(
      "alpha.localhost",
      "/api/organization/payment-settings/activation",
      "POST",
      { confirm: true, enabled: true, moduleId: "tickets" },
      cookie,
    );
    expect(notReady.status).toBe(409);
    expect(await notReady.json()).toMatchObject({ code: "payments_not_ready" });

    const memberResponse = await exports.default.fetch(
      api("bravo.localhost", "/api/organization/payment-settings", cookie),
    );
    expect(memberResponse.status).toBe(403);
  });
});
