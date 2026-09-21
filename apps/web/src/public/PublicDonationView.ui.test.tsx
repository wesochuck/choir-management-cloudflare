import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DonationSettings, TransactionFeeSettings } from "@choir/contracts";
import { PublicDonationView } from "./PublicDonationView";
import * as api from "../api";

vi.mock("../api", () => ({
  checkoutPublicDonation: vi.fn(),
  getPublicDonationSettings: vi.fn(),
  getPublicTransactionFeeSettings: vi.fn(),
}));

const mockDonationSettings: DonationSettings = {
  buttonText: "Support our Choir",
  description: "Help us keep music alive in our community.",
  levels: [
    { amountCents: 2500, benefit: "Program mention", id: "level-1", label: "Friend" },
    { amountCents: 5000, benefit: "Reserved seating", id: "level-2", label: "Supporter" },
    { amountCents: 10000, benefit: "VIP reception", id: "level-3", label: "Patron" },
  ],
};

const mockFeeSettingsWithDonor: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: true,
  percentage: 2.9,
};

const mockFeeSettingsCovered: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

describe("PublicDonationView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getPublicDonationSettings).mockResolvedValue(mockDonationSettings);
    vi.mocked(api.getPublicTransactionFeeSettings).mockResolvedValue(mockFeeSettingsCovered);
    vi.mocked(api.checkoutPublicDonation).mockResolvedValue({
      checkoutMode: "stripe",
      successToken: "token_123",
      url: "https://checkout.stripe.test/pay",
    });
  });

  it("renders donation levels and updates total when level is selected", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    // Default first level is selected ($25.00)
    const summary = screen.getByLabelText("Donation summary");
    expect(within(summary).getByText("Covered by the Organization")).toBeInTheDocument();
    expect(within(summary).getAllByText("$25.00")).toHaveLength(2);

    // Click Supporter ($50.00)
    const supporterBtn = screen.getByRole("button", { name: /Supporter/ });
    await user.click(supporterBtn);

    // Summary should reflect $50.00
    expect(within(summary).getAllByText("$50.00")).toHaveLength(2);
  });

  it("reveals custom amount field and updates total when custom amount is entered", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Custom amount")).not.toBeInTheDocument();

    const customBtn = screen.getByRole("button", { name: "Custom amount" });
    await user.click(customBtn);

    const customInput = screen.getByLabelText("Custom amount");
    expect(customInput).toBeInTheDocument();

    await user.type(customInput, "75.50");
    expect(screen.getAllByText("$75.50").length).toBeGreaterThanOrEqual(1);
  });

  it("allows selecting tribute options by label and renders real radio inputs", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByText("Tribute (optional)")).toBeInTheDocument();
    });

    const noneRadio = screen.getByLabelText("No tribute");
    const honorRadio = screen.getByLabelText("In honor of");
    const memoryRadio = screen.getByLabelText("In memory of");
    const anonTributeRadio = screen.getByLabelText("Anonymous tribute");

    expect(noneRadio).toBeChecked();
    expect(honorRadio).not.toBeChecked();

    await user.click(honorRadio);
    expect(honorRadio).toBeChecked();
    expect(noneRadio).not.toBeChecked();

    await user.click(anonTributeRadio);
    expect(anonTributeRadio).toBeChecked();
    expect(honorRadio).not.toBeChecked();

    await user.click(memoryRadio);
    expect(memoryRadio).toBeChecked();
  });

  it("reveals conditional fields for honor and memory, and hides them for none and anonymous tribute", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByText("Tribute (optional)")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Honoree name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Person to memorialize")).not.toBeInTheDocument();

    // Select In honor of
    await user.click(screen.getByLabelText("In honor of"));
    expect(screen.getByLabelText("Honoree name")).toBeInTheDocument();
    expect(screen.getByLabelText("Notification email (optional)")).toBeInTheDocument();

    // Select In memory of
    await user.click(screen.getByLabelText("In memory of"));
    expect(screen.getByLabelText("Person to memorialize")).toBeInTheDocument();
    expect(screen.getByLabelText("Notification email (optional)")).toBeInTheDocument();

    // Select Anonymous tribute
    await user.click(screen.getByLabelText("Anonymous tribute"));
    expect(screen.queryByLabelText("Honoree name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Person to memorialize")).not.toBeInTheDocument();
  });

  it("handles donor anonymity and marketing checkboxes independently", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    const anonCheckbox = screen.getByLabelText("Hide my name from public donor recognition");
    const marketingCheckbox = screen.getByLabelText(
      "I would like to receive updates about future events and programs",
    );

    expect(anonCheckbox).not.toBeChecked();
    expect(marketingCheckbox).not.toBeChecked();

    await user.click(anonCheckbox);
    expect(anonCheckbox).toBeChecked();
    expect(marketingCheckbox).not.toBeChecked();

    await user.click(marketingCheckbox);
    expect(anonCheckbox).toBeChecked();
    expect(marketingCheckbox).toBeChecked();

    await user.click(anonCheckbox);
    expect(anonCheckbox).not.toBeChecked();
    expect(marketingCheckbox).toBeChecked();
  });

  it("validates email mismatch and displays safe error", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Name"), "Alex Donor");
    await user.type(screen.getByLabelText("Email"), "alex@example.test");
    await user.type(screen.getByLabelText("Confirm email"), "different@example.test");

    await user.click(screen.getByRole("button", { name: "Complete donation" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Email addresses must match.");
    expect(api.checkoutPublicDonation).not.toHaveBeenCalled();
  });

  it("calculates processing fee when passFeeToDonor is true", async () => {
    vi.mocked(api.getPublicTransactionFeeSettings).mockResolvedValue(mockFeeSettingsWithDonor);
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    // 2500 cents * 2.9% + 30 cents = 72.5 + 30 = 103 cents = $1.03
    expect(screen.getByText("$1.03")).toBeInTheDocument();
    // Total: 2500 + 103 = 2603 = $26.03
    expect(screen.getByText("$26.03")).toBeInTheDocument();
  });

  it("submits checkout with correct payload when form is valid", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Name"), "Alex Donor");
    await user.type(screen.getByLabelText("Email"), "alex@example.test");
    await user.type(screen.getByLabelText("Confirm email"), "alex@example.test");
    await user.click(screen.getByLabelText("In honor of"));
    await user.type(screen.getByLabelText("Honoree name"), "Grandma Music");
    await user.type(screen.getByLabelText("Notification email (optional)"), "notify@example.test");
    await user.click(screen.getByLabelText("Hide my name from public donor recognition"));
    await user.click(
      screen.getByLabelText("I would like to receive updates about future events and programs"),
    );

    await user.click(screen.getByRole("button", { name: "Complete donation" }));

    expect(api.checkoutPublicDonation).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 2500,
        anonymous: true,
        buyerEmail: "alex@example.test",
        buyerName: "Alex Donor",
        marketingConsent: true,
        tributeName: "Grandma Music",
        tributeNotifyEmail: "notify@example.test",
        tributeType: "honor",
      }),
    );
  });
});
