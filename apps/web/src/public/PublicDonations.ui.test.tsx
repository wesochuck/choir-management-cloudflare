import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedOrganizationProjection } from "@choir/contracts";
import { PublicDonations } from "./PublicDonations";
import * as authApi from "../auth/api";
import * as api from "../api";

vi.mock("../auth/api", () => ({
  getPublicCommerceProjection: vi.fn(),
  getPublicDonationReceipt: vi.fn(),
  getPublishedOrganizationProjection: vi.fn(),
}));

vi.mock("../api", () => ({
  checkoutPublicDonation: vi.fn(),
  getPublicDonationSettings: vi.fn(),
  getPublicTransactionFeeSettings: vi.fn(),
}));

const mockProjection: PublishedOrganizationProjection = {
  generatedAt: "2026-09-22T12:00:00.000Z",
  organizationId: "org-123",
  payload: {
    mediaFileIds: [],
    organizationName: "City Chorus",
    performances: [],
    settings: {
      aboutUsText: "",
      bodyFont: "system",
      contactEmail: "info@example.com",
      enabledNavigation: ["donations"],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: "Welcome",
      heroSubtitle: "Support us",
      historyText: "",
      logoFileId: "logo-file-123",
      showBrandingHeaderFooter: false,
    },
    ticketBundles: [],
    timezone: "America/New_York",
  },
  version: 1,
};

describe("PublicDonations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(null);
    vi.mocked(authApi.getPublicCommerceProjection).mockResolvedValue(mockProjection);
    vi.mocked(api.getPublicDonationSettings).mockResolvedValue({
      buttonText: "Donate Now",
      description: "Support our choir.",
      levels: [{ amountCents: 2500, benefit: "Friend", id: "lvl-1", label: "Friend" }],
    });
    vi.mocked(api.getPublicTransactionFeeSettings).mockResolvedValue({
      fixedCents: 30,
      passFeeToDonor: false,
      percentage: 2.9,
    });
  });

  it("renders /donate inside PublicTransactionLayout with organization brand", async () => {
    render(<PublicDonations pathname="/donate" />);

    await waitFor(() => {
      expect(screen.getByText("City Chorus")).toBeInTheDocument();
    });

    const brandLink = screen.getByRole("link", { name: "City Chorus" });
    expect(brandLink).toBeInTheDocument();

    const logoImg = brandLink.querySelector("img");
    expect(logoImg).toBeInTheDocument();
    expect(logoImg).toHaveAttribute("src", "/api/public/media/1/logo-file-123");

    expect(screen.getByRole("heading", { name: "Donate Now" })).toBeInTheDocument();
  });

  it("handles image load failure gracefully by falling back to /api/public/logo then removing img on second failure", async () => {
    render(<PublicDonations pathname="/donate" />);

    await waitFor(() => {
      expect(screen.getByText("City Chorus")).toBeInTheDocument();
    });

    const brandLink = screen.getByRole("link", { name: "City Chorus" });
    const logoImg = brandLink.querySelector("img");
    expect(logoImg).not.toBeNull();
    if (!logoImg) return;

    // First error: falls back to /api/public/logo
    fireEvent.error(logoImg);
    expect(logoImg).toHaveAttribute("src", "/api/public/logo");

    // Second error (e.g. 404): removes img cleanly without broken image
    fireEvent.error(logoImg);
    expect(brandLink.querySelector("img")).toBeNull();
    expect(screen.getByText("City Chorus")).toBeInTheDocument();
  });

  it("renders with OrganizationLayout when showBrandingHeaderFooter is enabled", async () => {
    const brandedProjection: PublishedOrganizationProjection = {
      ...mockProjection,
      payload: {
        ...mockProjection.payload,
        settings: {
          ...mockProjection.payload.settings,
          showBrandingHeaderFooter: true,
        },
      },
    };
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(brandedProjection);

    render(<PublicDonations pathname="/donate" />);

    await waitFor(() => {
      expect(screen.getByText("City Chorus")).toBeInTheDocument();
    });

    // Navigation should be rendered in OrganizationLayout
    expect(screen.getByRole("navigation", { name: "Public website" })).toBeInTheDocument();
  });
});
