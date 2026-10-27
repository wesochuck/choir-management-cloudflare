import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSponsorDonationResponse } from "@choir/contracts";

import * as api from "../api";
import { PublicSponsorArtworkView } from "./PublicSponsorArtworkView";

vi.mock("../api", () => ({
  getPublicSponsorDonation: vi.fn(),
  submitPublicSponsorArtwork: vi.fn(),
}));

const mockSponsorDonation: PublicSponsorDonationResponse = {
  amountCents: 50000,
  artworkFileId: null,
  artworkFileName: null,
  artworkInstructions: "Full page ad: 300 DPI, CMYK color or grayscale, PDF or PNG.",
  artworkStatus: "not_received",
  artworkUploadedAt: null,
  buyerName: "Jane Donor",
  donationId: "11111111-1111-4111-8111-111111111111",
  requestId: "req-123",
  selectedLevelName: "Gold Program Sponsor",
  sponsorName: "Acme Holdings LLC",
  status: "paid",
};

describe("PublicSponsorArtworkView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows error when token is missing from URL", () => {
    window.history.replaceState({}, "", "/donate/sponsor");
    render(<PublicSponsorArtworkView />);

    expect(screen.getByRole("heading", { name: "Program ad artwork" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This sponsor link is invalid or has expired.",
    );
    expect(screen.getByRole("link", { name: "Return home" })).toBeInTheDocument();
  });

  it("renders sponsor details and instructions when token is valid", async () => {
    window.history.replaceState({}, "", "/donate/sponsor?token=valid_sponsor_token");
    vi.mocked(api.getPublicSponsorDonation).mockResolvedValue(mockSponsorDonation);

    render(<PublicSponsorArtworkView />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading sponsorship details…");

    expect(await screen.findByText("Acme Holdings LLC")).toBeVisible();
    expect(screen.getByText(/Gold Program Sponsor/)).toBeInTheDocument();
    expect(screen.getByText(/\$500\.00/)).toBeInTheDocument();
    expect(screen.getByText("Jane Donor")).toBeInTheDocument();
    expect(screen.getByText("Artwork needed")).toBeInTheDocument();
    expect(screen.getByText(/Full page ad: 300 DPI/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upload your artwork" })).toBeInTheDocument();
  });

  it("uploads artwork and updates view to received status", async () => {
    window.history.replaceState({}, "", "/donate/sponsor?token=valid_sponsor_token");
    vi.mocked(api.getPublicSponsorDonation).mockResolvedValue(mockSponsorDonation);
    vi.mocked(api.submitPublicSponsorArtwork).mockResolvedValue({
      ...mockSponsorDonation,
      artworkFileId: "file-999-art",
      artworkFileName: "acme-ad.pdf",
      artworkStatus: "received",
      artworkUploadedAt: "2026-10-01T15:00:00.000Z",
    });

    render(<PublicSponsorArtworkView />);

    expect(await screen.findByText("Acme Holdings LLC")).toBeVisible();

    const file = new File(["fake pdf"], "acme-ad.pdf", { type: "application/pdf" });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInstanceOf(HTMLInputElement);
    if (fileInput instanceof HTMLInputElement) {
      fireEvent.change(fileInput, { target: { files: [file] } });
    }

    await waitFor(() => {
      expect(api.submitPublicSponsorArtwork).toHaveBeenCalledWith("valid_sponsor_token", file);
    });

    expect(screen.getByText("Artwork uploaded successfully!")).toBeInTheDocument();
    expect(screen.getByText("Artwork received")).toBeInTheDocument();
    expect(screen.getByText("acme-ad.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View uploaded artwork" })).toHaveAttribute(
      "href",
      "/api/public/donations/artwork/file-999-art?token=valid_sponsor_token",
    );
  });

  it("renders received status and file preview link for already uploaded artwork", async () => {
    window.history.replaceState({}, "", "/donate/sponsor?token=valid_sponsor_token");
    vi.mocked(api.getPublicSponsorDonation).mockResolvedValue({
      ...mockSponsorDonation,
      artworkFileId: "file-888-art",
      artworkFileName: "existing-ad.png",
      artworkStatus: "received",
      artworkUploadedAt: "2026-09-15T12:00:00.000Z",
    });

    render(<PublicSponsorArtworkView />);

    expect(await screen.findByText("Acme Holdings LLC")).toBeVisible();
    expect(screen.getByText("Artwork received")).toBeInTheDocument();
    expect(screen.getByText("existing-ad.png")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Submitted artwork" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View uploaded artwork" })).toHaveAttribute(
      "href",
      "/api/public/donations/artwork/file-888-art?token=valid_sponsor_token",
    );
    expect(screen.getByText("Choose replacement artwork")).toBeInTheDocument();
  });

  it("displays error message if token lookup fails", async () => {
    window.history.replaceState({}, "", "/donate/sponsor?token=bad_token");
    vi.mocked(api.getPublicSponsorDonation).mockRejectedValue(
      new Error("This sponsor link is invalid or has expired."),
    );

    render(<PublicSponsorArtworkView />);

    expect(
      await screen.findByText("This sponsor link is invalid or has expired."),
    ).toBeInTheDocument();
  });
});
