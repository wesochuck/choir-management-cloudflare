import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOrganizationCalendarSettings,
  getOrganizationExportStatus,
  getOrganizationPaymentSettings,
  getOrganizationTransactionFeeSettings,
} from "../auth/api";
import { SaveCoordinatorProvider } from "../persistence";
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
    window.history.replaceState(null, "", "/admin/settings");
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
    await userEvent.click(screen.getByRole("tab", { name: "Payments" }));
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
    await userEvent.click(screen.getByRole("tab", { name: "Payments" }));
    const percentageInput = await screen.findByLabelText("Percentage (%)");
    expect(percentageInput).toHaveValue("2.90");

    await user.clear(percentageInput);
    await user.type(percentageInput, "3.5");
    expect(percentageInput).toHaveValue("3.5");

    await user.tab();
    expect(percentageInput).toHaveValue("3.50");
  });
  it("opens bookmarked tabs and supports keyboard tab switching", async () => {
    window.history.replaceState(null, "", "/admin/settings?tab=compliance&task=example");
    const user = userEvent.setup();
    render(<OrganizationSettingsPage enabled />);
    const compliance = screen.getByRole("tab", { name: "Compliance & deadlines" });
    expect(compliance).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("compliance-panel")).toBeVisible();
    expect(screen.queryByTestId("branding-panel")).not.toBeInTheDocument();
    compliance.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Payments" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("payments");
    expect(new URLSearchParams(window.location.search).get("task")).toBe("example");
  });

  it("guards tab changes and keeps the current tab when discarding is canceled", async () => {
    const user = userEvent.setup();
    render(
      <SaveCoordinatorProvider>
        <OrganizationSettingsPage enabled />
      </SaveCoordinatorProvider>,
    );
    const timezone = await screen.findByLabelText("IANA timezone");
    await user.selectOptions(timezone, "UTC");
    await user.click(screen.getByRole("tab", { name: "Email" }));
    expect(
      await screen.findByRole("dialog", { name: "Leave with unsaved changes?" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(timezone).toHaveValue("UTC");
    await user.click(screen.getByRole("tab", { name: "Email" }));
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(screen.getByTestId("email-settings-panel")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(await screen.findByLabelText("IANA timezone")).toHaveValue("America/New_York");
  });

  it("restores fee inputs after discarding changes while switching tabs", async () => {
    const user = userEvent.setup();
    render(
      <SaveCoordinatorProvider>
        <OrganizationSettingsPage enabled />
      </SaveCoordinatorProvider>,
    );
    await user.click(screen.getByRole("tab", { name: "Payments" }));
    const percentage = await screen.findByLabelText("Percentage (%)");
    await user.clear(percentage);
    await user.type(percentage, "4.5");
    await user.click(screen.getByRole("tab", { name: "General" }));
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    await user.click(screen.getByRole("tab", { name: "Payments" }));
    expect(await screen.findByLabelText("Percentage (%)")).toHaveValue("2.90");
  });

  it.each([
    ["?stripe=return#payments-settings", "Payments"],
    ["#email-settings-title", "Email"],
    ["#export", "Data export"],
    ["?tab=unknown", "General"],
  ])("preserves settings entry point %s", (suffix, label) => {
    window.history.replaceState(null, "", `/admin/settings${suffix}`);
    render(<OrganizationSettingsPage enabled />);
    expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
  });
});
