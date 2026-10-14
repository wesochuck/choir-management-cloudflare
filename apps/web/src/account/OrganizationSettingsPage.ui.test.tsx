import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOrganizationCalendarSettings,
  getOrganizationExportStatus,
  getOrganizationPaymentSettings,
  getOrganizationTransactionFeeSettings,
} from "../auth/api";
import { OrganizationSettingsPage } from "./OrganizationSettingsPage";

vi.mock("./OrganizationBrandingPanel", () => ({
  OrganizationBrandingPanel: () => <div data-testid="branding-panel" />,
}));
vi.mock("./OrganizationNonprofitCompliancePanel", () => ({
  OrganizationNonprofitCompliancePanel: () => <div data-testid="compliance-panel" />,
}));
vi.mock("./OrganizationEmailSettingsPanel", () => ({
  OrganizationEmailSettingsPanel: () => <div data-testid="email-settings-panel" />,
}));

vi.mock("../auth/api", () => ({
  getOrganizationCalendarSettings: vi.fn(),
  getOrganizationExportStatus: vi.fn(),
  getOrganizationPaymentSettings: vi.fn(),
  getOrganizationTransactionFeeSettings: vi.fn(),
  updateOrganizationCalendarSettings: vi.fn(),
  updateOrganizationPaymentActivation: vi.fn(),
  updateOrganizationTransactionFeeSettings: vi.fn(),
  startOrganizationExport: vi.fn(),
}));

describe("OrganizationSettingsPage fee formatting (#181)", () => {
  beforeEach(() => {
    vi.mocked(getOrganizationCalendarSettings).mockResolvedValue({
      timezone: "America/New_York",
    });
    vi.mocked(getOrganizationPaymentSettings).mockResolvedValue({
      activations: { dues: true, donations: true, tickets: true },
      environment: "local",
      externalEffectsMode: "fake",
      globalPaymentsEnabled: true,
      organizationName: "Alpha Choir",
      readiness: {
        brevoConfigured: true,
        stripeAccountReady: false,
        stripeConfigured: true,
        webhookConfigured: true,
      },
      requestId: "req-test-1",
      stripe: {
        accountId: null,
        chargesEnabled: false,
        detailsSubmitted: false,
        payoutsEnabled: false,
        requirementsDue: [],
        status: "not_started",
      },
    });
    vi.mocked(getOrganizationExportStatus).mockResolvedValue({
      byteCount: null,
      checksumSha256: null,
      downloadUrl: null,
      errorCode: null,
      exportId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      status: "completed",
    });
  });

  it("formats transaction fee percentage to two decimals on display and prevents float precision artifacts", async () => {
    vi.mocked(getOrganizationTransactionFeeSettings).mockResolvedValue({
      fixedCents: 30,
      passFeeToDonor: false,
      percentage: 2.9,
    });

    render(<OrganizationSettingsPage enabled />);
    const percentageInput = await screen.findByLabelText("Percentage (%)");
    expect(percentageInput).toHaveValue("2.90");
  });

  it("re-formats fee percentage to two decimals on blur after user input", async () => {
    const user = userEvent.setup();
    vi.mocked(getOrganizationTransactionFeeSettings).mockResolvedValue({
      fixedCents: 30,
      passFeeToDonor: false,
      percentage: 2.9,
    });

    render(<OrganizationSettingsPage enabled />);
    const percentageInput = await screen.findByLabelText("Percentage (%)");
    expect(percentageInput).toHaveValue("2.90");

    await user.clear(percentageInput);
    await user.type(percentageInput, "3.5");
    expect(percentageInput).toHaveValue("3.5");

    await user.tab();
    expect(percentageInput).toHaveValue("3.50");
  });
});
