import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  uploadPublicSponsorArtwork: vi.fn(),
}));

const mockDonationSettings: DonationSettings = {
  buttonText: "Support our Choir",
  description: "Help us keep music alive in our community.",
  levels: [
    {
      amountCents: 2500,
      artworkInstructions: "",
      benefit: "Program mention",
      id: "level-1",
      includesProgramAd: false,
      label: "Friend",
    },
    {
      amountCents: 5000,
      artworkInstructions: "",
      benefit: "Reserved seating",
      id: "level-2",
      includesProgramAd: false,
      label: "Supporter",
    },
    {
      amountCents: 10000,
      artworkInstructions: "Full page color ad: 5.5 x 8.5 inches, 300 DPI, PDF or PNG preferred.",
      benefit: "VIP reception & half-page program ad",
      id: "level-3",
      includesProgramAd: true,
      label: "Patron Sponsor",
    },
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
  it("orders levels by ascending amount, keeps equal amounts stable and Custom last, and selects the lowest", async () => {
    const [friend, supporter, patron] = mockDonationSettings.levels;
    if (!friend || !supporter || !patron) throw new Error("Missing donation fixtures");
    const penny = { ...friend, amountCents: 1, id: "penny", label: "Small gift" };
    const sameAmount = { ...supporter, id: "equal", label: "Matching supporter" };
    const levels = [patron, supporter, penny, sameAmount, friend];
    vi.mocked(api.getPublicDonationSettings).mockResolvedValue({ ...mockDonationSettings, levels });
    render(<PublicDonationView />);
    await screen.findByRole("heading", { name: "Support our Choir" });
    const options = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("donation-level-option"));
    expect(options.map((button) => button.textContent)).toEqual([
      "Small giftProgram mention$0.01",
      "FriendProgram mention$25.00",
      "SupporterReserved seating$50.00",
      "Matching supporterReserved seating$50.00",
      "Patron SponsorVIP reception & half-page program ad$100.00",
      "Custom amount",
    ]);
    expect(options[0]).toHaveClass("is-selected");
    expect(
      within(screen.getByLabelText("Donation summary")).getAllByText("$0.01", {
        selector: "strong",
      }),
    ).toHaveLength(2);
    expect(levels.map(({ id }) => id)).toEqual([
      patron.id,
      supporter.id,
      penny.id,
      sameAmount.id,
      friend.id,
    ]);
  });

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

  it("allows selecting tribute options by label, renders exactly 3 options, and does not offer anonymous tribute", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByText("Tribute (optional)")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Anonymous tribute")).not.toBeInTheDocument();

    const noneRadio = screen.getByLabelText("No tribute");
    const honorRadio = screen.getByLabelText("In honor of");
    const memoryRadio = screen.getByLabelText("In memory of");

    expect(noneRadio).toBeChecked();
    expect(honorRadio).not.toBeChecked();
    expect(memoryRadio).not.toBeChecked();

    await user.click(honorRadio);
    expect(honorRadio).toBeChecked();
    expect(noneRadio).not.toBeChecked();

    await user.click(memoryRadio);
    expect(memoryRadio).toBeChecked();
    expect(honorRadio).not.toBeChecked();

    await user.click(noneRadio);
    expect(noneRadio).toBeChecked();
  });

  it("reveals conditional fields for honor and memory, and hides them for none", async () => {
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

    // Select No tribute
    await user.click(screen.getByLabelText("No tribute"));
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

    // Gross up the charge so Stripe's 2.9% + $0.30 fee is paid by the donor
    // while the Organization still nets the full $25.00 donation.
    expect(screen.getByText("$1.06")).toBeInTheDocument();
    expect(screen.getByText("$26.06")).toBeInTheDocument();
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

  it("renders Markdown links in donation description via PublicCopy", async () => {
    vi.mocked(api.getPublicDonationSettings).mockResolvedValue({
      ...mockDonationSettings,
      description:
        'Prefer mail? [Download our mail-in form](/api/public/documents/mail-in-form.pdf){target="_blank"} to mail your check.',
    });

    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: "Download our mail-in form" });
    expect(link).toHaveAttribute("href", "/api/public/documents/mail-in-form.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows Program advertisement section and specifications only when an ad level is selected", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    // Default level-1 ("Friend") does not include program ad
    expect(screen.queryByText("Program advertisement")).not.toBeInTheDocument();
    expect(screen.queryByText(/Full page color ad/)).not.toBeInTheDocument();

    // Select Patron Sponsor ($100.00)
    await user.click(screen.getByRole("button", { name: /Patron Sponsor/ }));

    // Program ad fieldset should now appear with instructions
    expect(screen.getByText("Program advertisement")).toBeInTheDocument();
    expect(screen.getByText(/Full page color ad: 5.5 x 8.5 inches/)).toBeInTheDocument();
    expect(screen.getByLabelText("Sponsor or business name")).toBeInTheDocument();
    expect(screen.getByText(/Don’t have artwork ready\?/)).toBeInTheDocument();

    // Summary reflects ad entitlement
    const summary = screen.getByLabelText("Donation summary");
    expect(within(summary).getByText("Program ad")).toBeInTheDocument();
    expect(within(summary).getByText("Send artwork later")).toBeInTheDocument();

    // Switching back to Friend hides the section
    await user.click(screen.getByRole("button", { name: /Friend/ }));
    expect(screen.queryByText("Program advertisement")).not.toBeInTheDocument();
    expect(within(summary).queryByText("Program ad")).not.toBeInTheDocument();

    // Custom amount also never shows ad section
    await user.click(screen.getByRole("button", { name: "Custom amount" }));
    expect(screen.queryByText("Program advertisement")).not.toBeInTheDocument();
  });

  it("uploads artwork file, updates summary, and displays file chip", async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadPublicSponsorArtwork).mockResolvedValue({
      contentType: "application/pdf",
      fileId: "file-ad-123",
      fileName: "company-ad.pdf",
      requestId: "req-upload-123",
      sizeBytes: 150_000,
    });

    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    // Select Patron Sponsor ($100.00)
    await user.click(screen.getByRole("button", { name: /Patron Sponsor/ }));

    // Type sponsor name
    await user.type(screen.getByLabelText("Sponsor or business name"), "Acme Symphony Patrons");

    // Upload an artwork file
    const file = new File(["dummy pdf content"], "company-ad.pdf", { type: "application/pdf" });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInstanceOf(HTMLInputElement);
    if (fileInput instanceof HTMLInputElement) {
      await user.upload(fileInput, file);
    }

    await waitFor(() => {
      expect(api.uploadPublicSponsorArtwork).toHaveBeenCalledWith(
        file,
        "level-3",
        expect.any(String),
      );
    });

    // File chip should be visible with name and size
    expect(screen.getByText("company-ad.pdf")).toBeInTheDocument();
    expect(screen.getByText(/146 KB/)).toBeInTheDocument();

    // Summary reflects artwork attached
    const summary = screen.getByLabelText("Donation summary");
    expect(within(summary).getByText("Artwork attached")).toBeInTheDocument();

    // Complete donation should include sponsor details
    await user.type(screen.getByLabelText("Name"), "Alex Donor");
    await user.type(screen.getByLabelText("Email"), "alex@example.test");
    await user.type(screen.getByLabelText("Confirm email"), "alex@example.test");
    await user.click(screen.getByRole("button", { name: "Complete donation" }));

    expect(api.checkoutPublicDonation).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 10000,
        artworkFileId: "file-ad-123",
        levelId: "level-3",
        sponsorName: "Acme Symphony Patrons",
      }),
    );
  });

  it("validates file size and unsupported format on artwork upload", async () => {
    const user = userEvent.setup();
    render(<PublicDonationView />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Support our Choir" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Patron Sponsor/ }));

    await waitFor(() => {
      expect(screen.getByText("Program advertisement")).toBeInTheDocument();
    });

    // Try uploading an unsupported file format (e.g. bypassing OS picker filter)
    const svgFile = new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInstanceOf(HTMLInputElement);
    if (fileInput instanceof HTMLInputElement) {
      fireEvent.change(fileInput, { target: { files: [svgFile] } });
    }

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Artwork must be a PDF, PNG, or JPEG file.",
    );
    expect(api.uploadPublicSponsorArtwork).not.toHaveBeenCalled();

    // Try uploading a file > 20 MB
    const hugeFile = new File(["dummy"], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(hugeFile, "size", { value: 21 * 1024 * 1024 });
    if (fileInput instanceof HTMLInputElement) {
      fireEvent.change(fileInput, { target: { files: [hugeFile] } });
    }

    expect(screen.getByRole("alert")).toHaveTextContent("Artwork file must be at most 20 MB.");
  });
});
